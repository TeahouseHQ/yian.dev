# Plan cache: the orchestrator caches the Planner's emit list and skips the LLM while the ready-set is unchanged

The persistent orchestrator (ADR-0006) re-runs the LLM **Planner** on every
eligible **Poll tick** — its emit list is deliberately **not cached**
("re-plans every eligible tick (accepted cost, for simplicity)"). This ADR pays
down that accepted cost. The orchestrator now keeps a **Plan cache**: the
Planner's last emit list, keyed by a content-hash of the `ready-for-agent`
issue set. While that set is unchanged, the orchestrator dispatches from the
cached list with **zero LLM calls**, and only re-invokes the Planner when the
set actually changes. This **revises** ADR-0006's "emit list is not cached"
decision; nothing else in ADR-0006 changes.

## Why

With `ready-for-agent` issues A, B, C where B and C are **blocked by** A, and A
already dispatched (an Implementer running, then an open draft PR, then review,
then merge):

1. `filterReadyForAgent` drops A (in-flight or open-PR) → `actionable = {B, C}`,
   non-empty.
2. `shouldRunPlanner({B,C}, free>0)` is `true` — it only checks that the
   actionable set is non-empty and a slot is free; it cannot see _why_ the set
   is non-empty.
3. The Planner re-queries `gh issue list --label ready-for-agent`, sees the full
   `{A, B, C}` (A **keeps** `ready-for-agent` and stays `open` its whole
   lifecycle), correctly reasons B and C are blocked by A, and emits **A** — the
   only unblocked issue (see plan-prompt.md: when everything is blocked it still
   emits the single highest-priority candidate, so the emit is essentially never
   empty).
4. The orchestrator filters the emitted A out (in-flight / open-PR) and
   dispatches nothing.

That is a full Opus Planner Session producing an undispatchable plan, repeated
**every ~60s for the entire lifetime of A's Run** (implement → review → merge).
The stated goal of the ADR-0006 Planner gate — "don't spend Opus on a plan we
can't dispatch" — is defeated in exactly this shape.

## The load-bearing invariant this must not break

The design's correctness rests on a currently-undocumented invariant:

> An in-flight or open-PR `ready-for-agent` issue **retains its
> `ready-for-agent` label and stays `open`** through its whole Run
> (implement → review → merge). Only merging (which closes the issue) or a
> terminal `ready-for-human` escalation removes it from the Planner's query.

This is what keeps the Planner _seeing_ A while A is in flight, so it correctly
concludes B is blocked. Any "optimization" that strips `ready-for-agent` the
moment A is dispatched would make the Planner stop seeing A, conclude B is
**unblocked**, and **misdispatch blocked work** onto a conflicting branch. The
Plan cache is therefore **purely additive** — a gate placed _before_ the Planner
call. It never touches labels; when the Planner does run, it still receives the
full `{A, B, C}` and reasons exactly as before.

## Decision — the Plan cache

The orchestrator keeps one in-memory value beside the **In-flight set**:

```
plan cache = { key: string, emit: EmittedIssue[] } | null
```

- **`emit`** is the Planner's last output `U` — the unblocked issues it emitted
  (`{number, title, branch}`), _only_ the emit list. The blocking edges stay
  internal to the Planner's reasoning; the orchestrator never needs to know
  _who_ blocks _whom_, only _which_ issues are safe to start.
- **`key`** is a content-hash of the **Planner's input set** — the raw
  `gh issue list --state open --label ready-for-agent` result — as
  `hash(sorted [(number, updatedAt)])`. GitHub bumps an issue's `updatedAt` on
  any edit, comment, or label change, so the key changes on **any** add/remove
  of a `ready-for-agent` issue or **any** content change the Planner reasons
  over. In-flight/PR state is **not** in the key.

Each Poll tick, at the implement stage (after the merge and review buckets have
drained their slots, per ADR-0006's priority drain), when actionable issues
exist and a slot remains:

1. Compute `key` from the **raw** `readyForAgent` query result (before
   `filterReadyForAgent`).
2. **Cache hit** (`key === cache.key`): dispatch from `cache.emit` with **no
   Planner call**. `dispatchable = emit − in-flight − open-PR`; `pickImplementers`
   caps it at the free slots. Usually empty (the waste case: `emit = {A}`, A
   in-flight → nothing) — but not always (see starvation below).
3. **Cache miss** (no cache, or `key` changed): run the Planner, store
   `{ key, emit }`, then dispatch as in step 2.

The Planner LLM therefore runs **only when the `ready-for-agent` set's content
changes** — a new issue labeled in, one merged/closed out, or a body/label/comment
edit — never on a pure Poll tick where nothing moved.

### Why the key hashes the raw set, not `actionable`

The cached `emit` is the unblocked subset of the Planner's **input** — the full
`ready-for-agent` open set `{A, B, C}` — so its validity depends on that set,
not on the post-filter `actionable` (`{B, C}`). Keying on `actionable` would go
stale silently: when A **merges**, A leaves the Planner's query so `emit` should
be recomputed, yet `actionable` can stay `{B, C}` (B, C unchanged), the key
wouldn't move, and the orchestrator would keep serving a stale `emit = {A}`.
Hashing the raw set makes A's merge (issue closes → leaves the query) flip the
key and force a re-plan, which is exactly when B and C become unblocked.

### Cache hits still dispatch — they do not skip dispatch

The gate skips the **LLM call**, not the dispatch. This is load-bearing and is
where naïve "skip the Planner when inputs are unchanged" memoization is _wrong_:

> `emit = {A, D, E}` (three independent unblocked issues), only **1** free slot.
> Tick 1 dispatches A; `pickImplementers` caps at 1, dropping D and E _this
> tick_. Tick 2: ready-set unchanged → cache hit. If we _skipped dispatch_, D
> and E would **starve** despite free slots. Instead we re-run
> `pickImplementers` over the cached `emit`, dispatch D and E, still **no Opus**.

Today's every-tick Planner avoids this starvation only by paying the full LLM
cost each tick. The Plan cache keeps the correctness and drops the cost.

## Considered options

- **Naïve memoization — "skip the Planner if inputs are unchanged."**
  _Rejected._ Skipping _dispatch_ starves capped-but-unblocked issues (above).
  The fix — skip the LLM but still dispatch from the cached emit — is the design
  above.
- **Key on ready-set + In-flight set** (the shape first sketched). _Rejected._
  Including in-flight re-fires the Planner every time A flips
  Implementer → Reviewer → Merger, because those flips churn the in-flight set
  while the ready-set is unchanged — leaving most of the waste on the table.
  Keying on ready-set content only, and checking in-flight/open-PR _live_ each
  tick (both already queried), eliminates waste across A's **entire** Run.
- **Key on issue numbers only** (no `updatedAt`). _Rejected._ The Planner
  reasons over issue **body and comments**; an edit that changes the dependency
  structure must re-plan. `updatedAt` is the cheap content marker that captures
  it without fetching bodies into the key.
- **Cache the full blocking graph, orchestrator reasons over edges.**
  _Rejected as unnecessary._ The dispatch decision needs only "which issues are
  safe to start" = the emit list. Edges would add a shared structure with an
  update protocol (staleness, crash-before-write) for no dispatch benefit; the
  whole-set content-hash is a conservative, correct staleness signal without
  them.
- **Durable cache (local file / GitHub).** _Rejected._ Consistent with ADR-0006's
  in-memory In-flight philosophy, the Plan cache is **in-memory and
  non-durable**. On process restart it is cold, so the first eligible tick
  re-plans once — at-least-once, harmless, no external store.

## Consequences

- **Opus Planner Sessions drop from one-per-eligible-tick to one-per-ready-set-change.**
  For the motivating case (A blocking B, C through a full implement→review→merge
  Run of, say, 20+ ticks), that is one Planner Session instead of 20+. This
  supersedes the grilling-session scope of "in-flight only": because the
  `ready-for-agent` set is identical across all of A's phases (A keeps its label
  and stays open), the cached emit stays valid across the **entire** Run for
  free — no extra code narrows it back, and B genuinely stays blocked until A
  lands on `main`.
- **No new starvation and no new misdispatch.** Cache hits still run the pure
  `pickImplementers` dispatch over the cached emit (no starvation), and the gate
  never strips labels, so the Planner still sees in-flight blockers and never
  misdispatches blocked work (invariant above).
- **`queryReadyForAgent` must fetch `updatedAt`.** It currently requests
  `number,title,labels`; the key needs `updatedAt` added to the `--json` fields
  and to the `ReadyForAgentIssue` shape. `title`/`branch` on the cached emit are
  unaffected.
- **Restart re-plans once.** Cold cache after a crash/restart → one Planner
  Session on the first eligible tick, then steady state. Accepted.
- **Caching an LLM output does not add a correctness risk.** Reusing the prior
  emit for an unchanged input is _more_ consistent than re-rolling the Planner;
  a wrong emit is a pre-existing Planner risk, not one the cache introduces.
- **Two-query race is accepted, as elsewhere in ADR-0006.** The key comes from
  the orchestrator's `queryReadyForAgent`; the Planner re-queries independently.
  If the set changes between the two, the cache self-corrects on the next tick.

## Implementation notes (non-binding)

- The gate belongs in `dispatch.mts` as pure/injectable functions with unit
  tests in `dispatch.test.mts` (mirroring `shouldRunPlanner`, `pickImplementers`):
  e.g. a `planCacheKey(readyForAgentIssues)` producing the stable hash, and a
  predicate that, given the current key and the cache, returns either
  "reuse cached emit" or "re-plan". The cache value itself lives in `main.mts`
  beside the In-flight set (like `inflight`), not in the pure layer.
- The dispatch from a cache hit reuses the **existing** `pickImplementers` +
  `openPrIssues`/`inflight` filters unchanged — only the _source_ of the emit
  list (cache vs. fresh Planner) differs.
