import { describe, expect, it } from "vitest";

import { planPrune, type PruneState, type WorktreeState } from "./prune-plan.mts";

/**
 * #79 — the pure half of `sandcastle:prune` (ADR-0004). `planPrune` takes the
 * discovered repo state (already read off disk by the CLI) and returns the
 * categorized set of deletions — run logs / merged worktrees / merged
 * `sandcastle/*` branches / leftover Merger scratch — without touching disk, so
 * `pnpm sandcastle:prune` and the future Cockpit Maintenance tab consume one
 * plan. Mirrors the dispatch.mts/observability.mts split (pure logic in its own
 * module, the CLI driver in prune.mts).
 *
 * These fixtures cover the safety in ADR-0004 in isolation: skip-dirty,
 * merged-only, `sandcastle/*` scope, Merger-scratch dedup, repo-root exclusion,
 * branch sorting, and purity (no input mutation).
 */

const ROOT = "/repo";

/** A worktree fixture; `dirty` defaults to clean. */
function wt(path: string, branch: string | null, dirty = false): WorktreeState {
  return { path, branch, dirty };
}

/** Minimal state builder with sensible empty defaults. */
function state(over: Partial<PruneState> = {}): PruneState {
  return {
    repoRoot: ROOT,
    runLogs: [],
    worktrees: [wt(ROOT, "main")], // the main worktree is always present
    mergedBranches: new Set<string>(),
    mergerBranches: new Set<string>(),
    ...over,
  };
}

describe("planPrune — run logs", () => {
  it("passes run logs through verbatim", () => {
    const plan = planPrune(
      state({ runLogs: [`${ROOT}/.sandcastle/logs/a.log`, `${ROOT}/.sandcastle/logs/b.log`] })
    );
    expect(plan.runLogs).toEqual([
      `${ROOT}/.sandcastle/logs/a.log`,
      `${ROOT}/.sandcastle/logs/b.log`,
    ]);
  });

  it("returns a copy — mutating the plan does not mutate the input", () => {
    const input = [`${ROOT}/.sandcastle/logs/a.log`];
    const plan = planPrune(state({ runLogs: input }));
    plan.runLogs.push("extra");
    expect(input).toEqual([`${ROOT}/.sandcastle/logs/a.log`]);
  });
});

describe("planPrune — merged worktrees", () => {
  it("removes a clean merged worktree and deletes its branch", () => {
    const plan = planPrune(
      state({
        worktrees: [
          wt(ROOT, "main"),
          wt(`${ROOT}/.sandcastle/worktrees/wt-1`, "sandcastle/issue-1"),
        ],
        mergedBranches: new Set(["sandcastle/issue-1"]),
      })
    );
    expect(plan.removableWorktrees).toEqual([
      { path: `${ROOT}/.sandcastle/worktrees/wt-1`, branch: "sandcastle/issue-1" },
    ]);
    expect(plan.deletableBranches).toEqual(["sandcastle/issue-1"]);
    expect(plan.skippedDirtyWorktrees).toEqual([]);
  });

  it("skips a dirty merged worktree AND keeps its branch", () => {
    const plan = planPrune(
      state({
        worktrees: [
          wt(ROOT, "main"),
          wt(`${ROOT}/.sandcastle/worktrees/wt-1`, "sandcastle/issue-1", true),
        ],
        mergedBranches: new Set(["sandcastle/issue-1"]),
      })
    );
    expect(plan.removableWorktrees).toEqual([]);
    expect(plan.deletableBranches).toEqual([]); // blocked by the dirty worktree
    expect(plan.skippedDirtyWorktrees).toEqual([
      { path: `${ROOT}/.sandcastle/worktrees/wt-1`, branch: "sandcastle/issue-1" },
    ]);
  });

  it("deletes a merged branch that has no checked-out worktree", () => {
    const plan = planPrune(
      state({
        worktrees: [wt(ROOT, "main")], // no worktree for the branch
        mergedBranches: new Set(["sandcastle/issue-2"]),
      })
    );
    expect(plan.removableWorktrees).toEqual([]);
    expect(plan.deletableBranches).toEqual(["sandcastle/issue-2"]);
  });

  it("never removes the repo-root (main) worktree even if its branch is merged", () => {
    const plan = planPrune(
      state({
        worktrees: [wt(ROOT, "main")],
        mergedBranches: new Set(["main"]), // caller mistake — scope is sandcastle/*, but defensive
      })
    );
    expect(plan.removableWorktrees).toEqual([]);
    expect(plan.deletableBranches).toEqual(["main"]); // scope is the caller's job; root wt still safe
  });

  it("ignores a worktree whose branch is not merged", () => {
    const plan = planPrune(
      state({
        worktrees: [
          wt(ROOT, "main"),
          wt(`${ROOT}/.sandcastle/worktrees/wt-3`, "sandcastle/issue-3"),
        ],
        mergedBranches: new Set(), // nothing merged
      })
    );
    expect(plan.removableWorktrees).toEqual([]);
    expect(plan.deletableBranches).toEqual([]);
  });

  it("ignores a detached (branch-less) worktree", () => {
    const plan = planPrune(
      state({
        worktrees: [wt(ROOT, "main"), wt(`${ROOT}/.sandcastle/worktrees/wt-x`, null)],
      })
    );
    expect(plan.removableWorktrees).toEqual([]);
  });
});

describe("planPrune — leftover Merger scratch", () => {
  it("removes a clean Merger worktree and force-deletes its branch", () => {
    const plan = planPrune(
      state({
        worktrees: [
          wt(ROOT, "main"),
          wt(`${ROOT}/.sandcastle/worktrees/m-1`, "sandcastle/merge-1"),
        ],
        mergerBranches: new Set(["sandcastle/merge-1"]),
      })
    );
    expect(plan.removableMergerWorktrees).toEqual([
      { path: `${ROOT}/.sandcastle/worktrees/m-1`, branch: "sandcastle/merge-1" },
    ]);
    expect(plan.deletableMergerBranches).toEqual(["sandcastle/merge-1"]);
  });

  it("skips a dirty Merger worktree AND keeps its branch", () => {
    const plan = planPrune(
      state({
        worktrees: [
          wt(ROOT, "main"),
          wt(`${ROOT}/.sandcastle/worktrees/m-1`, "sandcastle/merge-1", true),
        ],
        mergerBranches: new Set(["sandcastle/merge-1"]),
      })
    );
    expect(plan.removableMergerWorktrees).toEqual([]);
    expect(plan.deletableMergerBranches).toEqual([]);
    expect(plan.skippedDirtyWorktrees).toEqual([
      { path: `${ROOT}/.sandcastle/worktrees/m-1`, branch: "sandcastle/merge-1" },
    ]);
  });

  it("force-deletes a Merger branch that has no checked-out worktree", () => {
    // The common case: run() tears the worktree down, leaving a bare ref.
    const plan = planPrune(
      state({
        worktrees: [wt(ROOT, "main")],
        mergerBranches: new Set(["sandcastle/merge-2"]),
      })
    );
    expect(plan.removableMergerWorktrees).toEqual([]);
    expect(plan.deletableMergerBranches).toEqual(["sandcastle/merge-2"]);
  });

  it("excludes Merger branches from the reachability-gated (merged) set", () => {
    // A merger branch is its own bucket (force-deleted); it must NOT also appear
    // in deletableBranches even if the caller included it in mergedBranches.
    const plan = planPrune(
      state({
        worktrees: [wt(ROOT, "main")],
        mergedBranches: new Set(["sandcastle/issue-1", "sandcastle/merge-1"]),
        mergerBranches: new Set(["sandcastle/merge-1"]),
      })
    );
    expect(plan.deletableBranches).toEqual(["sandcastle/issue-1"]);
    expect(plan.deletableMergerBranches).toEqual(["sandcastle/merge-1"]);
  });
});

describe("planPrune — combined behaviour", () => {
  it("sorts both branch lists lexicographically", () => {
    const plan = planPrune(
      state({
        mergedBranches: new Set([
          "sandcastle/issue-9",
          "sandcastle/issue-10",
          "sandcastle/issue-1",
        ]),
        mergerBranches: new Set(["sandcastle/merge-9", "sandcastle/merge-1"]),
      })
    );
    expect(plan.deletableBranches).toEqual([
      "sandcastle/issue-1",
      "sandcastle/issue-10",
      "sandcastle/issue-9",
    ]);
    expect(plan.deletableMergerBranches).toEqual(["sandcastle/merge-1", "sandcastle/merge-9"]);
  });

  it("merges dirty worktrees from both buckets into skippedDirtyWorktrees", () => {
    const plan = planPrune(
      state({
        worktrees: [
          wt(ROOT, "main"),
          wt(`${ROOT}/.sandcastle/worktrees/wt-1`, "sandcastle/issue-1", true),
          wt(`${ROOT}/.sandcastle/worktrees/m-1`, "sandcastle/merge-1", true),
        ],
        mergedBranches: new Set(["sandcastle/issue-1"]),
        mergerBranches: new Set(["sandcastle/merge-1"]),
      })
    );
    expect(plan.skippedDirtyWorktrees).toEqual([
      { path: `${ROOT}/.sandcastle/worktrees/wt-1`, branch: "sandcastle/issue-1" },
      { path: `${ROOT}/.sandcastle/worktrees/m-1`, branch: "sandcastle/merge-1" },
    ]);
    expect(plan.deletableBranches).toEqual([]);
    expect(plan.deletableMergerBranches).toEqual([]);
  });

  it("handles a mixed fixture end-to-end", () => {
    const plan = planPrune(
      state({
        runLogs: [`${ROOT}/.sandcastle/logs/a.log`, `${ROOT}/.sandcastle/logs/b.log`],
        worktrees: [
          wt(ROOT, "main"),
          // merged + clean → remove wt + delete branch
          wt(`${ROOT}/.sandcastle/worktrees/wt-1`, "sandcastle/issue-1"),
          // merged + dirty → skip wt + keep branch
          wt(`${ROOT}/.sandcastle/worktrees/wt-2`, "sandcastle/issue-2", true),
          // merged branch with no worktree → delete branch only
          // (sandcastle/issue-3 below)
          // not merged → untouched
          wt(`${ROOT}/.sandcastle/worktrees/wt-4`, "sandcastle/issue-4"),
          // merger + clean → remove wt + force-delete branch
          wt(`${ROOT}/.sandcastle/worktrees/m-1`, "sandcastle/merge-1"),
          // merger + dirty → skip wt + keep branch
          wt(`${ROOT}/.sandcastle/worktrees/m-2`, "sandcastle/merge-2", true),
        ],
        mergedBranches: new Set(["sandcastle/issue-1", "sandcastle/issue-2", "sandcastle/issue-3"]),
        mergerBranches: new Set(["sandcastle/merge-1", "sandcastle/merge-2"]),
      })
    );

    expect(plan.runLogs).toEqual([
      `${ROOT}/.sandcastle/logs/a.log`,
      `${ROOT}/.sandcastle/logs/b.log`,
    ]);
    expect(plan.removableWorktrees.map((w) => w.branch)).toEqual(["sandcastle/issue-1"]);
    // issue-2 blocked by its dirty worktree; issue-1 and issue-3 deletable
    expect(plan.deletableBranches).toEqual(["sandcastle/issue-1", "sandcastle/issue-3"]);
    expect(plan.removableMergerWorktrees.map((w) => w.branch)).toEqual(["sandcastle/merge-1"]);
    // merge-2 blocked by its dirty worktree
    expect(plan.deletableMergerBranches).toEqual(["sandcastle/merge-1"]);
    expect(plan.skippedDirtyWorktrees.map((w) => w.branch)).toEqual([
      "sandcastle/issue-2",
      "sandcastle/merge-2",
    ]);
  });
});

describe("planPrune — purity", () => {
  it("returns an empty plan for an empty state and does not throw", () => {
    const plan = planPrune(state());
    expect(plan.runLogs).toEqual([]);
    expect(plan.removableWorktrees).toEqual([]);
    expect(plan.deletableBranches).toEqual([]);
    expect(plan.removableMergerWorktrees).toEqual([]);
    expect(plan.deletableMergerBranches).toEqual([]);
    expect(plan.skippedDirtyWorktrees).toEqual([]);
  });

  it("does not mutate any of the input collections", () => {
    const runLogs = [`${ROOT}/.sandcastle/logs/a.log`];
    const worktrees = [
      wt(ROOT, "main"),
      wt(`${ROOT}/.sandcastle/worktrees/wt-1`, "sandcastle/issue-1"),
    ];
    const mergedBranches = new Set(["sandcastle/issue-1"]);
    const mergerBranches = new Set(["sandcastle/merge-1"]);
    const worktreesSnapshot = worktrees.map((w) => ({ ...w }));
    const mergedSnapshot = [...mergedBranches];
    const mergerSnapshot = [...mergerBranches];

    planPrune({ repoRoot: ROOT, runLogs, worktrees, mergedBranches, mergerBranches });

    expect(worktrees).toEqual(worktreesSnapshot);
    expect([...mergedBranches]).toEqual(mergedSnapshot);
    expect([...mergerBranches]).toEqual(mergerSnapshot);
    expect(runLogs).toEqual([`${ROOT}/.sandcastle/logs/a.log`]);
  });
});

describe("planPrune — equivalence with the pre-refactor categorization", () => {
  // A faithful re-implementation of the categorization that used to live inline
  // in prune.mts (issue #79 prefactor). Asserting planPrune matches it across
  // many fixtures is the direct proof that `pnpm sandcastle:prune` behaves
  // exactly as before. The original computed dirty via isDirty on the filtered
  // merged/merger worktrees; here dirty is already on the worktree fixtures.
  function legacyCategorize(s: PruneState) {
    const { repoRoot, runLogs, worktrees, mergedBranches, mergerBranches } = s;
    // NOTE: the legacy CLI excluded merger branches from mergedBranches at
    // discovery time; planPrune does that exclusion itself, so feed it the
    // un-excluded set and let the legacy path apply the same exclusion.
    const mergedScoped = new Set([...mergedBranches].filter((b) => !mergerBranches.has(b)));
    const mergedWorktrees = worktrees.filter(
      (w) => w.path !== repoRoot && w.branch && mergedScoped.has(w.branch)
    );
    const dirtyWorktrees = mergedWorktrees.filter((w) => w.dirty);
    const removableWorktrees = mergedWorktrees.filter((w) => !w.dirty);
    const blockedBranches = new Set(dirtyWorktrees.map((w) => w.branch as string));
    const deletableBranches = [...mergedScoped].filter((b) => !blockedBranches.has(b)).sort();
    const mergerWorktrees = worktrees.filter(
      (w) => w.path !== repoRoot && w.branch && mergerBranches.has(w.branch)
    );
    const dirtyMergerWorktrees = mergerWorktrees.filter((w) => w.dirty);
    const removableMergerWorktrees = mergerWorktrees.filter((w) => !w.dirty);
    const blockedMergerBranches = new Set(dirtyMergerWorktrees.map((w) => w.branch as string));
    const deletableMergerBranches = [...mergerBranches]
      .filter((b) => !blockedMergerBranches.has(b))
      .sort();
    const allDirtyWorktrees = [...dirtyWorktrees, ...dirtyMergerWorktrees];
    return {
      runLogs,
      removableWorktrees: removableWorktrees.map((w) => ({
        path: w.path,
        branch: w.branch as string,
      })),
      deletableBranches,
      removableMergerWorktrees: removableMergerWorktrees.map((w) => ({
        path: w.path,
        branch: w.branch as string,
      })),
      deletableMergerBranches,
      skippedDirtyWorktrees: allDirtyWorktrees.map((w) => ({
        path: w.path,
        branch: w.branch as string,
      })),
    };
  }

  /** A hand-rolled fixture enumerator covering the interesting combinations. */
  function* fixtures(): Generator<PruneState> {
    const branchKinds = ["sandcastle/issue-1", "sandcastle/issue-2", "sandcastle/merge-1", "main"];
    for (const rootBranch of ["main", "sandcastle/issue-9"]) {
      for (const wt1Branch of branchKinds) {
        for (const wt1Dirty of [true, false]) {
          for (const wt1Merged of [true, false]) {
            for (const wt1Merger of [true, false]) {
              const merged = new Set<string>();
              const merger = new Set<string>();
              if (wt1Merged && wt1Branch.startsWith("sandcastle/")) merged.add(wt1Branch);
              if (wt1Merger && wt1Branch.startsWith("sandcastle/merge")) merger.add(wt1Branch);
              // also vary a branch with no worktree
              merged.add("sandcastle/issue-3");
              merger.add("sandcastle/merge-2");
              yield {
                repoRoot: ROOT,
                runLogs: [`${ROOT}/.sandcastle/logs/x.log`],
                worktrees: [
                  wt(ROOT, rootBranch, false),
                  wt(`${ROOT}/.sandcastle/worktrees/w1`, wt1Branch, wt1Dirty),
                  wt(`${ROOT}/.sandcastle/worktrees/detached`, null, false),
                ],
                mergedBranches: merged,
                mergerBranches: merger,
              };
            }
          }
        }
      }
    }
  }

  it("matches the legacy inline categorization across all enumerated fixtures", () => {
    let count = 0;
    for (const s of fixtures()) {
      const plan = planPrune(s);
      const legacy = legacyCategorize(s);
      expect(plan).toEqual(legacy);
      count++;
    }
    // Guard against the enumerator silently producing nothing.
    expect(count).toBeGreaterThan(50);
  });
});
