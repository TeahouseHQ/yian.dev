import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  NOOP_IMPLEMENTER_COMMENT,
  POOL_SIZE,
  POLL_INTERVAL_MS,
  createInflight,
  createPool,
  filterReadyForAgent,
  filterReadyForMerge,
  filterReadyForReview,
  handleImplementerOutcome,
  issueFromBranch,
  pickImplementers,
  pickPrs,
  shouldQueryBuckets,
  shouldRunPlanner,
  type BucketPr,
  type GhRunner,
  type ReadyForAgentIssue,
} from "./dispatch.mts";

/**
 * #66 — the persistent shared-pool orchestrator's scheduling layer (ADR-0006).
 * The tricky decisions — Pool concurrency, In-flight dedupe, Dispatch-bucket
 * filtering, Planner gating, no-op Implementer escalation — live in
 * `dispatch.mts` as pure/injectable functions so they are unit-testable in
 * isolation, the same way `observability.mts` holds the testable observability
 * logic while `main.mts` drives live sandboxes.
 */

const issue = (number: number, labels: string[] = []): ReadyForAgentIssue => ({
  number,
  title: `Issue #${number}`,
  labels,
});

/** A recording GhRunner that optionally throws on the defensive label-create. */
function mockGh(throwOnCreate = false): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = {
    run: async (args: string[]) => {
      calls.push(args);
      if (throwOnCreate && args[0] === "label" && args[1] === "create") {
        throw new Error("label already exists");
      }
    },
  };
  return Object.assign(gh, { calls });
}

describe("constants", () => {
  it("pins the shared Pool size to 10 (ADR-0006)", () => {
    expect(POOL_SIZE).toBe(10);
  });

  it("pins the Poll tick interval to ~60s", () => {
    expect(POLL_INTERVAL_MS).toBe(60_000);
  });
});

describe("createPool", () => {
  it("starts fully free at the configured size", () => {
    expect(createPool().free()).toBe(10);
    expect(createPool(3).free()).toBe(3);
  });

  it("acquire occupies a slot and release frees it", async () => {
    const pool = createPool(2);
    expect(pool.free()).toBe(2);
    await pool.acquire();
    await pool.acquire();
    expect(pool.free()).toBe(0);
    pool.release();
    expect(pool.free()).toBe(1);
  });

  it("never reports a negative free count", () => {
    const pool = createPool(1);
    pool.release(); // defensive release with nothing occupied
    expect(pool.free()).toBe(1);
  });

  it("blocks acquire when full and resumes on release", async () => {
    const pool = createPool(1);
    await pool.acquire();
    expect(pool.free()).toBe(0);

    let resolved = false;
    const pending = pool.acquire().then(() => (resolved = true));
    // A blocked acquire must not resolve until a slot is freed.
    expect(resolved).toBe(false);

    pool.release();
    await pending;
    expect(resolved).toBe(true);
    // The slot was handed straight to the waiter, not freed back to the Pool.
    expect(pool.free()).toBe(0);

    pool.release();
    expect(pool.free()).toBe(1);
  });

  it("hands freed slots to waiters in FIFO order", async () => {
    const pool = createPool(1);
    await pool.acquire();
    const order: string[] = [];
    const a = pool.acquire().then(() => order.push("a"));
    const b = pool.acquire().then(() => order.push("b"));
    pool.release();
    pool.release();
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("createInflight", () => {
  it("tracks issue numbers and is keyed by number", () => {
    const inflight = createInflight();
    expect(inflight.has(42)).toBe(false);
    expect(inflight.size()).toBe(0);

    inflight.add(42);
    expect(inflight.has(42)).toBe(true);
    expect(inflight.size()).toBe(1);

    inflight.add(42); // idempotent — one Session per issue
    expect(inflight.size()).toBe(1);

    inflight.add(7);
    expect(inflight.size()).toBe(2);

    inflight.delete(42);
    expect(inflight.has(42)).toBe(false);
    expect(inflight.has(7)).toBe(true);
    expect(inflight.size()).toBe(1);
  });
});

describe("filterReadyForAgent", () => {
  it("keeps a clean ready-for-agent issue", () => {
    const inflight = createInflight();
    const kept = filterReadyForAgent([issue(1), issue(2)], inflight, new Set());
    expect(kept.map((i) => i.number)).toEqual([1, 2]);
  });

  it("excludes an issue carrying ready-for-human", () => {
    const inflight = createInflight();
    const kept = filterReadyForAgent(
      [issue(1), issue(2, ["ready-for-human"]), issue(3)],
      inflight,
      new Set()
    );
    expect(kept.map((i) => i.number)).toEqual([1, 3]);
  });

  it("excludes an issue that already has an open PR", () => {
    const inflight = createInflight();
    const kept = filterReadyForAgent([issue(1), issue(2)], inflight, new Set([2]));
    expect(kept.map((i) => i.number)).toEqual([1]);
  });

  it("excludes an issue that is already in the In-flight set", () => {
    const inflight = createInflight();
    inflight.add(1);
    const kept = filterReadyForAgent([issue(1), issue(2)], inflight, new Set());
    expect(kept.map((i) => i.number)).toEqual([2]);
  });

  it("applies all three exclusions together", () => {
    const inflight = createInflight();
    inflight.add(4);
    const kept = filterReadyForAgent(
      [
        issue(1), // clean — kept
        issue(2, ["ready-for-human"]), // terminal — dropped
        issue(3), // has an open PR — dropped
        issue(4), // in-flight — dropped
        issue(5, ["ready-for-agent", "needs-triage"]), // clean — kept
      ],
      inflight,
      new Set([3])
    );
    expect(kept.map((i) => i.number)).toEqual([1, 5]);
  });
});

describe("shouldQueryBuckets", () => {
  it("queries when at least one Pool slot is free", () => {
    expect(shouldQueryBuckets(1)).toBe(true);
    expect(shouldQueryBuckets(10)).toBe(true);
  });

  it("skips the gh query entirely when the Pool is full", () => {
    expect(shouldQueryBuckets(0)).toBe(false);
  });
});

describe("shouldRunPlanner", () => {
  it("runs when there are actionable issues AND a free Pool slot", () => {
    expect(shouldRunPlanner([issue(1)], 1)).toBe(true);
    expect(shouldRunPlanner([issue(1), issue(2)], 3)).toBe(true);
  });

  it("does not run when there is nothing actionable to analyze", () => {
    expect(shouldRunPlanner([], 5)).toBe(false);
  });

  it("does not run when the Pool is full (no slot could consume the plan)", () => {
    expect(shouldRunPlanner([issue(1)], 0)).toBe(false);
  });

  it("does not run when both conditions fail", () => {
    expect(shouldRunPlanner([], 0)).toBe(false);
  });
});

describe("pickImplementers", () => {
  it("returns all emitted issues when free slots cover them", () => {
    const inflight = createInflight();
    const emitted = [issue(1), issue(2)];
    expect(pickImplementers(emitted, 5, inflight).map((i) => i.number)).toEqual([1, 2]);
  });

  it("caps at the number of free Pool slots, preserving emit order", () => {
    const inflight = createInflight();
    const emitted = [issue(1), issue(2), issue(3), issue(4)];
    expect(pickImplementers(emitted, 2, inflight).map((i) => i.number)).toEqual([1, 2]);
  });

  it("skips issues already in-flight without consuming a free slot", () => {
    const inflight = createInflight();
    inflight.add(2);
    const emitted = [issue(1), issue(2), issue(3)];
    // free=1 but #2 is skipped, so #1 and #3 are both eligible → only #1 fits.
    expect(pickImplementers(emitted, 1, inflight).map((i) => i.number)).toEqual([1]);
    expect(pickImplementers(emitted, 2, inflight).map((i) => i.number)).toEqual([1, 3]);
  });

  it("returns nothing when no slots are free", () => {
    const inflight = createInflight();
    expect(pickImplementers([issue(1)], 0, inflight)).toEqual([]);
  });

  it("returns nothing when the emit list is empty", () => {
    const inflight = createInflight();
    expect(pickImplementers([], 5, inflight)).toEqual([]);
  });
});

describe("handleImplementerOutcome", () => {
  it("does nothing when the Implementer produced commits", async () => {
    const gh = mockGh();
    const escalated = await handleImplementerOutcome(42, 3, gh);
    expect(escalated).toBe(false);
    expect(gh.calls).toHaveLength(0);
  });

  it("escalates a zero-commit (no-PR) Implementer to ready-for-human", async () => {
    const gh = mockGh();
    const escalated = await handleImplementerOutcome(42, 0, gh);
    expect(escalated).toBe(true);
    const calls = gh.calls.map((c) => c.join(" "));
    expect(calls.some((s) => /issue edit 42 --remove-label ready-for-agent/.test(s))).toBe(true);
    expect(calls.some((s) => /issue edit 42 --add-label ready-for-human/.test(s))).toBe(true);
    expect(calls.some((s) => /issue comment 42 --body/.test(s))).toBe(true);
  });

  it("adds ready-for-human before stripping ready-for-agent (never label-less)", async () => {
    const gh = mockGh();
    await handleImplementerOutcome(42, 0, gh);
    const addIdx = gh.calls.findIndex((c) => c.includes("--add-label"));
    const removeIdx = gh.calls.findIndex((c) => c.includes("--remove-label"));
    expect(addIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeLessThan(removeIdx);
  });

  it("creates the ready-for-human label defensively and tolerates 'already exists'", async () => {
    const gh = mockGh(true); // the label create throws
    const escalated = await handleImplementerOutcome(42, 0, gh);
    expect(escalated).toBe(true); // best-effort create must not abort escalation
    expect(gh.calls.some((c) => c[0] === "label" && c[1] === "create")).toBe(true);
    // and the core strip/add/comment still ran
    const calls = gh.calls.map((c) => c.join(" "));
    expect(calls.some((s) => /--add-label ready-for-human/.test(s))).toBe(true);
    expect(calls.some((s) => /issue comment 42/.test(s))).toBe(true);
  });

  it("comments with the CONTEXT.md ready-for-human semantics", async () => {
    expect(NOOP_IMPLEMENTER_COMMENT).toMatch(/no commits/i);
    expect(NOOP_IMPLEMENTER_COMMENT).toMatch(/out of all Dispatch buckets; a human owns it/i);
  });
});

// ---- #67 — review + merge Dispatch buckets with priority drain (ADR-0006) -------

/**
 * #67 completes the persistent shared-pool orchestrator by adding the review
 * and merge paths to the Pool introduced in #66. Each Poll tick now drains all
 * three Dispatch buckets into the single Pool of 10 in strict priority
 * merge → review → implement. These tests pin the new PR-bucket filter/pick
 * logic + the branch→issue parser, mirroring how the #66 tests cover the
 * ready-for-agent bucket. main.mts structural guards below assert the priority
 * drain order and the fresh-sandbox Reviewer/Merger dispatch.
 */
const pr = (
  prNumber: number,
  issue: number,
  opts: { isDraft?: boolean; labels?: string[]; branch?: string } = {}
): BucketPr => ({
  prNumber,
  issue,
  branch: opts.branch ?? `sandcastle/issue-${issue}`,
  isDraft: opts.isDraft ?? false,
  labels: opts.labels ?? [],
});

describe("issueFromBranch", () => {
  it("parses a sandcastle/issue-N branch back to the issue number", () => {
    expect(issueFromBranch("sandcastle/issue-42")).toBe(42);
    expect(issueFromBranch("sandcastle/issue-1")).toBe(1);
    expect(issueFromBranch("sandcastle/issue-9999")).toBe(9999);
  });

  it("returns null for any non-sandcastle branch", () => {
    expect(issueFromBranch("main")).toBeNull();
    expect(issueFromBranch("feature/foo")).toBeNull();
    expect(issueFromBranch("sandcastle/feature-x")).toBeNull();
  });

  it("returns null for a malformed sandcastle/issue- branch", () => {
    expect(issueFromBranch("sandcastle/issue-")).toBeNull(); // no digits
    expect(issueFromBranch("sandcastle/issue-abc")).toBeNull(); // non-numeric
    expect(issueFromBranch("sandcastle/issue-42-extra")).toBeNull(); // trailing suffix
    expect(issueFromBranch("sandcastle/issue-42/notes")).toBeNull(); // nested path
  });
});

describe("filterReadyForMerge", () => {
  it("keeps a ready (non-draft) + reviewed PR", () => {
    const inflight = createInflight();
    const kept = filterReadyForMerge(
      [pr(10, 42, { isDraft: false, labels: ["reviewed"] })],
      inflight
    );
    expect(kept.map((p) => p.prNumber)).toEqual([10]);
  });

  it("drops a draft PR even if it somehow carries reviewed", () => {
    const inflight = createInflight();
    const kept = filterReadyForMerge(
      [pr(10, 42, { isDraft: true, labels: ["reviewed"] })],
      inflight
    );
    expect(kept).toEqual([]);
  });

  it("drops a ready PR missing the reviewed label", () => {
    const inflight = createInflight();
    const kept = filterReadyForMerge([pr(10, 42, { isDraft: false, labels: [] })], inflight);
    expect(kept).toEqual([]);
  });

  it("drops a ready + reviewed PR carrying ready-for-human", () => {
    const inflight = createInflight();
    const kept = filterReadyForMerge(
      [pr(10, 42, { isDraft: false, labels: ["reviewed", "ready-for-human"] })],
      inflight
    );
    expect(kept).toEqual([]);
  });

  it("drops a ready + reviewed PR that is already in-flight", () => {
    const inflight = createInflight();
    inflight.add(42);
    const kept = filterReadyForMerge(
      [pr(10, 42, { isDraft: false, labels: ["reviewed"] })],
      inflight
    );
    expect(kept).toEqual([]);
  });

  it("applies all merge-bucket rules together", () => {
    const inflight = createInflight();
    inflight.add(50);
    const kept = filterReadyForMerge(
      [
        pr(1, 41, { isDraft: false, labels: ["reviewed"] }), // eligible — kept
        pr(2, 42, { isDraft: true, labels: ["reviewed"] }), // draft — dropped
        pr(3, 43, { isDraft: false, labels: [] }), // unreviewed — dropped
        pr(4, 44, { isDraft: false, labels: ["reviewed", "ready-for-human"] }), // terminal — dropped
        pr(5, 50, { isDraft: false, labels: ["reviewed"] }), // in-flight — dropped
        pr(6, 51, { isDraft: false, labels: ["reviewed", "needs-triage"] }), // eligible — kept
      ],
      inflight
    );
    expect(kept.map((p) => p.issue)).toEqual([41, 51]);
  });
});

describe("filterReadyForReview", () => {
  it("keeps a draft PR without reviewed", () => {
    const inflight = createInflight();
    const kept = filterReadyForReview([pr(10, 42, { isDraft: true, labels: [] })], inflight);
    expect(kept.map((p) => p.prNumber)).toEqual([10]);
  });

  it("drops a ready (non-draft) PR even without reviewed", () => {
    const inflight = createInflight();
    const kept = filterReadyForReview([pr(10, 42, { isDraft: false, labels: [] })], inflight);
    expect(kept).toEqual([]);
  });

  it("drops a draft PR that already carries reviewed", () => {
    const inflight = createInflight();
    const kept = filterReadyForReview(
      [pr(10, 42, { isDraft: true, labels: ["reviewed"] })],
      inflight
    );
    expect(kept).toEqual([]);
  });

  it("drops a draft PR carrying ready-for-human", () => {
    const inflight = createInflight();
    const kept = filterReadyForReview(
      [pr(10, 42, { isDraft: true, labels: ["ready-for-human"] })],
      inflight
    );
    expect(kept).toEqual([]);
  });

  it("drops a draft PR that is already in-flight", () => {
    const inflight = createInflight();
    inflight.add(42);
    const kept = filterReadyForReview([pr(10, 42, { isDraft: true, labels: [] })], inflight);
    expect(kept).toEqual([]);
  });

  it("applies all review-bucket rules together", () => {
    const inflight = createInflight();
    inflight.add(50);
    const kept = filterReadyForReview(
      [
        pr(1, 41, { isDraft: true, labels: [] }), // eligible — kept
        pr(2, 42, { isDraft: false, labels: [] }), // non-draft — dropped
        pr(3, 43, { isDraft: true, labels: ["reviewed"] }), // reviewed — dropped
        pr(4, 44, { isDraft: true, labels: ["ready-for-human"] }), // terminal — dropped
        pr(5, 50, { isDraft: true, labels: [] }), // in-flight — dropped
        pr(6, 51, { isDraft: true, labels: ["needs-triage"] }), // eligible — kept
      ],
      inflight
    );
    expect(kept.map((p) => p.issue)).toEqual([41, 51]);
  });
});

describe("pickPrs", () => {
  it("returns all PRs when free slots cover them", () => {
    const inflight = createInflight();
    const prs = [pr(1, 41, { isDraft: false }), pr(2, 42, { isDraft: true })];
    expect(pickPrs(prs, 5, inflight).map((p) => p.prNumber)).toEqual([1, 2]);
  });

  it("caps at the number of free Pool slots, preserving list order", () => {
    const inflight = createInflight();
    const prs = [pr(1, 41), pr(2, 42), pr(3, 43), pr(4, 44)];
    expect(pickPrs(prs, 2, inflight).map((p) => p.prNumber)).toEqual([1, 2]);
  });

  it("skips a PR whose issue is already in-flight without consuming a slot", () => {
    const inflight = createInflight();
    inflight.add(42); // defense-in-depth: filter already excluded it, picker re-checks
    const prs = [pr(1, 41), pr(2, 42), pr(3, 43)];
    expect(pickPrs(prs, 1, inflight).map((p) => p.prNumber)).toEqual([1]);
    expect(pickPrs(prs, 2, inflight).map((p) => p.prNumber)).toEqual([1, 3]);
  });

  it("returns nothing when no slots are free", () => {
    const inflight = createInflight();
    expect(pickPrs([pr(1, 41)], 0, inflight)).toEqual([]);
  });

  it("returns nothing when the PR list is empty", () => {
    const inflight = createInflight();
    expect(pickPrs([], 5, inflight)).toEqual([]);
  });
});

// ---- main.mts structural guards (read source, never import — it runs the loop) --

const mainSource = readFileSync(new URL("./main.mts", import.meta.url), "utf8");

describe("main.mts — persistent shared-pool orchestrator (ADR-0006)", () => {
  it("drops the discrete MAX_ITERATIONS for-loop", () => {
    expect(mainSource).not.toMatch(/MAX_ITERATIONS/);
    expect(mainSource).not.toMatch(/MAX_PARALLEL/);
  });

  it("runs as a persistent loop (never self-exits)", () => {
    // A persistent Poll tick loop, not a bounded `for (let iteration ...)`.
    expect(mainSource).toMatch(/for\s*\(\s*;;\s*\)|while\s*\(\s*true\s*\)/);
  });

  it("uses the shared Pool and In-flight set from dispatch.mts", () => {
    expect(mainSource).toMatch(/from\s+["']\.\/dispatch\.mts["']/);
    expect(mainSource).toMatch(/createPool/);
    expect(mainSource).toMatch(/createInflight/);
  });

  it("sleeps one Poll tick between iterations", () => {
    expect(mainSource).toMatch(/POLL_INTERVAL_MS/);
  });

  it("dispatches Reviewers and Mergers into the shared Pool", () => {
    expect(mainSource).toMatch(/dispatchReviewer/);
    expect(mainSource).toMatch(/dispatchMerger/);
    // both acquire a Pool slot and mark the issue in-flight
    expect(mainSource).toMatch(/pool\.acquire/);
  });

  it("drains the buckets in priority order merge → review → implement", () => {
    // The Planner gate comes AFTER the merge + review picks, so started work
    // lands before new work starts (prevents PR starvation — ADR-0006).
    const mergeIdx = mainSource.indexOf("filterReadyForMerge");
    const reviewIdx = mainSource.indexOf("filterReadyForReview");
    const plannerIdx = mainSource.indexOf("shouldRunPlanner");
    expect(mergeIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(plannerIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeLessThan(reviewIdx);
    expect(reviewIdx).toBeLessThan(plannerIdx);
  });

  it("Reviewer creates its own fresh sandbox from the PR branch", () => {
    // impl and review are decoupled across ticks (ADR-0006), so the Reviewer
    // can't reuse the Implementer's sandbox — it builds a fresh one on the PR
    // branch with install + build, then runs review-prompt.md.
    expect(mainSource).toMatch(/review-prompt\.md/);
    expect(mainSource).toMatch(/pnpm install --frozen-lockfile && pnpm build/);
  });

  it("Merger runs the merge-prompt (test-then-merge with gh pr merge)", () => {
    expect(mainSource).toMatch(/merge-prompt\.md/);
  });

  it("gates the Planner on free slots remaining after merge+review draining", () => {
    // The Planner is Pool-exempt but only runs when a slot could consume its
    // plan — `remaining` is the post-drain free count passed to shouldRunPlanner.
    expect(mainSource).toMatch(/remaining/);
    expect(mainSource).toMatch(/shouldRunPlanner\(actionable, remaining\)/);
  });
});
