# yian.dev — sandcastle loop

The automated agent loop (`.sandcastle/main.mts`) that picks up `ready-for-agent` issues, implements them on isolated branches, and lands them on `main`. This glossary covers only the concepts specific to that loop. General programming terms (worktree, branch, fast-forward) don't belong here.

## Language

**Iteration**:
One pass of the outer loop in `main.mts` (up to 10 per run): plan → implement/review in parallel → merge → publish. Boundaries between iterations are the only points where `origin/main` is mutated.

**Phase**:
A named stage within an iteration. Phases 1–3 (Plan, Execute/Review, Merge) are agent-driven; Phase 3.5 (Publish) is deterministic orchestrator code.

**Merger**:
The Phase 3 agent that resolves conflicts across branches and makes a single summary commit on `main`. It does **not** close issues — it emits a close-list for the orchestrator to discharge post-push.

**Close-list**:
The set of issues (and PRDs judged complete) the Merger declares should be closed, emitted as a structured tag. Discharged by the orchestrator only after a successful publish.

**Publish**:
The Phase 3.5 step that pushes host `main` to `origin/main`. Conditional on Gate 4 passing. Only point in the loop that mutates `origin/main`.

_Avoid_: push (use "publish" — push is the mechanism, publish is the phase), deploy (that's Vercel, not sandcastle)

**Gate 4**:
The publish precondition: every branch in the iteration must be an ancestor of local `main`, the working tree must be clean, and `pnpm typecheck && pnpm test` must pass on the merged tree.

_Avoid_: "the gate" (be specific — there's only one gate, but the number is load-bearing because it's the strictest of four considered options)
