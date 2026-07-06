# Deterministic Landing: no Merger agent; a Conflict resolver handles failed landings

ADR-0011 reduced the Merger to validate-and-report — and that reduction proved
the role away. Its remaining job (`git merge`, typecheck + test,
`gh pr merge --merge`) is a sequence of deterministic commands with exit
codes; there is no semantic judgment left for an LLM. The merge phase becomes
the **Landing**: fully scripted orchestrator code running in a fresh sandbox,
spending zero tokens on the clean path. When a Landing fails — a textual
conflict _or_ a red suite after a clean merge — the orchestrator dispatches a
new agent role, the **Conflict resolver**, which fixes the branch and routes
it back through review. This supersedes ADR-0006's "the Merger is a landing
role, not a fixing role": fixing returns, but in a dedicated role with a
re-review safety net, restoring the design's original intent for the merge
phase.

## The Landing

For a ready + `reviewed` PR (the ready-for-merge Dispatch bucket, unchanged),
the orchestrator occupies one Pool slot and runs, in a fresh sandbox worktree
based on `origin/main` (ADR-0013):

1. merge the PR branch,
2. `pnpm typecheck && pnpm test`,
3. on green: `gh pr merge --merge` — logged as a Live feed event.

No prompt, no agent, no Outcome. merge-prompt.md is deleted. A Landing still
occupies a full Pool slot — the sandbox lifecycle (create → install → build →
validate → dispose) is the cost being limited, not the agent.

## The Conflict resolver

A failed Landing dispatches the Conflict resolver — one role for both failure
shapes, deliberately without an edge-case taxonomy:

- **Textual conflict** — `git merge` refuses.
- **Semantic conflict** — clean merge, red suite. The PR was green when the
  Reviewer passed it, so red-after-merge almost always means it interacts
  badly with something that landed on `main` since.

In a fresh sandbox the resolver merges `origin/main` **into the PR branch**,
resolves conflicts and/or integration breakage until the suite is green,
pushes, and reports an Outcome (ADR-0011). On pass, the orchestrator strips
`reviewed` and reverts the PR to draft — the resolved branch re-enters the
ready-for-review bucket, so **every resolution is re-reviewed before it can
land**. On give-up (or a missing Outcome), the standard ADR-0011 handling
applies.

Resolver dispatches are bounded by the Retry budget: each failed Landing
spends one attempt for the issue's merge phase, so a genuinely-defective PR
lands on `ready-for-human` after N attempts instead of ping-ponging
Landing → resolve → review → Landing forever. The "flaky test / defect the
Reviewer missed" case is thereby bounded, not classified.

## Considered options

- **Keep the LLM validator (ADR-0011 as first drafted).** _Rejected._ An
  Opus session per merge to run three deterministic commands is pure token
  waste and reintroduces prompt-compliance risk for the system's
  highest-stakes mutation.
- **Deterministic Landing, no resolver — conflicts escalate to a human.**
  _Rejected, but narrowly._ The Planner already serializes issues that would
  touch overlapping files, so conflicts are rare by design; escalation would
  be defensible. The resolver was chosen because the most common failure (an
  upstream rename breaking a just-reviewed branch) is exactly what an agent
  fixes reliably in one pass, and the re-review loop plus Retry budget cap
  the downside.
- **Resolver for textual conflicts only; red-after-clean-merge escalates.**
  _Rejected._ Splits one recovery path into two for a distinction the Retry
  budget already bounds, and sends the most automatable semantic case to a
  human.
- **Resolver for semantic failures only when the red area overlaps files
  changed on main since branching.** _Rejected._ Requires diff-analysis
  machinery to make a distinction the budget already bounds.

## Consequences

- The clean merge path — the overwhelming majority under Planner
  serialization — costs zero tokens and cannot be mis-executed by an agent.
- ADR-0006's "landing role, not a fixing role" is superseded for the merge
  phase; the give-up-on-conflict path in merge-prompt.md disappears along
  with the prompt itself.
- A new prompt (conflict resolution) and a new Session phase enter the
  Manifest, Live feed, and Session browser; the Run's lifecycle becomes
  implement → review → land, with an optional resolve → re-review → land loop.
- Bucket semantics are unchanged: ready + `reviewed` still means "eligible to
  land"; the resolver's strip-`reviewed`/re-draft transition reuses the
  ADR-0011 PR-shaped transition runner and its ordering rule.
- The Reviewer re-reviews resolutions, so a bad conflict resolution cannot
  land unexamined — the quality gate that made agent-side conflict-fixing
  acceptable.
