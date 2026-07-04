/**
 * `pnpm sandcastle:prune` — reclaim disk and tidy git after Sandcastle runs.
 *
 * Prunes four things, and deliberately NOT a fifth:
 *
 *   1. Run logs   — `.sandcastle/logs/*.log`. Lossy, `TextDeltaBuffer`-fragmented
 *                   Display output (glossary: "Run log"). Safe to delete.
 *   2. Worktrees  — `.sandcastle/worktrees/<wt>` whose branch is merged into main.
 *                   Throwaway sandboxes; removed only once their work has landed.
 *   3. Branches   — local `sandcastle/*` branches merged into `main`.
 *   4. Merger scratch — leftover `sandcastle/merge-*` branches (and any lingering
 *                   worktree) left by the Merger's ISOLATED test-merge
 *                   (branchStrategy "branch" in main.mts). Their merge commit's
 *                   content already lands on main via `gh pr merge`, but the
 *                   branch tip is never reachable from main — so unlike (3) they
 *                   are force-deleted (`-D`), not gated on `--merged main`. Still
 *                   `sandcastle/*`-scoped and worktree-safe (dirty ones skipped).
 *
 *   NOT pruned: Transcripts (`.sandcastle/sessions/**.jsonl`) and the Manifest.
 *   Per ADR-0001 those are the durable, auditable source of truth — `prune`
 *   never touches them (glossary: "Transcript").
 *
 * This file is the **CLI driver**: it discovers repo state off disk, hands it
 * to the pure `planPrune` (in `prune-plan.mts`, issue #79) to categorize, then
 * prints the plan (dry run) or applies it (`--force`). The categorization —
 * skip-dirty, merged-only, `sandcastle/*` scope, Merger-scratch dedup — lives in
 * `planPrune` so the future Cockpit Maintenance tab reuses the same plan
 * (ADR-0009) without forking the logic.
 *
 * Design decisions (see ADR-0004):
 *   - "merged" means reachable from `main` (`git branch --merged main`). This
 *     preserves branches whose PRs were intentionally left open for a human
 *     (ADR-0003), since their tips are NOT yet on main.
 *   - Scope is `sandcastle/*` only — never `main` or hand-made branches.
 *   - Local only — remote branches are left to GitHub's delete-on-merge.
 *   - Dry-run by default. Pass `--force` (or `--yes`) to actually delete.
 *   - A merged branch whose worktree has uncommitted changes is SKIPPED with a
 *     warning — never force-removed. Surprise local edits are not eaten.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

import { planPrune, type WorktreeState } from "./prune-plan.mts";

const APPLY = process.argv.slice(2).some((a) => a === "--force" || a === "--yes");

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { encoding: "utf8", cwd }).trim();
}

type Worktree = { path: string; branch: string | null };

function listWorktrees(): Worktree[] {
  const out = git(["worktree", "list", "--porcelain"]);
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

function isDirty(worktreePath: string): boolean {
  return git(["status", "--porcelain"], worktreePath).length > 0;
}

// ── Discover the state ──────────────────────────────────────────────────────

const worktrees = listWorktrees();
const repoRoot = worktrees[0].path; // first porcelain entry is the main worktree
const logsDir = join(repoRoot, ".sandcastle", "logs");

const runLogs = existsSync(logsDir)
  ? readdirSync(logsDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => join(logsDir, f))
  : [];

// Leftover Merger validation branches — their own bucket (force-deleted below).
const mergerBranches = new Set(
  git(["branch", "--list", "sandcastle/merge-*", "--format=%(refname:short)"])
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
);

// Reachability-gated `sandcastle/*` branches. Scope (`sandcastle/*`) is applied
// here; the Merger-scratch exclusion is applied inside `planPrune` (it is the
// "merger is its own bucket" categorization decision, not discovery).
const mergedBranches = new Set(
  git(["branch", "--merged", "main", "--format=%(refname:short)"])
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("sandcastle/"))
);

// Tag each worktree with its dirty flag — but only for candidates (a non-root
// worktree whose branch is in the merged or Merger set). `isDirty` runs on the
// same worktrees as before — never on the repo root or a non-candidate — so no
// new `git status` call can surface or error. (It now runs once per candidate
// rather than the original's twice; `isDirty` is a pure read, so plan output is
// unchanged.)
const candidateBranches = new Set([...mergedBranches, ...mergerBranches]);
const annotatedWorktrees: WorktreeState[] = worktrees.map((w) => ({
  path: w.path,
  branch: w.branch,
  dirty:
    w.path !== repoRoot && w.branch !== null && candidateBranches.has(w.branch)
      ? isDirty(w.path)
      : false,
}));

// ── Plan (pure) ─────────────────────────────────────────────────────────────

const plan = planPrune({
  repoRoot,
  runLogs,
  worktrees: annotatedWorktrees,
  mergedBranches,
  mergerBranches,
});

// ── Report the plan ─────────────────────────────────────────────────────────

const tag = APPLY ? "" : " (dry run)";
console.log(`\nSandcastle prune${tag}\n`);

console.log(`Run logs to delete (${plan.runLogs.length}):`);
plan.runLogs.forEach((f) => console.log(`  - ${f.replace(repoRoot + "/", "")}`));
if (plan.runLogs.length === 0) console.log("  (none)");

console.log(`\nMerged worktrees to remove (${plan.removableWorktrees.length}):`);
plan.removableWorktrees.forEach((w) =>
  console.log(`  - ${w.path.replace(repoRoot + "/", "")} [${w.branch}]`)
);
if (plan.removableWorktrees.length === 0) console.log("  (none)");

console.log(`\nMerged sandcastle branches to delete (${plan.deletableBranches.length}):`);
plan.deletableBranches.forEach((b) => console.log(`  - ${b}`));
if (plan.deletableBranches.length === 0) console.log("  (none)");

console.log(`\nLeftover Merger worktrees to remove (${plan.removableMergerWorktrees.length}):`);
plan.removableMergerWorktrees.forEach((w) =>
  console.log(`  - ${w.path.replace(repoRoot + "/", "")} [${w.branch}]`)
);
if (plan.removableMergerWorktrees.length === 0) console.log("  (none)");

console.log(`\nLeftover Merger branches to force-delete (${plan.deletableMergerBranches.length}):`);
plan.deletableMergerBranches.forEach((b) => console.log(`  - ${b}`));
if (plan.deletableMergerBranches.length === 0) console.log("  (none)");

if (plan.skippedDirtyWorktrees.length > 0) {
  console.log(`\n⚠ Skipped — worktree has uncommitted changes (branch kept too):`);
  plan.skippedDirtyWorktrees.forEach((w) =>
    console.log(`  - ${w.path.replace(repoRoot + "/", "")} [${w.branch}]`)
  );
}

if (!APPLY) {
  console.log(`\nNothing deleted. Re-run with --force to apply.\n`);
  process.exit(0);
}

// ── Apply ───────────────────────────────────────────────────────────────────

console.log("\nApplying...\n");

for (const f of plan.runLogs) {
  rmSync(f, { force: true });
  console.log(`  deleted log  ${f.replace(repoRoot + "/", "")}`);
}

// Remove worktrees first so their branches become deletable.
const failedWorktreeBranches = new Set<string>();
for (const w of plan.removableWorktrees) {
  try {
    git(["worktree", "remove", w.path]);
    console.log(`  removed wt   ${w.path.replace(repoRoot + "/", "")}`);
  } catch (err) {
    failedWorktreeBranches.add(w.branch);
    console.warn(
      `  ⚠ could not remove worktree ${w.path}: ${(err as Error).message.split("\n")[0]}`
    );
  }
}

for (const b of plan.deletableBranches) {
  if (failedWorktreeBranches.has(b)) continue; // its worktree is still present
  try {
    git(["branch", "-d", b]); // -d (not -D): refuses if git thinks it's unmerged
    console.log(`  deleted br   ${b}`);
  } catch (err) {
    console.warn(`  ⚠ could not delete branch ${b}: ${(err as Error).message.split("\n")[0]}`);
  }
}

// Leftover Merger scratch: remove any lingering worktree first, then force-
// delete the branch. `-D` (not `-d`) is intentional — the merge commit is not
// reachable from main, but its content already landed via `gh pr merge`, so
// there is nothing to lose.
const failedMergerWorktreeBranches = new Set<string>();
for (const w of plan.removableMergerWorktrees) {
  try {
    git(["worktree", "remove", w.path]);
    console.log(`  removed wt   ${w.path.replace(repoRoot + "/", "")}`);
  } catch (err) {
    failedMergerWorktreeBranches.add(w.branch);
    console.warn(
      `  ⚠ could not remove worktree ${w.path}: ${(err as Error).message.split("\n")[0]}`
    );
  }
}

for (const b of plan.deletableMergerBranches) {
  if (failedMergerWorktreeBranches.has(b)) continue; // its worktree is still present
  try {
    git(["branch", "-D", b]); // -D: throwaway scratch, content already landed
    console.log(`  deleted br   ${b}`);
  } catch (err) {
    console.warn(`  ⚠ could not delete branch ${b}: ${(err as Error).message.split("\n")[0]}`);
  }
}

console.log("\nDone.\n");
