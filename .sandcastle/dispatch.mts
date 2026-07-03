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

/**
 * A `ready-for-agent` issue as the Dispatch bucket sees it: its number, title,
 * and current labels (so an issue that ALSO carries `ready-for-human` can be
 * excluded without a second query).
 */
export interface ReadyForAgentIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: ReadonlyArray<string>;
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
 * pure token waste. In this implement-only slice there is no merge/review
 * draining ahead of it, so the gate is just "actionable issues exist AND free".
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
 * How the orchestrator talks to the `gh` CLI for terminal handling. `run`
 * executes one command and rejects on a non-zero exit (like `execFile`);
 * `handleImplementerOutcome` only tolerates failure on the defensive
 * `label create` step.
 */
export interface GhRunner {
  run(args: string[]): Promise<unknown>;
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

/**
 * No-op Implementer terminal handling (CONTEXT.md: ready-for-human; ADR-0006).
 * When an Implementer resolved with zero commits (no PR was opened), durably
 * move the issue out of the `ready-for-agent` bucket so the persistent poller
 * does not re-dispatch it every tick: defensively ensure the `ready-for-human`
 * label exists, **add `ready-for-human` before stripping `ready-for-agent`**
 * (so the issue is never momentarily label-less / lost from every bucket), then
 * comment. Returns `true` when it escalated.
 *
 * A commit-producing run returns `false` and does nothing — in this implement
 * slice nothing reviews/merges automatically (the follow-up slice adds that),
 * so the draft PR simply waits.
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
  // Defensive: ensure the terminal label exists (mirrors the review/merge
  // prompts' `gh label create … || true`). A non-zero exit here (label already
  // exists) is expected and ignored — escalation must not abort.
  try {
    await gh.run([
      "label",
      "create",
      "ready-for-human",
      "--description",
      "Out of all Dispatch buckets; a human owns it",
      "--color",
      "0052CC",
    ]);
  } catch {
    /* label already exists — best effort */
  }
  // Add the terminal label BEFORE removing the bucket label so the issue is
  // never without either.
  await gh.run(["issue", "edit", n, "--add-label", "ready-for-human"]);
  await gh.run(["issue", "edit", n, "--remove-label", "ready-for-agent"]);
  await gh.run(["issue", "comment", n, "--body", NOOP_IMPLEMENTER_COMMENT]);
  return true;
}
