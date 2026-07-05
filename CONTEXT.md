# yian.dev

A personal portfolio/blog site. This glossary covers the **Sandcastle observability** subsystem — the AFK agentic workflow (`.sandcastle/`) and how its work is made visible and auditable — and **Blog reader theming**, the light/dark switching on post pages.

## Language

### Sandcastle observability

**Transcript**:
The durable, full-fidelity record of a single agent's work, sourced from the captured session JSONL (every thinking block, tool call with inputs, tool result, and token usage). The auditable source of truth.
_Avoid_: log, session log.

**Live feed**:
The real-time, glanceable view of what the orchestrator is doing right now: a single **structured event stream** the orchestrator emits (dispatch, resolved, pool-full, planner-emitted, …), with two renderers — a prose formatter for headless `sandcastle` runs and the Cockpit's live widgets. Optimized for "is it stuck / what is it touching," not durability (that's the Manifest).
_Avoid_: stream log, console output, the old "whatever we console.log" meaning.

**Run log**:
Sandcastle's existing human-readable Display output under `.sandcastle/logs/*.log`. Lossy and `TextDeltaBuffer`-fragmented. Distinct from a Transcript; left as-is. Disposable — deleted by Prune.
_Avoid_: transcript.

**Prune**:
The `pnpm sandcastle:prune` maintenance command (`.sandcastle/prune.mts`) that reclaims throwaway state after Runs: deletes Run logs, removes merged worktrees, and deletes local `sandcastle/*` branches merged into `main`. Dry-run by default; `--force` to apply. Never touches Transcripts or the Manifest — the audit trail is out of scope by design (ADR-0004).
_Avoid_: clean, gc.

**Session**:
A single pi agent invocation, identified by a session id, whose Transcript is captured as one JSONL file. One per agent run (Planner, Implementer, Reviewer, Merger).

**Cockpit**:
The single Ink TUI that consolidates the Sandcastle surfaces into tabbed modes — **Live** (monitor the orchestrator: status/Start-Stop, pool gauge, in-flight list, event log), **Sessions** (the Session browser embedded as a tab), **Maintenance** (guarded Prune). It launches idle and **supervises the orchestrator as a child process** (not in-process), starting/stopping it on demand and rendering its structured Live feed. Headless `sandcastle` (no Cockpit) still runs the orchestrator loop directly.
_Avoid_: dashboard, launcher, menu.

**Session browser**:
The interactive terminal UI (Ink, run via `tsx`) for navigating recent Runs and their Sessions from the Manifest and reading their Transcripts. Mounted both standalone (`sandcastle:browse`) and as the Cockpit's Sessions tab. Local-only, read-once (manual reload), post-hoc — the audit companion to the real-time Live feed. Two-pane: a run→session tree plus a full-screen Transcript pager. Distinct from `render-transcript`, the one-shot scriptable CLI over the same core.
_Avoid_: viewer, dashboard, monitor.

**Run**:
One issue's **full lifecycle** through the pool — its Implementer, Reviewer, and Merger Sessions — identified by a `runId` derived deterministically from the issue number (mirrors the `sandcastle/issue-N` branch). Auditing everything that happened to an issue is a single `runId` lookup. The Planner is cross-issue and does **not** belong to any issue's Run; its Sessions are recorded per-invocation with no issue binding. Distinct from sandcastle's `run()` API call, which is one agent invocation. Supersedes the old "one outer loop iteration" meaning (ADR-0006).
_Avoid_: iteration, cycle (a Poll tick is not a Run).

**Pool**:
The single shared concurrency limiter (size 10) across **all** Implementer, Reviewer, and Merger Sessions. One slot = one agent run **including** its whole sandbox lifecycle (create → install → build → run → dispose). The Planner runs in its own dedicated singleton slot and is **not** counted against the Pool. Introduced by the persistent shared-pool orchestrator (ADR-0006), replacing the old per-Run `MAX_PARALLEL` that bounded only Implement+Review.
_Avoid_: queue, thread pool.

**Dispatch bucket**:
One of the three sources of pooled work the orchestrator drains each Poll tick, in priority order **merge → review → implement**: **ready-for-merge** (PR is ready/non-draft + `reviewed` label), **ready-for-review** (open **draft** `sandcastle/issue-N` PR without `reviewed`), and **ready-for-agent** (issue labeled `ready-for-agent` with no open PR). An item carrying `ready-for-human`, or already in the In-flight set, is excluded from every bucket. Only the ready-for-agent bucket is fed through the Planner; the two PR buckets are dispatched by pure orchestrator code.
_Avoid_: queue, backlog, stage.

**In-flight set**:
The orchestrator's **in-memory** record of which issues/PRs currently have a Session running, keyed by issue/PR number. It is what stops a repeatedly-polling loop from dispatching a second agent for the same item; entries are removed the moment their Session resolves. Not durable — lost on process restart, which yields at-least-once (never at-most-once) dispatch (ADR-0006).
_Avoid_: lock, lease.

**Poll tick**:
One iteration of the persistent orchestrator loop: every ~60s, if the Pool has a free slot, query the Dispatch buckets and fill free slots by priority. When the Pool is full the `gh` query is skipped entirely; when all buckets are empty the tick is the idle sleep. A freed slot idles at most one tick (~60s) before being refilled. A Poll tick is **not** a Run and has no `runId`.
_Avoid_: iteration, run, cycle.

**Plan cache**:
The orchestrator's **in-memory** record of the Planner's last emit list (the unblocked issues `U`), keyed by a content-hash of the `ready-for-agent` issue set — `hash(sorted [(number, updatedAt)])` over the raw `gh issue list --label ready-for-agent` result the Planner reasons over. While the key is unchanged, a Poll tick dispatches from the cached emit with **no Planner (Opus) call**; the Planner is re-invoked only when the key changes (an issue labeled in/out, or a body/label/comment edit). In-flight/PR state is checked live and is **not** in the key, so the cache stays valid across a blocker's whole Run (implement→review→merge). Non-durable — cold after restart (one re-plan), like the In-flight set (ADR-0006, ADR-0010). A cache hit still runs the pure dispatch (`pickImplementers`) over the cached emit, so capped-but-unblocked issues are never starved. Stores only the emit list, not the blocking graph.
_Avoid_: plan graph, dependency graph, Planner memo, memoization.

**Outcome**:
The structured self-report an agent Session ends with — pass, or give-up with a reason — that the orchestrator parses and acts on. The agent judges; the orchestrator mutates. All dispatch-controlling GitHub state transitions (labels, draft flips, the merge itself) are performed by orchestrator code from the reported Outcome, never by the agent running `gh` from prompt instructions (ADR-0011). A Session that resolves without a parseable Outcome is treated as a failed attempt against its Retry budget.
_Avoid_: verdict, result (a Manifest field), status.

**Retry budget**:
The per-issue-per-phase allowance of failed attempts — a crashed Session or one that resolved without a parseable Outcome — before the orchestrator escalates the item to `ready-for-human` with a comment citing the attempts (N=3: one attempt plus two retries). In-memory beside the In-flight set and Plan cache (same non-durability philosophy, ADR-0006/0010); cleared on escalation, so a human re-labeling an issue gets a fresh budget; reset by restart, which at worst grants extra attempts — benign under at-least-once dispatch.
_Avoid_: strike count, attempt counter, backoff.

**`ready-for-human`**:
The universal terminal label — on an issue or a PR — meaning "out of all Dispatch buckets; a human owns it." Every give-up / failure path lands here: a no-op Implementer (strips `ready-for-agent`, adds `ready-for-human`), a Reviewer or Merger whose Outcome is give-up (the Reviewer's PR stays draft; the Merger's PR loses `reviewed` and reverts to draft), and an item whose Retry budget is exhausted. The transitions themselves are applied by orchestrator code acting on the reported Outcome (ADR-0011), in crash-safe order (terminal label added before bucket state is removed). This is what keeps the persistent loop from re-dispatching un-actionable work forever.
_Avoid_: blocked, stuck, wontfix (a distinct triage label).

**Manifest**:
The append-only index of Sessions (`.sandcastle/sessions/manifest.jsonl`), one line per Session, carrying the human-meaningful metadata the raw Transcript filename lacks (run, phase, issue, branch, status, commits, usage). The lookup table that makes Transcripts findable and a Run auditable.
_Avoid_: index, log.

**Pull request (PR)**:
The per-issue review surface on GitHub that makes the Implementer→Reviewer interaction visible and auditable. One PR per issue branch; opened as a draft by the Implementer and reviewed in place by the Reviewer, who marks it ready when it passes. A first-class part of the audit surface alongside the Transcript and Manifest.
_Avoid_: MR, change request.

### Blog reader theming

**Blog reader**:
A single blog-post page at `/posts/[slug]` — the whole page frame (nav, post header, article body, comments, footer), not just the article markdown. The only surface that can be light; every other page (`/home`, `/playnow`, …) is permanently dark.
_Avoid_: post viewer, article view.

**Reader theme**:
The active colour scheme of a Blog reader: `dark` (the site-wide default) or `light`. Applied by toggling a `theme-light` class on `<html>`; the absence of the class means dark.
_Avoid_: mode, colour mode, skin.

**Theme preference**:
The reader's persisted, global choice of Reader theme, stored in `localStorage` under a single key. Applies to all Blog readers and survives reloads and future visits. Dark by default (a first-time visitor's OS `prefers-color-scheme` is ignored). Does not affect any non-post page.
_Avoid_: setting, mode preference.

**Theme toggle**:
The fixed top-corner sun/moon `<button>` rendered only on Blog readers. Flips the Theme preference and re-applies the Reader theme live. On mount it applies the preference; on unmount it reverts to dark, keeping non-post pages dark during client-side navigation.
_Avoid_: switcher, dark mode button.
