# The orchestrator tracks origin/main, not local refs — and follows it through its own upgrades

Investigation for ADR-0011/0012 uncovered that the whole pipeline silently
depends on the human keeping the host checkout fresh. Nothing in the
orchestrator or the sandcastle worktree layer ever updates the base the
system builds on: a **new** `sandcastle/issue-N` branch is forked from
**`HEAD` of the host checkout** (no `baseBranch` is passed, and sandcastle
defaults to `HEAD` — if the human happens to have a feature branch checked
out when the tick fires, the Implementer forks from _that_); merge validation
runs against **local `main`**, which falls behind after every server-side
`gh pr merge`; and Prune's merged-branch gate reads local `main` too. The
only fetch anywhere is a same-branch fast-forward when reusing an existing
worktree. This ADR removes the dependence on local refs entirely, and — since
the orchestrator then notices its own code changing upstream — defines how a
running orchestrator follows its own upgrades.

## Decision

**Origin-tracking.** The orchestrator runs `git fetch origin` once per Poll
tick (cheap, safe, never touches the human's working tree or local branches).
Everything bases on `origin/main`:

- new issue branches fork from `origin/main`, never from `HEAD`;
- the Landing (ADR-0012) validates the merge against `origin/main` — the
  same base it will actually land on server-side;
- the Conflict resolver merges `origin/main` into the PR branch;
- Prune's merged-reachability gate uses `origin/main`.

Local `main` and the working tree become purely the human's business; the
orchestrator never reads or mutates them.

**Self-restart.** When a fetched `origin/main` commit touches the
orchestrator's own code, the orchestrator **drains and exits**: it stops
dispatching, lets in-flight Sessions finish, then exits with a distinct exit
code. The Cockpit supervisor (ADR-0008) recognizes that code and restarts the
child on the new code; headless runs get a shell-level restart wrapper.

The restart is benign by design: after a drain the empty In-flight set is
_accurate_, the Plan cache re-plans once (ADR-0010's accepted cold-start),
and Retry budgets reset (ADR-0011's accepted worst case of extra attempts).

## Why self-restart matters (the old-code/new-prompt wedge)

Prompts are read from each Session's worktree — the _branch's_ version —
while the orchestrator's own `.mts` code is loaded once at process start. The
ADR-0011 migration makes the mismatch concrete: an old orchestrator
dispatching a Reviewer whose branch carries the new Outcome-tag prompt waits
forever for label flips the agent no longer performs — the PR stays draft,
re-dispatches every tick, and the old code has no Retry budget to stop it. A
loop that upgrades itself cannot stay AFK if its upgrades wedge it.

## Considered options

- **Orchestrator pulls local `main` after each landing.** _Rejected._
  Mutates the human's checkout under their feet (this is a live development
  machine); `--ff-only` fails or moves the working tree depending on state.
  Fetch + `origin/main` basing gets the same freshness with zero contact
  with the human's refs.
- **Surface staleness, human restarts** (Cockpit banner + restart action).
  _Rejected as the primary mechanism._ An unattended loop keeps running
  stale code through exactly the longest AFK stretches; kept as a natural
  byproduct (the drain emits events the Cockpit shows).
- **Restart-on-any-main-change** (not just orchestrator code). _Rejected._
  Unnecessary — Sessions already pick up fresh product code via
  `origin/main`-based worktrees; only the orchestrator process itself goes
  stale.

## Consequences

- Validation base = landing base: test-then-merge results become meaningful
  again after the first server-side merge of a run.
- Implementer forks no longer depend on what the human has checked out.
- Prune stops missing merged branches when local `main` is behind.
- One bootstrap caveat: the detection itself lands via this phase, so the
  phase's own merges still need one manual restart — the last one.
