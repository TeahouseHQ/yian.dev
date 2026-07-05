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
  planCacheKey,
  resolvePlanEmit,
  shouldQueryBuckets,
  shouldReusePlan,
  shouldRunPlanner,
  type BucketPr,
  type EmittedIssue,
  type GhRunner,
  type PlanCache,
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

const issue = (
  number: number,
  labels: string[] = [],
  updatedAt = `2026-01-01T00:00:0${number}Z`
): ReadyForAgentIssue => ({
  number,
  title: `Issue #${number}`,
  labels,
  updatedAt,
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

// ---- #86 — Plan cache: skip the Planner while the ready-set is unchanged (ADR-0010) --

/**
 * #86 — the Plan cache (ADR-0010). The orchestrator caches the Planner's last
 * emit list keyed by a content-hash of the RAW `ready-for-agent` issue set it
 * reasons over (`hash(sorted [(number, updatedAt)])`). While that key is
 * unchanged a Poll tick dispatches from the cached emit with zero Opus calls;
 * the Planner is re-invoked only when the key moves. The pure key + the
 * reuse-vs-replan predicate live here, mirroring `shouldRunPlanner` /
 * `pickImplementers`; the cache value itself lives in `main.mts` beside
 * `inflight`.
 */
describe("planCacheKey", () => {
  it("produces a stable string for the same raw ready-for-agent set", () => {
    const set = [issue(1), issue(2)];
    expect(planCacheKey(set)).toBe(planCacheKey(set));
    expect(typeof planCacheKey(set)).toBe("string");
  });

  it("is order-independent (gh list order must not move the key)", () => {
    const a = [issue(1), issue(2), issue(3)];
    const b = [issue(3), issue(1), issue(2)];
    expect(planCacheKey(a)).toBe(planCacheKey(b));
  });

  it("changes when an issue is added to the set", () => {
    const before = planCacheKey([issue(1), issue(2)]);
    const after = planCacheKey([issue(1), issue(2), issue(3)]);
    expect(after).not.toBe(before);
  });

  it("changes when an issue is removed from the set (e.g. a blocker merges out)", () => {
    const before = planCacheKey([issue(1), issue(2), issue(3)]);
    const after = planCacheKey([issue(2), issue(3)]);
    expect(after).not.toBe(before);
  });

  it("changes when an issue's updatedAt changes (edit/comment/label bump)", () => {
    const before = planCacheKey([issue(1, [], "2026-01-01T00:00:00Z"), issue(2)]);
    const after = planCacheKey([issue(1, [], "2026-06-01T00:00:00Z"), issue(2)]);
    expect(after).not.toBe(before);
  });

  it("is stable when only in-flight/PR state (not in the key) would differ", () => {
    // Same numbers + updatedAt → same key, regardless of labels the key ignores.
    const a = [issue(1, ["ready-for-agent"]), issue(2, ["ready-for-agent"])];
    const b = [issue(1, ["ready-for-agent", "needs-triage"]), issue(2, [])];
    expect(planCacheKey(a)).toBe(planCacheKey(b));
  });
});

describe("shouldReusePlan", () => {
  const emit: EmittedIssue[] = [{ number: 1, title: "A", branch: "sandcastle/issue-1" }];

  it("re-plans when the cache is cold (null)", () => {
    expect(shouldReusePlan("k", null)).toBe(false);
  });

  it("reuses the cached emit when the key matches", () => {
    const cache: PlanCache = { key: "k", emit };
    expect(shouldReusePlan("k", cache)).toBe(true);
  });

  it("re-plans when the key has moved (ready-set changed)", () => {
    const cache: PlanCache = { key: "old", emit };
    expect(shouldReusePlan("new", cache)).toBe(false);
  });
});

describe("resolvePlanEmit", () => {
  const emitted = (...ns: number[]): EmittedIssue[] =>
    ns.map((n) => ({ number: n, title: `#${n}`, branch: `sandcastle/issue-${n}` }));

  it("runs the Planner once across two ticks with an unchanged raw set", async () => {
    const raw = [issue(1), issue(2)];
    let calls = 0;
    const runPlanner = async () => (calls++, emitted(1));

    let cache: PlanCache = null;
    const t1 = await resolvePlanEmit(raw, cache, runPlanner);
    cache = t1.cache;
    const t2 = await resolvePlanEmit(raw, cache, runPlanner);

    expect(calls).toBe(1); // one Opus Planner Session, not two
    expect(t1.plannerRan).toBe(true);
    expect(t2.plannerRan).toBe(false);
    expect(t2.emit).toEqual(t1.emit); // cache hit serves the same emit
  });

  it("re-plans when the raw set changes (a blocker merges out of the query)", async () => {
    let calls = 0;
    const runPlanner = async () => (calls++, emitted());

    let cache: PlanCache = null;
    const first = await resolvePlanEmit([issue(1), issue(2), issue(3)], cache, runPlanner);
    cache = first.cache;
    // #1 merged → closed → leaves the ready-for-agent query. Key flips → re-plan.
    const second = await resolvePlanEmit([issue(2), issue(3)], cache, runPlanner);

    expect(calls).toBe(2);
    expect(second.plannerRan).toBe(true);
  });

  it("cache hit still dispatches: capped emit {A,D,E} + 1 slot → A, then D,E, no re-plan", async () => {
    // The starvation guard (ADR-0010): a cache hit skips the LLM, NOT the
    // dispatch — so a capped emit still drains on later ticks without re-planning.
    let calls = 0;
    const runPlanner = async () => (calls++, emitted(1, 4, 5)); // A, D, E
    const raw = [issue(1), issue(4), issue(5)];
    const inflight = createInflight();

    let cache: PlanCache = null;

    // Tick 1 — cold cache → plan; only 1 free slot caps the emit to A.
    const t1 = await resolvePlanEmit(raw, cache, runPlanner);
    cache = t1.cache;
    const picked1 = pickImplementers(t1.emit, 1, inflight);
    picked1.forEach((i) => inflight.add(i.number));
    expect(picked1.map((i) => i.number)).toEqual([1]);

    // Tick 2 — A still in-flight its whole Run; same raw set → cache hit (no
    // Planner). Dispatch from cached emit skips in-flight A → D, E fill 2 slots.
    const t2 = await resolvePlanEmit(raw, cache, runPlanner);
    cache = t2.cache;
    const picked2 = pickImplementers(t2.emit, 2, inflight);

    expect(t2.plannerRan).toBe(false);
    expect(picked2.map((i) => i.number)).toEqual([4, 5]);
    expect(calls).toBe(1); // one plan served both ticks — no starvation, no Opus
  });

  it("keys off the RAW set passed in, not any post-filter actionable subset", async () => {
    // Passing the full raw set keeps the cache valid across a blocker's Run; the
    // caller must pass queryReadyForAgent's result, never `actionable`.
    let calls = 0;
    const runPlanner = async () => (calls++, emitted(1));
    const raw = [issue(1), issue(2), issue(3)];

    let cache: PlanCache = null;
    const a = await resolvePlanEmit(raw, cache, runPlanner);
    cache = a.cache;
    // Same raw set on the next tick (even though actionable would have shrunk to
    // {2,3} once #1 went in-flight) → cache hit, no second Planner call.
    const b = await resolvePlanEmit(raw, cache, runPlanner);
    expect(b.plannerRan).toBe(false);
    expect(calls).toBe(1);
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

describe("main.mts — Plan cache wiring (ADR-0010, #86)", () => {
  it("fetches updatedAt for the ready-for-agent bucket (the key needs it)", () => {
    expect(mainSource).toMatch(/number,title,labels,updatedAt/);
  });

  it("holds one in-memory Plan cache value beside the In-flight set", () => {
    expect(mainSource).toMatch(/let planCache: PlanCache = null/);
  });

  it("resolves the implement-stage emit through the cache (resolvePlanEmit)", () => {
    // The gate reuses the cached emit while the ready-set is unchanged; the cache
    // value is threaded back in (`planCache = resolved.cache`).
    expect(mainSource).toMatch(/resolvePlanEmit\(/);
    expect(mainSource).toMatch(/planCache = resolved\.cache/);
  });

  it("keys the cache on the RAW query result, not the post-filter actionable set", () => {
    // Load-bearing (ADR-0010): passing `readyForAgent` (pre-filter) keeps the
    // cache honest when a blocker merges out; `actionable` would go stale.
    expect(mainSource).toMatch(/resolvePlanEmit\(readyForAgent,/);
    expect(mainSource).not.toMatch(/resolvePlanEmit\(actionable,/);
  });

  it("still runs the pure dispatch (pickImplementers) over the resolved emit", () => {
    // A cache hit skips the LLM, never the dispatch — capped emits still drain.
    expect(mainSource).toMatch(/resolved\.emit\.filter/);
    expect(mainSource).toMatch(/pickImplementers\(dispatchable, remaining, inflight\)/);
  });
});
