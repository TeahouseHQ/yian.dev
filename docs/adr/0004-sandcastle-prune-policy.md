# `sandcastle:prune` reclaims disk and tidies git, but never deletes the audit trail

After a series of Runs the repo accumulates throwaway state: lossy **Run logs**
(`.sandcastle/logs/*.log`), per-issue **worktrees** (`.sandcastle/worktrees/`),
and merged `sandcastle/issue-*` branches. `pnpm sandcastle:prune`
(`.sandcastle/prune.mts`) cleans these up. The decisions that shape it:

## What it prunes — and what it deliberately doesn't

- **Run logs: deleted.** They are lossy, `TextDeltaBuffer`-fragmented Display
  output (glossary: _Run log_) and reconstructable only as a worse version of
  the Transcript. Disposable.
- **Transcripts and the Manifest: never touched.** Per ADR-0001 the captured
  session JSONL is the durable, full-fidelity **audit source of truth**, and the
  Manifest is its index. Pruning either would defeat the reason they were
  promoted to durable artifacts. The original request said "delete session
  transcripts," but that contradicted their stated purpose, so prune keeps them.
  This is the central boundary of the command.

## "Merged" means reachable from `main`

The merge gate is `git branch --merged main`, i.e. local reachability — not
GitHub PR state. This is the correct gate **because** of ADR-0003: un-approved
PRs are intentionally left open for a human, and their branch tips are therefore
**not** on `main`, so `--merged` preserves them automatically. A branch only
becomes prunable once its work has actually landed.

Confirmed against live state: `sandcastle/issue-38` (open) is preserved while
`sandcastle/issue-55` (merged) is pruned, worktree and all.

## Scope, locality, and safety

- **Scope is `sandcastle/*` only.** Prune never deletes `main` or any
  hand-created branch, even if technically merged.
- **Local only.** Remote branches are left to GitHub's delete-on-merge; prune
  never runs `git push --delete`. (Keeps the token surface and the blast radius
  small — consistent with ADR-0003's posture on credentials.)
- **Dry-run by default.** Bare `pnpm sandcastle:prune` prints the plan and
  deletes nothing; `--force` (or `--yes`) is required to act. This is `rm` and
  `git branch -d` territory, so the safe default is to show, not do.
- **Worktree-before-branch ordering.** A branch checked out in a worktree can't
  be deleted, so prune removes the (merged) worktree first, then the branch.
- **Dirty worktrees are skipped, never forced.** If a merged branch's worktree
  has uncommitted changes, prune skips both the worktree and the branch and
  warns. It never passes `--force` to `git worktree remove`. Surprise local
  edits are not eaten.

## Consequences

- Branch deletion uses `git branch -d` (not `-D`), so git's own merge check is a
  second line of defence behind the `--merged` query.
- A worktree whose `git worktree remove` fails (lock, race) leaves its branch in
  place that run; the next prune retries.
- If the workflow ever adopts squash-merge, `--merged` reachability would no
  longer hold and this gate would need revisiting (it currently relies on
  ADR-0003's `--merge` merge commits keeping branch tips reachable).
