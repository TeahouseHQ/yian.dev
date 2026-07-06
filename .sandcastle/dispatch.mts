/**
 * Persistent shared-pool orchestrator — scheduling layer (ADR-0006).
 *
 * The orchestrator in `main.mts` changed from a discrete, capped
 * `for (… MAX_ITERATIONS)` loop into a **persistent Poll tick feeding a single
 * shared concurrency Pool**. This module holds the scheduling logic that used to
 * be inlined in `main.mts` — the **Pool**, **In-flight set**, **Dispatch
 * bucket** filter, **Planner** gate, and no-op Implementer terminal handling —
 * as pure / injectable functions so they are unit-testable in isolation, the
 * same way `observability.mts` holds the testable observability logic while
 * `main.mts` drives live sandcastle + gh. See the glossary terms in CONTEXT.md.
 */

/** Shared concurrency Pool size across all roles (ADR-0006). One slot = one
 *  full agent+sandbox lifecycle. The Planner is NOT counted against it. */
export const POOL_SIZE = 10;

/** Poll tick interval: the loop tops up free slots roughly every 60s. When the
 *  Pool is full the tick skips the gh query entirely and just sleeps. */
export const POLL_INTERVAL_MS = 60_000;

/**
 * The single ref the orchestrator bases everything on (CONTEXT.md; ADR-0013).
 * New issue branches fork from it, the Landing validates against it, and Prune's
 * merged-reachability gate uses it — never local `main` or `HEAD`. Local `main`
 * and the working tree stay purely the human's business; a `git fetch origin`
 * each Poll tick keeps this remote-tracking ref fresh without touching them.
 */
export const BASE_BRANCH = "origin/main";

/** The install+build hook every sandbox runs before its work. Frozen-lockfile
 *  because this repo is pnpm-only — a plain install would resolve a competing
 *  lockfile (see main.mts). */
const INSTALL_BUILD = "pnpm install --frozen-lockfile && pnpm build";

/**
 * The subset of `sandcastle.createSandbox` options the orchestrator computes per
 * dispatch: which `branch` to work on, the `baseBranch` it forks from, the
 * `node_modules` carry-over, and the `onSandboxReady` hook commands. The live
 * `sandbox` factory (docker) is supplied by `main.mts` and spread alongside —
 * kept out of here so the fork-base decision (ADR-0013) is pure and testable.
 */
export interface SandboxSpec {
  readonly branch: string;
  readonly baseBranch: string;
  readonly copyToWorktree: string[];
  readonly hooks: { sandbox: { onSandboxReady: { command: string }[] } };
}

/**
 * Build the sandbox spec for an Implementer: fork the new `sandcastle/issue-N`
 * branch from {@link BASE_BRANCH} (`origin/main`), NEVER `HEAD`. Sandcastle's
 * docker provider defaults `baseBranch` to `HEAD`, so an explicit base is what
 * makes the fork independent of whatever the human has checked out (ADR-0013,
 * #100). Then install + build the worktree before the agent runs.
 */
export function implementerSandboxSpec(branch: string): SandboxSpec {
  return {
    branch,
    baseBranch: BASE_BRANCH,
    copyToWorktree: ["node_modules"],
    hooks: { sandbox: { onSandboxReady: [{ command: INSTALL_BUILD }] } },
  };
}

/**
 * Build the sandbox spec for a Landing (CONTEXT.md: Landing; ADR-0012/0013): a
 * throwaway `sandcastle/merge-N` worktree forked from {@link BASE_BRANCH}
 * (`origin/main`) — the same base the PR will land on server-side, so a green
 * validation is meaningful — never local `main`, which falls behind after every
 * server-side merge. `onSandboxReady` install+builds, then deterministically
 * test-merges the PR branch: `git merge <prBranch>` (a textual conflict) or
 * `pnpm typecheck && pnpm test` (a red suite) exiting non-zero rejects
 * `createSandbox` and routes `main.mts` to the failure escalation.
 */
export function landingSandboxSpec(issue: number, prBranch: string): SandboxSpec {
  return {
    branch: `sandcastle/merge-${issue}`,
    baseBranch: BASE_BRANCH,
    copyToWorktree: ["node_modules"],
    hooks: {
      sandbox: {
        onSandboxReady: [
          { command: INSTALL_BUILD },
          { command: `git merge ${prBranch} --no-edit && pnpm typecheck && pnpm test` },
        ],
      },
    },
  };
}

/**
 * The shared concurrency **Pool** (CONTEXT.md: Pool). A single limiter of size
 * `POOL_SIZE`; `acquire()` reserves a slot (resolving immediately if one is
 * free, otherwise queueing until a slot is released) and `release()` frees one.
 * `free()` reports remaining capacity so a Poll tick can short-circuit before
 * spending a gh query when there is no slot to fill.
 *
 * Releasing hands a freed slot straight to the longest-waiting `acquire()` (the
 * Pool's occupancy is unchanged) rather than decrementing and immediately
 * re-incrementing — matching the inlined limiter this replaces.
 */
export interface Pool {
  /** Number of slots not currently occupied (`POOL_SIZE − inflight`). */
  free(): number;
  /** Reserve one slot; resolves when a slot is free. */
  acquire(): Promise<void>;
  /** Free one occupied slot (or hand it to the next waiter). */
  release(): void;
}

/** Create a Pool of `size` (default `POOL_SIZE`). */
export function createPool(size: number = POOL_SIZE): Pool {
  let occupied = 0;
  const waiters: (() => void)[] = [];
  return {
    free: () => Math.max(0, size - occupied),
    acquire: () =>
      occupied < size
        ? (occupied++, Promise.resolve())
        : new Promise<void>((resolve) => waiters.push(resolve)),
    release: () => {
      const next = waiters.shift();
      if (next) {
        next(); // hand the slot directly to the waiter (occupancy unchanged)
      } else {
        occupied = Math.max(0, occupied - 1);
      }
    },
  };
}

/**
 * The **In-flight set** (CONTEXT.md): the orchestrator's in-memory record of
 * which issue/PR numbers currently have a Session running, keyed by number. It
 * is what stops a repeatedly-polling loop from dispatching a second agent for
 * the same item; entries are removed the moment their Session resolves. Not
 * durable — lost on process restart, which yields at-least-once (never
 * at-most-once) dispatch.
 */
export interface Inflight {
  has(number: number): boolean;
  add(number: number): void;
  delete(number: number): void;
  /** Number of items currently in-flight. */
  size(): number;
}

/** Create an empty In-flight set keyed by issue/PR number. */
export function createInflight(): Inflight {
  const set = new Set<number>();
  return {
    has: (n) => set.has(n),
    add: (n) => void set.add(n),
    delete: (n) => void set.delete(n),
    size: () => set.size,
  };
}

// ---- The Retry budget (ADR-0011, #98) -------------------------------------

/**
 * The per-issue-per-phase allowance of failed attempts before escalation
 * (CONTEXT.md: Retry budget). `N=3` is one attempt plus two retries: on the 3rd
 * failed attempt for the same issue+phase the orchestrator escalates the item to
 * `ready-for-human`.
 */
export const RETRY_BUDGET_N = 3;

/** Has an issue+phase reached the {@link RETRY_BUDGET_N} threshold? Pure so the
 *  threshold decision is unit-testable apart from the mutable counter. */
export function isBudgetExhausted(count: number): boolean {
  return count >= RETRY_BUDGET_N;
}

/**
 * The **Retry budget** (CONTEXT.md): the orchestrator's in-memory counter of
 * failed attempts keyed by issue+phase, living beside the In-flight set and Plan
 * cache (same non-durability philosophy, ADR-0006/0010). A failed attempt — a
 * crashed Session, one that resolved without a parseable Outcome, or a failed
 * Landing — is `fail(issue, phase)`; a successful Session (or an escalation)
 * `clear(issue, phase)`s it. Not durable: a restart forgets counts, which at
 * worst grants extra attempts — benign under at-least-once dispatch.
 */
export interface RetryBudget {
  /** Record one failed attempt for `issue`+`phase`; returns the new count. */
  fail(issue: number, phase: string): number;
  /** Reset the counter for `issue`+`phase` (a successful Session or escalation). */
  clear(issue: number, phase: string): void;
  /** The current failed-attempt count for `issue`+`phase` (0 if none). */
  count(issue: number, phase: string): number;
}

/** Create an empty Retry budget. Keyed by a `issue:phase` string so the same
 *  issue is counted independently across its impl / rev / land / resolve phases. */
export function createRetryBudget(): RetryBudget {
  const counts = new Map<string, number>();
  const key = (issue: number, phase: string) => `${issue}:${phase}`;
  return {
    fail: (issue, phase) => {
      const next = (counts.get(key(issue, phase)) ?? 0) + 1;
      counts.set(key(issue, phase), next);
      return next;
    },
    clear: (issue, phase) => void counts.delete(key(issue, phase)),
    count: (issue, phase) => counts.get(key(issue, phase)) ?? 0,
  };
}

/**
 * A `ready-for-agent` issue as the Dispatch bucket sees it: its number, title,
 * current labels (so an issue that ALSO carries `ready-for-human` can be
 * excluded without a second query), and `updatedAt` — GitHub's ISO timestamp,
 * bumped on any edit/comment/label change, which the Plan cache key hashes so a
 * content change to an issue the Planner reasons over forces a re-plan (ADR-0010).
 */
export interface ReadyForAgentIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: ReadonlyArray<string>;
  readonly updatedAt: string;
}

/**
 * Parse the issue number out of a deterministic `sandcastle/issue-N` branch
 * name, or return `null` when the branch is not one of ours. The branch is the
 * link back from a PR to its issue — used to key the In-flight set, derive the
 * issue `runId`, and populate prompt args for Reviewer/Merger dispatch.
 */
export function issueFromBranch(branch: string): number | null {
  const m = branch.match(/^sandcastle\/issue-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/**
 * Filter the `ready-for-agent` **Dispatch bucket** (CONTEXT.md). An issue is
 * dropped if it carries `ready-for-human` (the universal terminal label — out of
 * all buckets), already has an open `sandcastle/issue-N` PR (nothing to
 * implement), or is already in the In-flight set (an Implementer is running).
 * What remains is the actionable list the Planner may analyze this tick.
 */
export function filterReadyForAgent(
  issues: ReadonlyArray<ReadyForAgentIssue>,
  inflight: Inflight,
  openPrIssues: ReadonlySet<number>
): ReadyForAgentIssue[] {
  return issues.filter(
    (i) =>
      !i.labels.includes("ready-for-human") &&
      !openPrIssues.has(i.number) &&
      !inflight.has(i.number)
  );
}

/**
 * Should this Poll tick query the Dispatch buckets at all? When the Pool is full
 * (`free === 0`) there is no slot to fill, so the query is pure waste — skip it
 * and sleep to the next tick (CONTEXT.md: Poll tick; ADR-0006).
 */
export function shouldQueryBuckets(free: number): boolean {
  return free > 0;
}

/**
 * Should the **Planner** run this tick? Per ADR-0006 the Planner runs in its own
 * dedicated singleton slot (NOT counted against the Pool) and only when (a)
 * there are `ready-for-agent` issues to analyze and (b) at least one free Pool
 * slot remains — otherwise running Opus to produce a plan we can't dispatch is
 * pure token waste. The caller passes the free count **remaining after the
 * merge+review buckets have drained their slots** (priority drain: merge →
 * review → implement), so the Planner never runs when started work already
 * filled every free slot.
 */
export function shouldRunPlanner(
  actionable: ReadonlyArray<{ number: number }>,
  free: number
): boolean {
  return actionable.length > 0 && free > 0;
}

/**
 * Pick which emitted issues to dispatch as Implementers this tick, given the
 * number of free Pool slots and the In-flight set. Returns at most `free`
 * issues (the Pool caps concurrency), skipping any already in-flight (the
 * Planner re-queries gh, so it can emit an issue a concurrent tick just started
 * — the guard is defense-in-depth). Emit order is preserved.
 */
export function pickImplementers<T extends { number: number }>(
  emitted: ReadonlyArray<T>,
  free: number,
  inflight: Inflight
): T[] {
  const picked: T[] = [];
  for (const item of emitted) {
    if (picked.length >= free) break;
    if (!inflight.has(item.number)) picked.push(item);
  }
  return picked;
}

/**
 * An issue the Planner emitted as safe to start — the unblocked subset `U` of
 * its input set. The Plan cache stores exactly this list (never the blocking
 * graph): the orchestrator only needs *which* issues are safe to dispatch, not
 * *who* blocks *whom* (ADR-0010).
 */
export interface EmittedIssue {
  readonly number: number;
  readonly title: string;
  readonly branch: string;
}

/**
 * The **Plan cache** (CONTEXT.md; ADR-0010): the Planner's last `emit` list
 * keyed by a content-hash of the raw `ready-for-agent` set it reasoned over.
 * `null` when cold (process start / no plan yet). In-memory / non-durable — it
 * lives in `main.mts` beside the In-flight set, the pure key + reuse predicate
 * live here.
 */
export type PlanCache = { readonly key: string; readonly emit: EmittedIssue[] } | null;

/**
 * Content-hash of the raw `ready-for-agent` set the Planner reasons over —
 * `hash(sorted [(number, updatedAt)])` (ADR-0010). Sorting by number makes the
 * key **order-independent** (`gh` list order must not matter); including
 * `updatedAt` makes it change on any add/remove of an issue OR any edit/comment/
 * label change (GitHub bumps `updatedAt`), and stay stable otherwise.
 *
 * IMPORTANT: callers must pass the **raw** `queryReadyForAgent` result (before
 * `filterReadyForAgent`), never the post-filter `actionable` set — otherwise the
 * cache goes stale silently when a blocker merges out of the query (ADR-0010).
 *
 * The "hash" is the canonical sorted-pairs JSON itself (a content-identity key):
 * two sets compare equal iff they hold the same `(number, updatedAt)` pairs. A
 * digest would only add opacity — the key is compared by string equality and is
 * far more debuggable as the readable pair list.
 */
export function planCacheKey(issues: ReadonlyArray<{ number: number; updatedAt: string }>): string {
  const pairs = issues.map((i) => [i.number, i.updatedAt] as const).sort((a, b) => a[0] - b[0]);
  return JSON.stringify(pairs);
}

/**
 * The reuse-vs-replan predicate (ADR-0010). Returns `true` — **reuse the cached
 * emit, no Planner call** — only when the cache is warm AND its key matches the
 * current raw-set key. Returns `false` — **re-plan** — when the cache is cold
 * (`null`) or the key moved (an issue labeled in/out, or a content edit). Either
 * way the caller still runs the pure `pickImplementers` dispatch over the emit,
 * so a cache hit never skips dispatch and capped-but-unblocked issues never
 * starve.
 */
export function shouldReusePlan(key: string, cache: PlanCache): boolean {
  return cache !== null && cache.key === key;
}

/**
 * Resolve the emit list to dispatch from this tick, running the injected
 * `runPlanner` **only on a cache miss** (ADR-0010). Returns the emit, the
 * (possibly updated) cache to store, and `plannerRan` so the caller can observe
 * whether Opus was spent.
 *
 * - **Cache hit** (`shouldReusePlan`): serve `cache.emit` verbatim, `runPlanner`
 *   is never called, cache is returned unchanged.
 * - **Cache miss** (cold cache / key moved): call `runPlanner`, store
 *   `{ key, emit }`, return the fresh emit.
 *
 * The caller passes the **raw** `queryReadyForAgent` result (before
 * `filterReadyForAgent`) as `readyForAgent`, then runs the same
 * `openPrIssues`/`inflight` filters + `pickImplementers` over the returned emit
 * regardless of hit or miss — a cache hit skips the LLM, never the dispatch, so
 * a capped emit still drains on later ticks (no starvation).
 */
export async function resolvePlanEmit(
  readyForAgent: ReadonlyArray<{ number: number; updatedAt: string }>,
  cache: PlanCache,
  runPlanner: () => Promise<EmittedIssue[]>
): Promise<{ emit: EmittedIssue[]; cache: PlanCache; plannerRan: boolean }> {
  const key = planCacheKey(readyForAgent);
  if (shouldReusePlan(key, cache)) {
    return { emit: cache!.emit, cache, plannerRan: false };
  }
  const emit = await runPlanner();
  return { emit, cache: { key, emit }, plannerRan: true };
}

/**
 * A PR as the `ready-for-merge` / `ready-for-review` **Dispatch buckets** see it
 * (CONTEXT.md). Only `sandcastle/issue-N` PRs reach this type — the orchestrator
 * parses the branch back to its issue (`issueFromBranch`) so a Reviewer/Merger
 * can share the issue-derived `runId` and the In-flight set key with the issue's
 * Implementer. One issue ↔ one PR (deterministic branch), so the In-flight key
 * is the issue number across all three roles.
 */
export interface BucketPr {
  /** The PR's own GitHub number. */
  readonly prNumber: number;
  /** The issue number parsed from the `sandcastle/issue-N` branch. */
  readonly issue: number;
  /** The PR's head branch name (`sandcastle/issue-N`). */
  readonly branch: string;
  /** Whether the PR is still a draft (true) or ready for review (false). */
  readonly isDraft: boolean;
  /** Current labels on the PR (so `reviewed` / `ready-for-human` are visible). */
  readonly labels: ReadonlyArray<string>;
}

/**
 * Filter the `ready-for-merge` **Dispatch bucket** (CONTEXT.md; ADR-0006). A PR
 * is eligible when it is **ready (non-draft) AND carries `reviewed`**, and is
 * dropped if it carries `ready-for-human` (the universal terminal label — out of
 * all buckets) or its issue is already in the In-flight set (a Merger is
 * running). What remains is the list a Merger may be dispatched for this tick.
 */
export function filterReadyForMerge(prs: ReadonlyArray<BucketPr>, inflight: Inflight): BucketPr[] {
  return prs.filter(
    (p) =>
      !p.isDraft &&
      p.labels.includes("reviewed") &&
      !p.labels.includes("ready-for-human") &&
      !inflight.has(p.issue)
  );
}

/**
 * Filter the `ready-for-review` **Dispatch bucket** (CONTEXT.md; ADR-0006). A PR
 * is eligible when it is an open **draft** (not yet ready) **without `reviewed`**
 * (not yet reviewed), and is dropped if it carries `ready-for-human` or its
 * issue is already in the In-flight set (a Reviewer is running). What remains is
 * the list a Reviewer may be dispatched for this tick.
 */
export function filterReadyForReview(prs: ReadonlyArray<BucketPr>, inflight: Inflight): BucketPr[] {
  return prs.filter(
    (p) =>
      p.isDraft &&
      !p.labels.includes("reviewed") &&
      !p.labels.includes("ready-for-human") &&
      !inflight.has(p.issue)
  );
}

/**
 * Pick which PRs to dispatch this tick for a single bucket, given the number of
 * free Pool slots and the In-flight set. Returns at most `free` PRs (the Pool
 * caps concurrency), skipping any whose issue is already in-flight — the filter
 * already excluded tick-start in-flight items, but within one tick the priority
 * drain adds an issue to the set as it dispatches merge, and a PR can never be
 * in two buckets at once (draft vs non-draft), so this re-check is pure
 * defense-in-depth (mirroring `pickImplementers`). List order is preserved.
 */
export function pickPrs<T extends BucketPr>(
  prs: ReadonlyArray<T>,
  free: number,
  inflight: Inflight
): T[] {
  const picked: T[] = [];
  for (const pr of prs) {
    if (picked.length >= free) break;
    if (!inflight.has(pr.issue)) picked.push(pr);
  }
  return picked;
}

/**
 * How the orchestrator talks to the `gh` CLI for terminal handling. `run`
 * executes one command and rejects on a non-zero exit (like `execFile`);
 * `handleImplementerOutcome` / `handleReviewerOutcome` only tolerate failure on
 * the defensive `label create` step.
 */
export interface GhRunner {
  run(args: string[]): Promise<unknown>;
}

/** A `gh` label's create spec — its name plus the description/colour used the
 *  first time it is created. */
interface LabelSpec {
  readonly name: string;
  readonly description: string;
  readonly color: string;
}

/** The universal terminal label (CONTEXT.md: ready-for-human) every give-up /
 *  failure path lands on. */
const READY_FOR_HUMAN: LabelSpec = {
  name: "ready-for-human",
  description: "Out of all Dispatch buckets; a human owns it",
  color: "0052CC",
};

/** The review-gate label a passing Reviewer's PR carries so a Merger can land it. */
const REVIEWED: LabelSpec = {
  name: "reviewed",
  description: "Reviewed by the Sandcastle Reviewer",
  color: "0E8A16",
};

/**
 * Best-effort `gh label create`: defensively ensure a label exists before a
 * transition adds it. A non-zero exit (the label already exists) is expected and
 * swallowed — a terminal transition must never abort because a label was already
 * there. Mirrors the `gh label create … || true` the prompts used to run.
 */
async function ensureLabel(gh: GhRunner, label: LabelSpec): Promise<void> {
  try {
    await gh.run([
      "label",
      "create",
      label.name,
      "--description",
      label.description,
      "--color",
      label.color,
    ]);
  } catch {
    /* label already exists — best effort */
  }
}

// ---- The Outcome contract (ADR-0011) --------------------------------------

/**
 * The structured self-report a Reviewer Session ends with (CONTEXT.md: Outcome):
 * `pass` (the change is good — open the review gate) or `give-up` with a
 * one-line reason (hand the PR to a human). The orchestrator parses it from the
 * agent's final output and performs every dispatch-controlling transition
 * itself; the agent never runs `gh` to mutate labels/draft state (ADR-0011).
 */
export type ParsedOutcome =
  | { readonly kind: "pass" }
  | { readonly kind: "give-up"; readonly reason: string };

/**
 * Parse the Outcome tag out of a Reviewer's final output — the same shape as the
 * Planner's `<plan>` block (`main.mts`):
 *
 * ```
 * <outcome>pass</outcome>
 * <outcome>give-up: <one-line reason></outcome>
 * ```
 *
 * The **last** tag wins (an agent may restate the format earlier in its
 * reasoning; the closing verdict is authoritative). Whitespace inside the tag is
 * tolerated. Returns `null` for a missing OR garbled verdict (anything that is
 * not exactly `pass` or `give-up: <non-empty reason>`) — a null is NOT a
 * give-up: it triggers no GitHub mutation and is recorded as a failed attempt
 * against the Retry budget, so one formatting lapse never escalates
 * automatable work to a human (ADR-0011).
 *
 * Pure and side-effect-free so the contract is unit-testable in isolation.
 */
export function parseOutcome(text: string): ParsedOutcome | null {
  const matches = [...text.matchAll(/<outcome>([\s\S]*?)<\/outcome>/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const body = last[1].trim();
  if (body === "pass") return { kind: "pass" };
  const giveUp = body.match(/^give-up:\s*(\S[\s\S]*)$/);
  if (giveUp) return { kind: "give-up", reason: giveUp[1].trim() };
  return null;
}

/**
 * Comment body posted when a no-op Implementer is escalated to `ready-for-human`
 * (CONTEXT.md: ready-for-human). Exported so the wording is documented and
 * pinned by tests.
 */
export const NOOP_IMPLEMENTER_COMMENT =
  "Sandcastle Implementer produced no commits for this issue — no draft PR was opened. " +
  "Escalating to `ready-for-human` (out of all Dispatch buckets; a human owns it) so the " +
  "issue is not re-dispatched every tick. One no-op is a strong signal the issue is not " +
  "actually agent-ready.";

/** Which terminal transition `handleReviewerOutcome` applied: the review `gate`
 *  (pass → reviewed + ready) or a `give-up` escalation (→ ready-for-human). */
export type ReviewTransition = "gate" | "give-up";

/**
 * Comment body the orchestrator posts when a Reviewer's Outcome is `give-up`
 * (ADR-0011). Carries the agent's one-line reason plus the CONTEXT.md
 * `ready-for-human` semantics — pins the wording that used to live in the
 * review prompt's GIVE-UP PATH, now owned by orchestrator code. Exported so it
 * is documented and unit-testable.
 */
export function reviewerGiveUpComment(reason: string): string {
  return (
    `Sandcastle Reviewer could not pass this change: ${reason}\n\n` +
    "Escalating to `ready-for-human` (out of all Dispatch buckets; a human owns it). " +
    "The PR stays a draft — it is never marked ready or merged from here."
  );
}

/**
 * Reviewer Outcome terminal handling (CONTEXT.md: Outcome; ADR-0011). The agent
 * judged; this code mutates the dispatch-controlling GitHub state — the agent no
 * longer runs `gh` to flip labels/draft from prompt instructions. Pure logic
 * over an injectable {@link GhRunner}, so every transition is unit-testable.
 *
 * - **pass** → open the review gate so a Merger can land the PR: defensively
 *   ensure the `reviewed` label exists, **add `reviewed` before flipping the PR
 *   draft → ready** (so the PR is never momentarily ready without `reviewed`,
 *   which would sit in no Dispatch bucket). Returns `"gate"`.
 * - **give-up** → hand the PR to a human: defensively ensure `ready-for-human`
 *   exists, **add `ready-for-human` before any other state change** (the
 *   crash-safe ordering rule — the terminal label lands first, so no crash point
 *   strands the PR outside every bucket), then post the reason as a PR comment.
 *   The PR is left a draft. Returns `"give-up"`.
 *
 * The caller only invokes this for a *parsed* Outcome; a missing/garbled Outcome
 * (`parseOutcome` → null) performs no mutation at all and is left to the Retry
 * budget (ADR-0011).
 */
export async function handleReviewerOutcome(
  outcome: ParsedOutcome,
  pr: { readonly prNumber: number },
  gh: GhRunner
): Promise<ReviewTransition> {
  const n = String(pr.prNumber);
  if (outcome.kind === "pass") {
    await ensureLabel(gh, REVIEWED);
    // Add `reviewed` BEFORE flipping to ready so the PR is never ready-without-
    // reviewed (which would sit in no bucket).
    await gh.run(["pr", "edit", n, "--add-label", "reviewed"]);
    await gh.run(["pr", "ready", n]);
    return "gate";
  }

  // give-up: apply the terminal label FIRST (crash-safe), then comment.
  await ensureLabel(gh, READY_FOR_HUMAN);
  await gh.run(["pr", "edit", n, "--add-label", "ready-for-human"]);
  await gh.run(["pr", "comment", n, "--body", reviewerGiveUpComment(outcome.reason)]);
  return "give-up";
}

// ---- Retry-budget escalation (ADR-0011, #98) ------------------------------

/**
 * The GitHub-shape of the item whose Retry budget is being escalated. The
 * budget bounds every pooled phase, but the escalation differs by shape (issue
 * §198's blocked-by "both shapes"):
 *
 * - **issue** (implement phase) — the issue is still labeled `ready-for-agent`;
 *   escalation adds `ready-for-human` and strips `ready-for-agent`, like the
 *   no-op Implementer path.
 * - **pr** (review / resolve / land) — a `sandcastle/issue-N` PR; escalation adds
 *   `ready-for-human` via the ADR-0011 crash-safe transition runner. `gated`
 *   distinguishes the two PR states: a review/resolve PR is a plain draft
 *   (`gated: false`, leave it), while a land-phase PR is ready + `reviewed`
 *   (`gated: true`, strip the gate — remove `reviewed`, revert to draft).
 */
export type BudgetTarget =
  | { readonly kind: "issue"; readonly issue: number }
  | { readonly kind: "pr"; readonly prNumber: number; readonly gated: boolean };

/**
 * Comment body the orchestrator posts when an item exhausts its Retry budget
 * (CONTEXT.md: Retry budget; ADR-0011). Cites the phase and attempt count — the
 * signal a human needs to see why automatable work was handed over — plus the
 * CONTEXT.md `ready-for-human` semantics and the note that re-labeling grants a
 * fresh budget. An optional `detail` (the last failure's one-line output) is
 * appended so the PR/issue still shows what went wrong. Exported so the wording
 * is documented and unit-testable.
 */
export function budgetExhaustedComment(phase: string, attempts: number, detail?: string): string {
  const tail = detail ? `\n\nLast failure:\n\n${detail}` : "";
  return (
    `Sandcastle exhausted its Retry budget for the \`${phase}\` phase after ${attempts} ` +
    "failed attempts (a crashed Session, a Session with no parseable Outcome, or a failed " +
    "Landing). Escalating to `ready-for-human` (out of all Dispatch buckets; a human owns " +
    "it). Re-labeling the item for the agent grants a fresh budget." +
    tail
  );
}

/**
 * Escalate a Retry-budget-exhausted item to `ready-for-human` (CONTEXT.md: Retry
 * budget, ready-for-human; ADR-0011, #98). Shape-aware over {@link BudgetTarget}
 * and crash-safe like the other terminal handlers — the terminal label lands
 * FIRST, so no crash point strands the item outside every Dispatch bucket:
 *
 * - **issue** — ensure `ready-for-human`, add it, then strip `ready-for-agent`,
 *   then comment (the issue-shaped implement escalation).
 * - **pr** — ensure `ready-for-human`, add it, then (only when `gated`, a land
 *   PR) remove `reviewed` and revert ready → draft, then comment. A review/resolve
 *   PR (`gated: false`) is already a plain draft, so its bucket state is untouched.
 *
 * Pure logic over an injectable {@link GhRunner}, so every step is unit-testable.
 */
export async function escalateBudgetExhausted(
  target: BudgetTarget,
  phase: string,
  attempts: number,
  gh: GhRunner,
  detail?: string
): Promise<void> {
  const body = budgetExhaustedComment(phase, attempts, detail);
  await ensureLabel(gh, READY_FOR_HUMAN);
  if (target.kind === "issue") {
    const n = String(target.issue);
    // Terminal label FIRST (crash-safe), then strip the ready-for-agent bucket.
    await gh.run(["issue", "edit", n, "--add-label", "ready-for-human"]);
    await gh.run(["issue", "edit", n, "--remove-label", "ready-for-agent"]);
    await gh.run(["issue", "comment", n, "--body", body]);
    return;
  }

  const n = String(target.prNumber);
  await gh.run(["pr", "edit", n, "--add-label", "ready-for-human"]);
  if (target.gated) {
    // A land-phase PR is ready + reviewed — strip the review gate so a persistent
    // poller stops re-dispatching it from the ready-for-merge bucket.
    await gh.run(["pr", "edit", n, "--remove-label", "reviewed"]);
    await gh.run(["pr", "ready", n, "--undo"]);
  }
  await gh.run(["pr", "comment", n, "--body", body]);
}

/**
 * No-op Implementer terminal handling (CONTEXT.md: ready-for-human; ADR-0006).
 * When an Implementer resolved with zero commits (no PR was opened), durably
 * move the issue out of the `ready-for-agent` bucket so the persistent poller
 * does not re-dispatch it every tick: defensively ensure the `ready-for-human`
 * label exists, **add `ready-for-human` before stripping `ready-for-agent`**
 * (so the issue is never momentarily label-less / lost from every bucket), then
 * comment. Returns `true` when it escalated.
 *
 * A commit-producing run returns `false` and does nothing here: the draft PR it
 * opened simply waits in the `ready-for-review` bucket, where a later Poll tick
 * dispatches a Reviewer (#67). No orchestrator-side escalation is needed for a
 * successful Implementer.
 *
 * A *crashed* Implementer is NOT escalated here (only a clean zero-commit run
 * is): a crash may be transient (sandbox/install failure) and the issue stays
 * `ready-for-agent` for a re-dispatch, which is the accepted at-least-once
 * behaviour.
 */
export async function handleImplementerOutcome(
  issueNumber: number,
  commits: number,
  gh: GhRunner
): Promise<boolean> {
  if (commits > 0) return false;

  const n = String(issueNumber);
  // Defensive: ensure the terminal label exists before adding it (escalation
  // must not abort if the label is already there).
  await ensureLabel(gh, READY_FOR_HUMAN);
  // Add the terminal label BEFORE removing the bucket label so the issue is
  // never without either.
  await gh.run(["issue", "edit", n, "--add-label", "ready-for-human"]);
  await gh.run(["issue", "edit", n, "--remove-label", "ready-for-agent"]);
  await gh.run(["issue", "comment", n, "--body", NOOP_IMPLEMENTER_COMMENT]);
  return true;
}
