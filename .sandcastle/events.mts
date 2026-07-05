/**
 * Typed orchestrator event stream — the structured **Live feed** (CONTEXT.md).
 *
 * This is the seam extracted from `main.mts`'s ad-hoc `console.log`s (ADR-0008):
 * every orchestrator progress moment flows through ONE typed event emitter as a
 * discriminated union, and TWO renderers hang off that single source:
 *
 * - **prose renderer** (default, headless `pnpm sandcastle`) — reproduces today's
 *   exact human-readable lines, routing error-shaped events to stderr and the
 *   rest to stdout, so output is byte-for-byte unchanged.
 * - **NDJSON renderer** (`SANDCASTLE_EVENT_FORMAT=ndjson`) — emits the same events
 *   as one JSON object per line on stdout, for a supervising Cockpit to parse.
 *
 * One event definition, two views. The orchestrator loop is untouched — this is
 * an output seam only (no behavioural change to dispatch/pool logic).
 *
 * Scope note: the per-agent stream (`observe`/`lifecycle` in `observability.mts`)
 * is a separate, already-structured sub-feed (toolCall lines + lifecycle markers)
 * and stays where it is; this module owns the orchestrator-level moments
 * (tick / pool-full / buckets / dispatch / planner / session-resolved / errors).
 * A successful `session-resolved` has no headless prose line today (the
 * `lifecycle` markers cover it), so it renders to nothing in prose mode but is
 * still emitted to the NDJSON stream so the Cockpit can show live resolutions.
 */
/** Renderer mode for the event stream. */
export type EventFormat = "prose" | "ndjson";

/** Shared fields carried by every event. The NDJSON renderer keeps `ts`. */
interface BaseEvent {
  /** ISO timestamp stamped at emit time (rendered by NDJSON; ignored by prose). */
  readonly ts: string;
}

/** A Poll tick is beginning: Pool capacity + in-flight count for the header. */
interface TickEvent extends BaseEvent {
  readonly type: "tick";
  readonly free: number;
  readonly poolSize: number;
  readonly inflight: number;
}

/** The Pool is full this tick — the gh query is skipped entirely. */
interface PoolFullEvent extends BaseEvent {
  readonly type: "pool-full";
}

/** The three Dispatch buckets' sizes after filtering (priority drain order). */
interface BucketsEvent extends BaseEvent {
  readonly type: "buckets";
  readonly merge: number;
  readonly review: number;
  readonly agent: number;
  readonly actionable: number;
}

/** Dispatching one role's Session into the Pool. `pr`/`title` are null when
 *  not meaningful for the role (Implementer has no PR yet; Reviewer/Merger have
 *  no fetched title). */
interface DispatchEvent extends BaseEvent {
  readonly type: "dispatch";
  readonly role: "implementer" | "reviewer" | "merger";
  readonly issue: number;
  readonly branch: string;
  readonly pr: number | null;
  readonly title: string | null;
}

/** The Planner resolved and emitted this many unblocked issues. */
interface PlannerEmittedEvent extends BaseEvent {
  readonly type: "planner-emitted";
  readonly count: number;
}

/** Plan cache hit (ADR-0010): the raw ready-for-agent set was unchanged, so the
 *  cached emit list was reused and the Planner (Opus) was NOT called this tick. */
interface PlanReusedEvent extends BaseEvent {
  readonly type: "plan-reused";
  readonly count: number;
}

/** No actionable ready-for-agent issues, or no free slot after merge+review. */
interface PlannerSkippedEvent extends BaseEvent {
  readonly type: "planner-skipped";
}

/** The Planner resolved but produced no parseable `<plan>` tag. */
interface PlannerNoPlanEvent extends BaseEvent {
  readonly type: "planner-no-plan";
}

/** The Planner run itself rejected with an error. */
interface PlannerFailedEvent extends BaseEvent {
  readonly error: string;
  readonly type: "planner-failed";
}

/** A no-op Implementer was escalated to `ready-for-human` (zero commits). */
interface NoopEscalatedEvent extends BaseEvent {
  readonly type: "noop-escalated";
  readonly issue: number;
}

/** A per-tick `gh` query failed (tolerated; the next tick re-queries). */
interface GhErrorEvent extends BaseEvent {
  readonly type: "gh-error";
  readonly args: ReadonlyArray<string>;
  readonly error: string;
}

/** A dispatched Session (Implementer/Reviewer/Merger) resolved. `ok` carries the
 *  commit count; `failed` carries the error string. This is the structured
 *  resolution signal for the Cockpit — headless prose only renders the failure
 *  case (a successful resolution has no orchestrator prose line). */
interface SessionResolvedEvent extends BaseEvent {
  readonly type: "session-resolved";
  readonly role: "implementer" | "reviewer" | "merger";
  readonly issue: number;
  readonly branch: string;
  readonly status: "ok" | "failed";
  readonly commits: number;
  readonly error: string | null;
}

/**
 * The discriminated union of every orchestrator event. `type` is the single
 * discriminator the renderers switch on; the contract the Cockpit consumes.
 */
export type OrchestratorEvent =
  | TickEvent
  | PoolFullEvent
  | BucketsEvent
  | DispatchEvent
  | PlannerEmittedEvent
  | PlanReusedEvent
  | PlannerSkippedEvent
  | PlannerNoPlanEvent
  | PlannerFailedEvent
  | NoopEscalatedEvent
  | GhErrorEvent
  | SessionResolvedEvent;

/** Which stdout stream a prose-rendered event belongs on (preserves the
 *  existing stdout/stderr split so headless output is unchanged). */
export type EventStream = "stdout" | "stderr";

/**
 * Format one event as the headless prose line, or `null` when the event renders
 * to no line in prose mode (a successful `session-resolved` — headless output
 * is unchanged because the `lifecycle` markers cover the resolution).
 *
 * Pure and side-effect-free so the exact strings are unit-testable in isolation;
 * this is the function that pins "prose output unchanged".
 */
export function formatEventProse(event: OrchestratorEvent): string | null {
  switch (event.type) {
    case "tick":
      return `\n=== Poll tick — ${event.free}/${event.poolSize} Pool slots free, ${event.inflight} in-flight ===\n`;
    case "pool-full":
      return "Pool full — skipping gh query this tick.";
    case "buckets":
      return `buckets: ready-for-merge ${event.merge}, ready-for-review ${event.review}, ready-for-agent ${event.agent} (${event.actionable} actionable).`;
    case "dispatch":
      if (event.role === "implementer") {
        return `  → dispatching Implementer for #${event.issue}: ${event.title} → ${event.branch}`;
      }
      return `  → dispatching ${roleWord(event.role)} for PR #${event.pr} (issue #${event.issue}) → ${event.branch}`;
    case "planner-emitted":
      return `Planner emitted ${event.count} unblocked issue(s).`;
    case "plan-reused":
      return `Plan cache hit — reusing ${event.count} emitted issue(s), no Planner call this tick.`;
    case "planner-skipped":
      return "No actionable ready-for-agent issues, or no free slot after merge+review draining — skipping Planner this tick.";
    case "planner-no-plan":
      return "Planner did not produce a <plan> tag.";
    case "planner-failed":
      return `Planner failed: ${event.error}`;
    case "noop-escalated":
      return `  ⚠ #${event.issue} produced no commits — escalated to ready-for-human.`;
    case "gh-error":
      return `  ⚠ gh ${event.args.join(" ")} failed: ${event.error}`;
    case "session-resolved":
      if (event.status === "ok") return null;
      return `  ✗ ${roleFailedPrefix(event.role)}#${event.issue} (${event.branch}) failed: ${event.error}`;
  }
}

/** The capitalized role word for the dispatch line (`Reviewer`/`Merger`). */
function roleWord(role: "reviewer" | "merger"): string {
  return role === "reviewer" ? "Reviewer" : "Merger";
}

/** The role prefix on a failed-resolution line. The Implementer has none (just
 *  `#N`), while Reviewer/Merger read `rev #N`/`merger #N` — preserving today's
 *  asymmetry exactly. Returns the role word + trailing space (or empty), so the
 *  caller always appends `#<issue>`. */
function roleFailedPrefix(role: "implementer" | "reviewer" | "merger"): string {
  switch (role) {
    case "reviewer":
      return "rev ";
    case "merger":
      return "merger ";
    case "implementer":
      return ""; // `#${issue}` with no role word
  }
}

/**
 * Which stream a prose-rendered event writes to. Mirrors the existing split:
 * the orchestrator progress events and the no-op escalation go to stdout, while
 * every failure (gh-query failure, the three roles' failed resolutions, the
 * Planner's no-plan / failed) goes to stderr. A successful `session-resolved`
 * renders to nothing, so its stream is irrelevant (defaults to stdout).
 */
export function eventStream(event: OrchestratorEvent): EventStream {
  switch (event.type) {
    case "gh-error":
    case "planner-no-plan":
    case "planner-failed":
      return "stderr";
    case "session-resolved":
      return event.status === "failed" ? "stderr" : "stdout";
    default:
      return "stdout";
  }
}

/**
 * Format one event as a single NDJSON line — the whole event object as JSON, so
 * the supervising Cockpit can discriminate on `type` and read `ts` + payload.
 * One JSON object per line; never multi-line.
 */
export function formatEventNdjson(event: OrchestratorEvent): string {
  return JSON.stringify(event);
}

/**
 * Resolve the renderer mode from the environment. Defaults to `prose` (headless
 * `pnpm sandcastle`); flips to `ndjson` only for `SANDCASTLE_EVENT_FORMAT=ndjson`
 * (set by the Cockpit when it spawns the orchestrator as a child process).
 * Pure + env-injected so the parsing is unit-testable in isolation.
 */
export function resolveEventFormat(
  env: Record<string, string | undefined> = process.env
): EventFormat {
  return env.SANDCASTLE_EVENT_FORMAT === "ndjson" ? "ndjson" : "prose";
}

/**
 * The typed event emitter the orchestrator calls. One method per meaningful
 * moment; each constructs the discriminated-union event, stamps it, and routes
 * it to the chosen renderer. Strongly typed call sites so `main.mts` cannot
 * emit an event with the wrong shape.
 */
export interface OrchestratorEvents {
  /** A Poll tick is beginning (Pool capacity header). */
  tick(free: number, poolSize: number, inflight: number): void;
  /** The Pool is full — the gh query is skipped this tick. */
  poolFull(): void;
  /** The three filtered Dispatch-bucket sizes for this tick. */
  buckets(merge: number, review: number, agent: number, actionable: number): void;
  /** Dispatching an Implementer for `issue` (`title` + `branch`). */
  dispatchImplementer(issue: number, title: string, branch: string): void;
  /** Dispatching a Reviewer for `pr` (issue `issue`, branch `branch`). */
  dispatchReviewer(pr: number, issue: number, branch: string): void;
  /** Dispatching a Merger for `pr` (issue `issue`, branch `branch`). */
  dispatchMerger(pr: number, issue: number, branch: string): void;
  /** The Planner emitted `count` unblocked issues. */
  plannerEmitted(count: number): void;
  /** Plan cache hit — the cached emit (`count` issues) was reused, no Opus call. */
  planReused(count: number): void;
  /** No actionable issues / no free slot — the Planner is skipped this tick. */
  plannerSkipped(): void;
  /** The Planner resolved but produced no `<plan>` tag. */
  plannerNoPlan(): void;
  /** The Planner run itself rejected with `error`. */
  plannerFailed(error: string): void;
  /** A dispatched Session resolved (ok = `commits`; failed = `error`). */
  sessionResolved(args: {
    role: "implementer" | "reviewer" | "merger";
    issue: number;
    branch: string;
    status: "ok" | "failed";
    commits: number;
    error?: string;
  }): void;
  /** A no-op Implementer (zero commits) was escalated to `ready-for-human`. */
  noopEscalated(issue: number): void;
  /** A per-tick `gh` query failed (tolerated; next tick re-queries). */
  ghError(args: ReadonlyArray<string>, error: string): void;
}

/** Options for {@link createEvents}; every dependency is injectable for tests. */
export interface CreateEventsOptions {
  /** Renderer mode; defaults to {@link resolveEventFormat} from the env. */
  format?: EventFormat;
  /** Clock; defaults to `new Date()`. */
  now?: () => Date;
  /** stdout sink; defaults to `console.log`. */
  out?: (line: string) => void;
  /** stderr sink; defaults to `console.error`. */
  err?: (line: string) => void;
}

/**
 * Build the typed event emitter. In prose mode each event is rendered by
 * {@link formatEventProse} (null → skipped; otherwise routed to `out` or `err`
 * by {@link eventStream}); in NDJSON mode every event is rendered by
 * {@link formatEventNdjson} to `out` as one JSON object per line.
 */
export function createEvents(opts: CreateEventsOptions = {}): OrchestratorEvents {
  const format = opts.format ?? resolveEventFormat();
  const now = opts.now ?? (() => new Date());
  const out = opts.out ?? ((line: string) => console.log(line));
  const err = opts.err ?? ((line: string) => console.error(line));
  const stamp = (): string => now().toISOString();

  const emit = (event: OrchestratorEvent): void => {
    if (format === "ndjson") {
      out(formatEventNdjson(event));
      return;
    }
    const line = formatEventProse(event);
    if (line === null) return; // silent in prose (successful session-resolved)
    if (eventStream(event) === "stderr") err(line);
    else out(line);
  };

  return {
    tick: (free, poolSize, inflight) =>
      emit({ type: "tick", free, poolSize, inflight, ts: stamp() }),
    poolFull: () => emit({ type: "pool-full", ts: stamp() }),
    buckets: (merge, review, agent, actionable) =>
      emit({ type: "buckets", merge, review, agent, actionable, ts: stamp() }),
    dispatchImplementer: (issue, title, branch) =>
      emit({ type: "dispatch", role: "implementer", issue, branch, pr: null, title, ts: stamp() }),
    dispatchReviewer: (pr, issue, branch) =>
      emit({ type: "dispatch", role: "reviewer", issue, branch, pr, title: null, ts: stamp() }),
    dispatchMerger: (pr, issue, branch) =>
      emit({ type: "dispatch", role: "merger", issue, branch, pr, title: null, ts: stamp() }),
    plannerEmitted: (count) => emit({ type: "planner-emitted", count, ts: stamp() }),
    planReused: (count) => emit({ type: "plan-reused", count, ts: stamp() }),
    plannerSkipped: () => emit({ type: "planner-skipped", ts: stamp() }),
    plannerNoPlan: () => emit({ type: "planner-no-plan", ts: stamp() }),
    plannerFailed: (error) => emit({ type: "planner-failed", error, ts: stamp() }),
    sessionResolved: (args) =>
      emit({
        type: "session-resolved",
        role: args.role,
        issue: args.issue,
        branch: args.branch,
        status: args.status,
        commits: args.commits,
        error: args.error ?? null,
        ts: stamp(),
      }),
    noopEscalated: (issue) => emit({ type: "noop-escalated", issue, ts: stamp() }),
    ghError: (args, error) => emit({ type: "gh-error", args, error, ts: stamp() }),
  };
}
