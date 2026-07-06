# Persistent shared-pool orchestrator replaces the discrete Run-loop

Sandcastle's orchestrator (`.sandcastle/main.mts`) changes from a **discrete,
phased loop** — `for` over `MAX_ITERATIONS = 10`, each iteration strictly
`Plan → parallel Implement/Review (MAX_PARALLEL = 3) → Merge` — into a **persistent
loop feeding a single shared concurrency Pool**. The loop never exits on its own;
Implementer, Reviewer, and Merger Sessions all draw from one Pool of **10** slots,
topped up on a ~60s Poll tick in priority order **merge → review → implement**.
This supersedes the "one outer iteration = one Run" model and revises ADR-0003's
assumption that Implementer→Reviewer are chained within a single pass.

## Why

The 10-iteration cap is arbitrary and stops the pipeline while work remains. The
strict per-iteration phasing couples an issue's implement, review, and merge into
one synchronous pass, so a slow Implementer stalls unrelated merges, and finished
PRs can't land until the whole batch completes. Decoupling the three roles into a
shared Pool keeps slots busy and lets already-started work drain to `main`
independently of new work starting.

## The loop

Each Poll tick (~60s):

1. `free = 10 − inflight.size`. If `free == 0`, **skip the `gh` query entirely**
   (no wasted calls) and sleep to the next tick.
2. Otherwise query the three **Dispatch buckets**, excluding anything in the
   in-memory **In-flight set** or carrying `ready-for-human`:
   - **ready-for-merge** — PR ready (non-draft) + `reviewed` label → Merger.
   - **ready-for-review** — open **draft** `sandcastle/issue-N` PR without
     `reviewed` → Reviewer.
   - **ready-for-agent** — issue labeled `ready-for-agent`, no open PR → Implementer.
3. Fill `free` slots in priority **merge → review → implement**. Draining the
   pipeline right-to-left means started work lands before new work starts — the
   critical property that prevents PR **starvation** (fill-new-first would let
   drafts pile up while nothing ever merges).
4. Each dispatched Session runs async and removes itself from the In-flight set on
   resolution. When all buckets are empty the tick is the idle sleep.

## Key decisions

- **Planner stays; its output is unchanged.** The LLM Planner still does dependency
  analysis over `ready-for-agent` issues and emits unblocked, non-overlapping
  issues — the guarantee that makes concurrent branches conflict-free (every PR
  targets `main`). Only the _dispatch_ changed. The two PR buckets need no
  dependency analysis, so review/merge dispatch is **pure orchestrator code** with
  no LLM call.

- **Planner is outside the Pool and gated on actionability.** It runs in its own
  dedicated singleton slot (never counted against the 10), and **only** when
  `ready-for-agent` issues exist **and** at least one free Pool slot remains after
  merge+review draining — i.e. only when an Implementer could actually start.
  Running Opus to produce a plan we can't dispatch is pure token waste, and
  avoiding it is the stated motivation. The emit list is **not cached**: the
  Planner re-plans every eligible tick (accepted cost, for simplicity).
  _Revised by ADR-0010:_ the emit list is now cached (the **Plan cache**) and
  the Planner re-runs only when the `ready-for-agent` set's content changes.

- **A Pool slot is a full agent+sandbox lifecycle.** Because impl and review are now
  decoupled across ticks, the Reviewer can no longer reuse the Implementer's live
  sandbox (ADR-0003). Every Reviewer and Merger **creates its own fresh sandbox**
  from the PR branch and re-runs `pnpm install --frozen-lockfile && pnpm build`.
  We **accept** this rebuild cost to keep the design stateless and simple, rather
  than maintaining persistent per-branch worktrees.

- **Per-PR Mergers, not a batch Merger.** The old single Merger landed all eligible
  PRs from `BRANCHES`/`ISSUES` lists in one pass. The Pool's natural unit is one
  Merger per PR (one slot, one PR).

- **`ready-for-human` is the universal terminal state.** A persistent poller re-sees the
  same item every tick, so every give-up/failure path must durably change GitHub
  state or it re-dispatches forever. In-memory tracking can't help — it only holds
  an item while its Session runs. Therefore:
  - **No-op Implementer** (zero commits, no PR) → strip `ready-for-agent`, add
    `ready-for-human` + a comment. One no-op is a strong signal the issue isn't
    actually agent-ready.
  - **Reviewer can't pass** the change → leave the PR draft, add `ready-for-human` + a
    comment.
  - **Merger's test-then-merge fails or conflicts** → remove `reviewed`, revert the
    PR to draft, add `ready-for-human` + a comment.

  The orchestrator excludes `ready-for-human` items from all buckets; a human re-triages.

- **Run redefined.** `runId` no longer groups "everything in one 10-minute
  iteration." It is now derived deterministically from the issue number, so an
  issue's Implementer/Reviewer/Merger Sessions — which now land in _different_
  ticks — share one `runId`, and auditing an issue is a single lookup. Planner
  Sessions are recorded per-invocation with no issue binding. `generateRunId()` and
  its call sites in `main.mts` change accordingly; the Manifest schema is otherwise
  untouched.

## Considered options

- **In-memory vs. durable In-flight tracking.** Chosen: **in-memory**, keyed by
  issue/PR number. Simple, no external store. Consequence below.
- **Event-driven top-up vs. 60s tick.** Chosen: **60s tick gated on free capacity**,
  not re-polling on every slot-free. Fewer `gh` calls, simpler control flow, at the
  cost of a freed slot idling up to ~60s before refill.
- **Merge-failure bounce-back to Reviewer vs. straight to `ready-for-human`.** Chosen:
  straight to **`ready-for-human`** — one escape hatch for every terminal path rather
  than an auto-retry loop that could ping-pong.

## Consequences

- **At-least-once dispatch, not exactly-once.** On process crash/restart the
  In-flight set is empty but GitHub still shows artifacts, so a mid-review draft PR
  gets a **second** Reviewer (harmless under ADR-0003 Model A — it just
  re-reviews/re-commits). No issue is ever lost; work can be duplicated. Accepted;
  no durable in-flight store for now. Orphaned sandboxes/worktrees from killed
  agents are left for `Prune` (ADR-0004).
- **`MAX_ITERATIONS` is gone** and `MAX_PARALLEL = 3` becomes the Pool size `10`
  spanning all three roles (previously bounded only Implement+Review).
- **Reviewers/Mergers pay full install+build** per run (see above).
- **Revises ADR-0003:** the "Reviewer reuses the Implementer's sandbox in the same
  pass" mechanism no longer holds; the PR contract (draft → reviewed + ready →
  merged) is unchanged and is exactly what the Dispatch buckets key off.
- **`plan-prompt.md` barely changes** — the Planner's contract (analyze
  `ready-for-agent`, emit unblocked `sandcastle/issue-N`) is preserved.
