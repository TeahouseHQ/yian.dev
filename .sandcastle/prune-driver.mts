/**
 * Prune driver — the disk-touching half of `sandcastle:prune`, extracted from
 * `prune.mts` so the Cockpit Maintenance tab (issue #83) reuses the *same*
 * discovery and apply as the CLI instead of forking them (ADR-0009).
 *
 * `prune-plan.mts` holds the pure categorization (`planPrune`); this module is
 * its imperative bookends:
 *
 *   - {@link discoverPruneState} reads repo state off disk (git worktrees,
 *     `.sandcastle/logs/*.log`, merged + Merger `sandcastle/*` branches) into the
 *     `PruneState` that `planPrune` consumes, and
 *   - {@link applyPrunePlan} executes an already-computed plan — `rm` the logs,
 *     `git worktree remove` then `git branch -d`/`-D` — reporting each action
 *     through an injected sink so the CLI can print it and the Cockpit can push
 *     it into its event log.
 *
 * Both are side-effectful (`node:child_process` / `node:fs`), so — like the
 * Cockpit's `spawnOrchestrator` wiring — they are left untested; the safety that
 * matters (skip-dirty, merged-only, `sandcastle/*` scope, Merger dedup) lives in
 * the unit-tested pure `planPrune`, and the apply below only carries out what
 * that plan already decided.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

import { type PruneState, type PrunePlan, type WorktreeState } from "./prune-plan.mts";

/** Run a git command, trimmed. `cwd` scopes it to a specific worktree/repo. */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { encoding: "utf8", cwd }).trim();
}

type Worktree = { path: string; branch: string | null };

/** Parse `git worktree list --porcelain` into `{path, branch}` records. */
function listWorktrees(cwd?: string): Worktree[] {
  const out = git(["worktree", "list", "--porcelain"], cwd);
  return out
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
      const branchLine = lines.find((l) => l.startsWith("branch "));
      const branch = branchLine
        ? branchLine.slice("branch ".length).replace("refs/heads/", "")
        : null;
      return path ? { path, branch } : null;
    })
    .filter((w): w is Worktree => w !== null);
}

/** True if `git status --porcelain` in this worktree is non-empty. */
function isDirty(worktreePath: string): boolean {
  return git(["status", "--porcelain"], worktreePath).length > 0;
}

/**
 * Discover the repo state `planPrune` needs, off disk. `cwd` (default: the
 * process cwd) locates the repo — the Cockpit passes its repo root so discovery
 * works regardless of where the Cockpit was launched. Mirrors what `prune.mts`
 * used to do inline; the categorization (Merger-scratch exclusion, etc.) stays
 * in `planPrune`, this only gathers raw state.
 */
export function discoverPruneState(cwd?: string): PruneState {
  const worktrees = listWorktrees(cwd);
  const repoRoot = worktrees[0].path; // first porcelain entry is the main worktree
  const logsDir = join(repoRoot, ".sandcastle", "logs");

  const runLogs = existsSync(logsDir)
    ? readdirSync(logsDir)
        .filter((f) => f.endsWith(".log"))
        .map((f) => join(logsDir, f))
    : [];

  // Leftover Merger validation branches — their own bucket (force-deleted).
  const mergerBranches = new Set(
    git(["branch", "--list", "sandcastle/merge-*", "--format=%(refname:short)"], cwd)
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b.length > 0)
  );

  // Reachability-gated `sandcastle/*` branches. Scope (`sandcastle/*`) is applied
  // here; the Merger-scratch exclusion is applied inside `planPrune`.
  const mergedBranches = new Set(
    git(["branch", "--merged", "main", "--format=%(refname:short)"], cwd)
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b.startsWith("sandcastle/"))
  );

  // Tag each worktree with its dirty flag — but only for candidates (a non-root
  // worktree whose branch is in the merged or Merger set), so no new `git status`
  // call surfaces or errors on an unrelated worktree.
  const candidateBranches = new Set([...mergedBranches, ...mergerBranches]);
  const worktreeStates: WorktreeState[] = worktrees.map((w) => ({
    path: w.path,
    branch: w.branch,
    dirty:
      w.path !== repoRoot && w.branch !== null && candidateBranches.has(w.branch)
        ? isDirty(w.path)
        : false,
  }));

  return { repoRoot, runLogs, worktrees: worktreeStates, mergedBranches, mergerBranches };
}

/** Where {@link applyPrunePlan} reports each action: `onProgress` for a
 *  completed deletion, `onWarning` for one that could not be carried out. The
 *  CLI maps these to `console.log`/`console.warn`; the Cockpit maps them to its
 *  event log (progress plain, warnings coloured). */
export interface PruneApplySink {
  onProgress(line: string): void;
  onWarning(line: string): void;
}

/** Strip the `repoRoot/` prefix from a path for compact reporting. */
function rel(path: string, repoRoot: string): string {
  return path.replace(repoRoot + "/", "");
}

/**
 * Apply an already-computed prune plan: delete the run logs, then remove each
 * worktree before its branch so the branch ref becomes deletable. Merged
 * branches use `git branch -d` (refuses if git still thinks them unmerged);
 * Merger scratch uses `-D` (its merge commit is unreachable from main but its
 * content already landed via `gh pr merge`). A worktree that fails to remove
 * blocks its branch's deletion (surfaced via `onWarning`) rather than stranding
 * it. This runs only what the plan decided — every safety call was already made
 * by `planPrune`.
 */
export function applyPrunePlan(plan: PrunePlan, repoRoot: string, sink: PruneApplySink): void {
  for (const f of plan.runLogs) {
    rmSync(f, { force: true });
    sink.onProgress(`deleted log  ${rel(f, repoRoot)}`);
  }

  // Remove worktrees first so their branches become deletable.
  const failedWorktreeBranches = new Set<string>();
  for (const w of plan.removableWorktrees) {
    try {
      git(["worktree", "remove", w.path]);
      sink.onProgress(`removed wt   ${rel(w.path, repoRoot)}`);
    } catch (err) {
      failedWorktreeBranches.add(w.branch);
      sink.onWarning(`could not remove worktree ${w.path}: ${firstLine(err)}`);
    }
  }

  for (const b of plan.deletableBranches) {
    if (failedWorktreeBranches.has(b)) continue; // its worktree is still present
    try {
      git(["branch", "-d", b]); // -d (not -D): refuses if git thinks it's unmerged
      sink.onProgress(`deleted br   ${b}`);
    } catch (err) {
      sink.onWarning(`could not delete branch ${b}: ${firstLine(err)}`);
    }
  }

  // Leftover Merger scratch: remove any lingering worktree first, then force-
  // delete the branch (content already landed via `gh pr merge`).
  const failedMergerWorktreeBranches = new Set<string>();
  for (const w of plan.removableMergerWorktrees) {
    try {
      git(["worktree", "remove", w.path]);
      sink.onProgress(`removed wt   ${rel(w.path, repoRoot)}`);
    } catch (err) {
      failedMergerWorktreeBranches.add(w.branch);
      sink.onWarning(`could not remove worktree ${w.path}: ${firstLine(err)}`);
    }
  }

  for (const b of plan.deletableMergerBranches) {
    if (failedMergerWorktreeBranches.has(b)) continue; // its worktree is still present
    try {
      git(["branch", "-D", b]); // -D: throwaway scratch, content already landed
      sink.onProgress(`deleted br   ${b}`);
    } catch (err) {
      sink.onWarning(`could not delete branch ${b}: ${firstLine(err)}`);
    }
  }
}

/** The first line of an error's message — git's chatter is multi-line. */
function firstLine(err: unknown): string {
  return (err as Error).message.split("\n")[0];
}
