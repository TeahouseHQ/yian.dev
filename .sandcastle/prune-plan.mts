/**
 * Pure plan for `sandcastle:prune` (ADR-0004 / issue #79).
 *
 * `prune.mts` used to compute what it *would* delete inline with the deletion.
 * That coupling made the categorization logic (skip-dirty, merged-only,
 * `sandcastle/*` scope, Merger-scratch dedup) untestable and unreachable from
 * anywhere but the CLI. This module holds just the **plan computation** as a
 * pure function over already-discovered state — no `node:child_process`, no
 * `node:fs`, no `process.argv`, no `console.log` — so:
 *
 *   - `pnpm sandcastle:prune` discovers state off disk, calls `planPrune`, then
 *     prints / applies the returned plan (the CLI driver stays in `prune.mts`),
 *   - the future Cockpit Maintenance tab imports `planPrune` to render the same
 *     dry-run preview without forking the logic (ADR-0009).
 *
 * The split mirrors `dispatch.mts` / `observability.mts`: pure/injectable
 * decision logic in its own module, the live driver elsewhere.
 */

/** One git worktree (from `git worktree list --porcelain`) tagged with its
 *  dirty flag so `planPrune` never has to shell out. */
export interface WorktreeState {
  /** Absolute path of the worktree. */
  path: string;
  /** Branch checked out in the worktree, or `null` for detached / none. */
  branch: string | null;
  /** True if `git status --porcelain` in this worktree is non-empty. */
  dirty: boolean;
}

/** Discovered repo state — everything `prune` needs to plan, pre-computed by
 *  the CLI (or Cockpit) so `planPrune` touches no disk. */
export interface PruneState {
  /** Absolute path of the main (first) worktree — the repo root. Never pruned. */
  repoRoot: string;
  /** `.sandcastle/logs/*.log` absolute paths (Run logs; lossy, disposable). */
  runLogs: string[];
  /** All worktrees from `git worktree list`, each tagged with its dirty flag. */
  worktrees: WorktreeState[];
  /** `git branch --merged origin/main` filtered to `sandcastle/*` (reachability-
   *  gated on origin, not stale local `main` — ADR-0013/0004). May include Merger
   *  scratch; `planPrune` moves those into the Merger bucket so they are never
   *  double-counted. */
  mergedBranches: Set<string>;
  /** `sandcastle/merge-*` scratch branches left by the Merger's ISOLATED
   *  test-merge — force-deleted, NOT gated on `--merged main` (their merge
   *  commit is unreachable from main but its content already landed via
   *  `gh pr merge`; ADR-0004). */
  mergerBranches: Set<string>;
}

/** A worktree selected for removal. Always carries a branch by construction. */
export interface PruneWorktree {
  path: string;
  branch: string;
}

/** The categorized set of deletions `prune` would apply. Pure data: the CLI
 *  prints it (dry run) or applies it (`--force`); the Cockpit renders it. */
export interface PrunePlan {
  /** Run logs to `rm`. */
  runLogs: string[];
  /** Merged worktrees to `git worktree remove` (clean only). Removed before
   *  their branches so the branch ref becomes deletable. */
  removableWorktrees: PruneWorktree[];
  /** Merged `sandcastle/*` branches to `git branch -d`. Excludes any branch
   *  whose (dirty) worktree is being kept, and excludes Merger scratch. */
  deletableBranches: string[];
  /** Leftover Merger worktrees to `git worktree remove` (clean only). */
  removableMergerWorktrees: PruneWorktree[];
  /** Leftover Merger scratch branches to `git branch -D` (force). Excludes any
   *  branch whose (dirty) worktree is being kept. */
  deletableMergerBranches: string[];
  /** Dirty worktrees (merged + Merger) — skipped with a warning; their branches
   *  are kept too (ADR-0004: surprise local edits are never eaten). */
  skippedDirtyWorktrees: PruneWorktree[];
}

/**
 * Compute the prune plan from discovered state. Pure: reads nothing, writes
 * nothing, mutates none of its inputs.
 *
 * Categorization (the ADR-0004 safety, in plan form):
 *   - Run logs pass straight through (always deleted).
 *   - A merged worktree (not the repo root, branch in `mergedBranches`) is
 *     removed iff clean; a dirty one is skipped and its branch is blocked from
 *     deletion so the worktree-before-branch ordering can't strand a branch.
 *   - A merged branch is deleted (`-d`) unless blocked by a kept dirty
 *     worktree. Merger scratch is moved out of this bucket — it is force-
 *     deleted (`-D`) in its own bucket below, never double-counted.
 *   - Merger worktrees/branches follow the same clean-vs-dirty split, except
 *     the branch is force-deleted (its commit isn't on main but its content
 *     already landed).
 *   - All dirty worktrees (both buckets) are surfaced once in
 *     `skippedDirtyWorktrees` for the warning.
 */
export function planPrune(state: PruneState): PrunePlan {
  const { repoRoot, runLogs, worktrees, mergedBranches, mergerBranches } = state;

  // Merger scratch is its own bucket (force-delete); pull it out of the
  // reachability-gated set so a branch is never in two buckets at once.
  const mergedScoped = new Set([...mergedBranches].filter((b) => !mergerBranches.has(b)));

  const mergedWorktrees = worktrees.filter(
    (w) => w.path !== repoRoot && w.branch !== null && mergedScoped.has(w.branch)
  );
  const removableWorktrees = mergedWorktrees.filter((w) => !w.dirty);
  const dirtyWorktrees = mergedWorktrees.filter((w) => w.dirty);

  // A merged branch whose dirty worktree we are keeping stays in place.
  const blockedBranches = new Set(dirtyWorktrees.map((w) => w.branch as string));
  const deletableBranches = [...mergedScoped].filter((b) => !blockedBranches.has(b)).sort();

  const mergerWorktrees = worktrees.filter(
    (w) => w.path !== repoRoot && w.branch !== null && mergerBranches.has(w.branch)
  );
  const removableMergerWorktrees = mergerWorktrees.filter((w) => !w.dirty);
  const dirtyMergerWorktrees = mergerWorktrees.filter((w) => w.dirty);

  const blockedMergerBranches = new Set(dirtyMergerWorktrees.map((w) => w.branch as string));
  const deletableMergerBranches = [...mergerBranches]
    .filter((b) => !blockedMergerBranches.has(b))
    .sort();

  const skippedDirtyWorktrees = [...dirtyWorktrees, ...dirtyMergerWorktrees].map(toPruneWorktree);

  return {
    runLogs: [...runLogs],
    removableWorktrees: removableWorktrees.map(toPruneWorktree),
    deletableBranches,
    removableMergerWorktrees: removableMergerWorktrees.map(toPruneWorktree),
    deletableMergerBranches,
    skippedDirtyWorktrees,
  };
}

/** Narrow a `WorktreeState` (already known to have a branch) to a
 *  `PruneWorktree`, dropping the now-irrelevant `dirty` flag. */
function toPruneWorktree(w: WorktreeState): PruneWorktree {
  return { path: w.path, branch: w.branch as string };
}
