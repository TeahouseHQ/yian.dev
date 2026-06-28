/**
 * `pnpm sandcastle:prune` — reclaim disk and tidy git after Sandcastle runs.
 *
 * Prunes three things, and deliberately NOT a fourth:
 *
 *   1. Run logs   — `.sandcastle/logs/*.log`. Lossy, `TextDeltaBuffer`-fragmented
 *                   Display output (glossary: "Run log"). Safe to delete.
 *   2. Worktrees  — `.sandcastle/worktrees/<wt>` whose branch is merged into main.
 *                   Throwaway sandboxes; removed only once their work has landed.
 *   3. Branches   — local `sandcastle/*` branches merged into `main`.
 *
 *   NOT pruned: Transcripts (`.sandcastle/sessions/**.jsonl`) and the Manifest.
 *   Per ADR-0001 those are the durable, auditable source of truth — `prune`
 *   never touches them (glossary: "Transcript").
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

const mergedBranches = new Set(
  git(["branch", "--merged", "main", "--format=%(refname:short)"])
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("sandcastle/"))
);

// A merged worktree branch must have its worktree removed before the branch can
// be deleted. Dirty worktrees are skipped (and so is their branch).
const mergedWorktrees = worktrees.filter(
  (w) => w.path !== repoRoot && w.branch && mergedBranches.has(w.branch)
);
const dirtyWorktrees = mergedWorktrees.filter((w) => isDirty(w.path));
const removableWorktrees = mergedWorktrees.filter((w) => !isDirty(w.path));

// Branches we will NOT delete: those still checked out in a worktree we are not
// removing (i.e. the dirty ones).
const blockedBranches = new Set(dirtyWorktrees.map((w) => w.branch));
const deletableBranches = [...mergedBranches].filter((b) => !blockedBranches.has(b)).sort();

// ── Report the plan ─────────────────────────────────────────────────────────

const tag = APPLY ? "" : " (dry run)";
console.log(`\nSandcastle prune${tag}\n`);

console.log(`Run logs to delete (${runLogs.length}):`);
runLogs.forEach((f) => console.log(`  - ${f.replace(repoRoot + "/", "")}`));
if (runLogs.length === 0) console.log("  (none)");

console.log(`\nMerged worktrees to remove (${removableWorktrees.length}):`);
removableWorktrees.forEach((w) =>
  console.log(`  - ${w.path.replace(repoRoot + "/", "")} [${w.branch}]`)
);
if (removableWorktrees.length === 0) console.log("  (none)");

console.log(`\nMerged sandcastle branches to delete (${deletableBranches.length}):`);
deletableBranches.forEach((b) => console.log(`  - ${b}`));
if (deletableBranches.length === 0) console.log("  (none)");

if (dirtyWorktrees.length > 0) {
  console.log(`\n⚠ Skipped — worktree has uncommitted changes (branch kept too):`);
  dirtyWorktrees.forEach((w) =>
    console.log(`  - ${w.path.replace(repoRoot + "/", "")} [${w.branch}]`)
  );
}

if (!APPLY) {
  console.log(`\nNothing deleted. Re-run with --force to apply.\n`);
  process.exit(0);
}

// ── Apply ───────────────────────────────────────────────────────────────────

console.log("\nApplying...\n");

for (const f of runLogs) {
  rmSync(f, { force: true });
  console.log(`  deleted log  ${f.replace(repoRoot + "/", "")}`);
}

// Remove worktrees first so their branches become deletable.
const failedWorktreeBranches = new Set<string>();
for (const w of removableWorktrees) {
  try {
    git(["worktree", "remove", w.path]);
    console.log(`  removed wt   ${w.path.replace(repoRoot + "/", "")}`);
  } catch (err) {
    if (w.branch) failedWorktreeBranches.add(w.branch);
    console.warn(
      `  ⚠ could not remove worktree ${w.path}: ${(err as Error).message.split("\n")[0]}`
    );
  }
}

for (const b of deletableBranches) {
  if (failedWorktreeBranches.has(b)) continue; // its worktree is still present
  try {
    git(["branch", "-d", b]); // -d (not -D): refuses if git thinks it's unmerged
    console.log(`  deleted br   ${b}`);
  } catch (err) {
    console.warn(`  ⚠ could not delete branch ${b}: ${(err as Error).message.split("\n")[0]}`);
  }
}

console.log("\nDone.\n");
