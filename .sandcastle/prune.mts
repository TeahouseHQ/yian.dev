/**
 * `pnpm sandcastle:prune` — reclaim disk and tidy git after Sandcastle runs.
 *
 * Prunes four things, and deliberately NOT a fifth:
 *
 *   1. Run logs   — `.sandcastle/logs/*.log`. Lossy, `TextDeltaBuffer`-fragmented
 *                   Display output (glossary: "Run log"). Safe to delete.
 *   2. Worktrees  — `.sandcastle/worktrees/<wt>` whose branch is merged into main.
 *                   Throwaway sandboxes; removed only once their work has landed.
 *   3. Branches   — local `sandcastle/*` branches merged into `origin/main`.
 *   4. Merger scratch — leftover `sandcastle/merge-*` branches (and any lingering
 *                   worktree) left by the Merger's ISOLATED test-merge
 *                   (branchStrategy "branch" in main.mts). Their merge commit's
 *                   content already lands on main via `gh pr merge`, but the
 *                   branch tip is never reachable from main — so unlike (3) they
 *                   are force-deleted (`-D`), not gated on `--merged origin/main`. Still
 *                   `sandcastle/*`-scoped and worktree-safe (dirty ones skipped).
 *
 *   NOT pruned: Transcripts (`.sandcastle/sessions/**.jsonl`) and the Manifest.
 *   Per ADR-0001 those are the durable, auditable source of truth — `prune`
 *   never touches them (glossary: "Transcript").
 *
 * This file is the **CLI front-end**: it calls `discoverPruneState` to read repo
 * state off disk, hands it to the pure `planPrune` (in `prune-plan.mts`, issue
 * #79) to categorize, prints the plan (dry run), and on `--force` hands it to
 * `applyPrunePlan` to delete. Discovery and apply both live in `prune-driver.mts`
 * and the categorization (skip-dirty, merged-only, `sandcastle/*` scope,
 * Merger-scratch dedup) lives in `planPrune`, so the Cockpit Maintenance tab
 * (issue #83) reuses the *same* discover → plan → apply without forking any of
 * it (ADR-0009); only the printing below is CLI-specific.
 *
 * Design decisions (see ADR-0004):
 *   - "merged" means reachable from `origin/main` (`git branch --merged
 *     origin/main`), not stale local `main` — after a server-side `gh pr merge`
 *     local `main` falls behind, so gating on it would miss landed branches
 *     (ADR-0013). This still preserves branches whose PRs were intentionally left
 *     open for a human (ADR-0003), since their tips are NOT yet on origin/main.
 *   - Scope is `sandcastle/*` only — never `main` or hand-made branches.
 *   - Local only — remote branches are left to GitHub's delete-on-merge.
 *   - Dry-run by default. Pass `--force` (or `--yes`) to actually delete.
 *   - A merged branch whose worktree has uncommitted changes is SKIPPED with a
 *     warning — never force-removed. Surprise local edits are not eaten.
 */

import { planPrune } from "./prune-plan.mts";
import { discoverPruneState, applyPrunePlan } from "./prune-driver.mts";

const APPLY = process.argv.slice(2).some((a) => a === "--force" || a === "--yes");

// ── Discover the state, then plan (pure) ─────────────────────────────────────

const state = discoverPruneState();
const { repoRoot } = state;
const plan = planPrune(state);

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

applyPrunePlan(plan, repoRoot, {
  onProgress: (line) => console.log(`  ${line}`),
  onWarning: (line) => console.warn(`  ⚠ ${line}`),
});

console.log("\nDone.\n");
