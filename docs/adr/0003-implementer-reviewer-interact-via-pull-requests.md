# Implementer and Reviewer interact via Pull Requests

To make the Implementer→Reviewer interaction visible and auditable, the Sandcastle
workflow runs through GitHub **Pull requests** instead of staying entirely local in
branches. The Implementer pushes its `sandcastle/issue-N` branch and opens a **draft**
PR (`Closes #N`); the Reviewer still commits fixes directly to the branch (Model A — the
PR is a visibility container, not a re-implementation loop) and then posts a review and
marks the PR ready. The Merger lands work via `gh pr merge --merge` rather than a local
`git merge`, producing real PR-merge records and auto-closing issues. Every PR targets
`main` directly, matching the Planner's existing guarantee that issues scheduled in one
Run are unblocked and non-overlapping.

## Considered Options

- **Model A (chosen): PR as visibility container.** Reviewer commits fixes directly, as
  it does today, but the work surfaces as a PR with a review object. Smallest change to a
  working orchestrator; no convergence risk from a re-implementation loop.
- **Model B: true review loop.** Reviewer only comments; a second Implementer pass
  addresses feedback. More faithful to a human PR conversation, but adds an iteration
  loop that can ping-pong or fail to converge within `MAX_ITERATIONS`. Rejected for now;
  Model A can evolve into it later.

## The self-approval constraint (why no native "Approved")

GitHub forbids submitting an `APPROVE` or `REQUEST_CHANGES` review on **your own** PR
(`422 "Can not approve your own pull request"`); only `COMMENT` reviews are allowed. A
native green Approved would therefore require the Reviewer to run as a **second GitHub
account** (a collaborator with write access) and a second token threaded through the
sandbox.

We **rejected the two-account setup.** For an AFK pipeline on a personal repo, the native
checkmark adds little over a `COMMENT` review, and a second identity (account, PAT,
collaborator invite, rotation) is real operational overhead. Instead, the Reviewer (same
single `GH_TOKEN`) posts a `COMMENT` review, flips the PR **draft → ready**, and adds a
`reviewed` label. The Merger gates on **ready + `reviewed` label**, leaving un-approved
PRs open for a human. The review conversation is still fully visible and timestamped in
the PR timeline.

**Consequence:** enabling branch protection that _requires_ an approving review would
break this — self-approval cannot satisfy it — and would force the two-account setup.

## Consequences

- **Token scope must widen.** Today's `GH_TOKEN` is Issues (R/W) + Metadata (R) and
  branches are never pushed. PRs need branches pushed to `origin` and a token with
  **Contents (R/W)** + **Pull requests (R/W)**. Update `.sandcastle/.env(.example)` and
  ensure the sandbox git remote is authenticated for push.
- **Merger validates before landing (test-then-merge).** For each approved PR the Merger
  merges it locally, runs the combined `pnpm typecheck && pnpm test`, and only then runs
  `gh pr merge --merge`. This preserves the existing single combined-integration gate —
  nothing red reaches `main` — at the cost of a harmless double-merge.
- **Merge method is `--merge`, not squash.** A merge commit keeps both the Implementer's
  `RALPH:` commits and the Reviewer's `RALPH: Review -` commits on `main`, preserving the
  impl-vs-review distinction in history as well as in the PR. Squash would erase it.
- **Prompts change:** `implement-prompt.md` (push + open draft PR), `review-prompt.md`
  (post `COMMENT` review, mark ready, add `reviewed` label), `merge-prompt.md`
  (`gh pr merge` gated on ready + label). The orchestrator keeps its `commits.length > 0`
  gate, so a no-op Implementer still produces no PR.
