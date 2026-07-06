/**
 * Typed orchestrator event stream — the structured **Live feed** (CONTEXT.md).
 *
 * This is the seam extracted from `main.mts`'s ad-hoc `console.log`s (ADR-0008):
 * every orchestrator progress moment flows through ONE typed event emitter as a
 * discriminated union. This module is also the **single event-rendering seam**:
 * every surface's view of an event is defined here, once, so adding a new event
 * type is a one-place, compile-error-driven change (issue #92). The views:
 *
 * - **prose renderer** (`formatEventProse` + `eventStream`; default, headless
 *   `pnpm sandcastle`) — reproduces today's exact human-readable lines, routing
 *   error-shaped events to stderr and the rest to stdout, byte-for-byte unchanged.
 * - **NDJSON renderer** (`formatEventNdjson`, `SANDCASTLE_EVENT_FORMAT=ndjson`) —
 *   emits the same events as one JSON object per line for a supervising Cockpit.
 * - **Cockpit log renderer** (`formatEventLog` + `eventSeverity`) — one compact,
 *   coloured line per event for the Live tab's scrolling log.
 *
 * All three share one role→string mapping ({@link ROLE_LABELS}), and the Cockpit's
 * decode allow-list ({@link EVENT_TYPES}) is derived from the event union rather
 * than hand-maintained. Every per-variant rendering is exhaustive over the union,
 * so a new event type without a rendering fails to type-check in this one module.
 *
 * The orchestrator loop is untouched — this is an output seam only (no
 * behavioural change to dispatch/pool logic).
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

/** The pooled agent roles a Session can run as. The single role vocabulary
 *  every renderer speaks (see {@link ROLE_LABELS}). The merge phase is NOT here:
 *  the Landing is agent-free (ADR-0012) and flows through its own `landing-*`
 *  events, not the Session-shaped `dispatch` / `session-resolved` ones. */
export type OrchestratorRole = "implementer" | "reviewer";

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
 *  not meaningful for the role (Implementer has no PR yet; the Reviewer has
 *  no fetched title). */
interface DispatchEvent extends BaseEvent {
  readonly type: "dispatch";
  readonly role: OrchestratorRole;
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

/** The per-tick `git fetch origin` failed (ADR-0013): the tick's dispatch is
 *  skipped rather than proceeding on stale refs; the next tick re-fetches. */
interface FetchFailedEvent extends BaseEvent {
  readonly type: "fetch-failed";
  readonly error: string;
}

/** A dispatched Session (Implementer/Reviewer) resolved. `ok` carries the
 *  commit count; `failed` carries the error string. This is the structured
 *  resolution signal for the Cockpit — headless prose only renders the failure
 *  case (a successful resolution has no orchestrator prose line). */
interface SessionResolvedEvent extends BaseEvent {
  readonly type: "session-resolved";
  readonly role: OrchestratorRole;
  readonly issue: number;
  readonly branch: string;
  readonly status: "ok" | "failed";
  readonly commits: number;
  readonly error: string | null;
}

/** The orchestrator parsed a Reviewer Session's Outcome (ADR-0011): `pass`,
 *  `give-up` (with its one-line `reason`), or `none` when the Session produced
 *  no parseable Outcome tag (no GitHub mutation — a Retry-budget attempt). */
interface ReviewerOutcomeEvent extends BaseEvent {
  readonly type: "reviewer-outcome";
  readonly issue: number;
  readonly outcome: "pass" | "give-up" | "none";
  readonly reason: string | null;
}

/** The orchestrator applied a Reviewer terminal transition from the parsed
 *  Outcome (ADR-0011): `gate` (pass → `reviewed` + PR ready) or `give-up`
 *  (→ `ready-for-human`, PR left draft). */
interface ReviewTransitionEvent extends BaseEvent {
  readonly type: "review-transition";
  readonly issue: number;
  readonly transition: "gate" | "give-up";
}

/** A Landing (the agent-free merge phase, ADR-0012) began: it took a Pool slot
 *  and started its sandbox lifecycle for a ready + `reviewed` PR. Not a Session
 *  (`dispatch`) — a Landing runs no agent. */
interface LandingStartedEvent extends BaseEvent {
  readonly type: "landing-started";
  readonly issue: number;
  readonly pr: number;
  readonly branch: string;
}

/** A Landing succeeded: the PR branch merged clean, the suite was green, and the
 *  orchestrator ran `gh pr merge --merge`. The terminal success of the merge phase. */
interface LandingLandedEvent extends BaseEvent {
  readonly type: "landing-landed";
  readonly issue: number;
  readonly pr: number;
  readonly branch: string;
}

/** A Landing failed — a textual `git merge` conflict or a red suite after a clean
 *  merge — so the PR was escalated to `ready-for-human` (ADR-0012, this slice).
 *  `reason` is the one-line failure summary. */
interface LandingFailedEvent extends BaseEvent {
  readonly type: "landing-failed";
  readonly issue: number;
  readonly pr: number;
  readonly branch: string;
  readonly reason: string;
}

/** A Retry-budget attempt failed below the threshold (ADR-0011, #98): a crashed
 *  Session, a Session with no parseable Outcome, or a failed Landing. `attempt`
 *  of `limit` (N=3) — no GitHub state changed, the item stays in its bucket for
 *  re-dispatch. Makes a struggling item visible before it escalates. */
interface AttemptFailedEvent extends BaseEvent {
  readonly type: "attempt-failed";
  readonly issue: number;
  readonly phase: string;
  readonly attempt: number;
  readonly limit: number;
}

/** A Retry budget was exhausted (ADR-0011, #98): the Nth failed attempt for an
 *  issue+phase, so the orchestrator escalated the item to `ready-for-human` and
 *  cleared the counter. `attempts` is the count cited in the escalation comment. */
interface BudgetExhaustedEvent extends BaseEvent {
  readonly type: "budget-exhausted";
  readonly issue: number;
  readonly phase: string;
  readonly attempts: number;
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
  | FetchFailedEvent
  | SessionResolvedEvent
  | ReviewerOutcomeEvent
  | ReviewTransitionEvent
  | LandingStartedEvent
  | LandingLandedEvent
  | LandingFailedEvent
  | AttemptFailedEvent
  | BudgetExhaustedEvent;

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
    case "fetch-failed":
      return `  ✗ git fetch origin failed: ${event.error} — skipping dispatch this tick.`;
    case "session-resolved":
      if (event.status === "ok") return null;
      return `  ✗ ${roleFailedPrefix(event.role)}#${event.issue} (${event.branch}) failed: ${event.error}`;
    case "reviewer-outcome":
      if (event.outcome === "pass") return `  ✓ Reviewer #${event.issue} reported pass.`;
      if (event.outcome === "give-up")
        return `  ⚠ Reviewer #${event.issue} gave up: ${event.reason}`;
      return `  ⚠ Reviewer #${event.issue} reported no parseable Outcome — no state change.`;
    case "review-transition":
      return event.transition === "gate"
        ? `  → review gate opened for #${event.issue} (reviewed + ready).`
        : `  → #${event.issue} escalated to ready-for-human (Reviewer gave up).`;
    case "landing-started":
      return `  → landing PR #${event.pr} (issue #${event.issue}) → ${event.branch}`;
    case "landing-landed":
      return `  ✓ landed PR #${event.pr} (issue #${event.issue}).`;
    case "landing-failed":
      return `  ✗ Landing PR #${event.pr} (issue #${event.issue}) failed: ${event.reason}`;
    case "attempt-failed":
      return `  ⚠ #${event.issue} ${event.phase} attempt ${event.attempt}/${event.limit} failed — retrying.`;
    case "budget-exhausted":
      return `  ⚠ #${event.issue} ${event.phase} Retry budget exhausted after ${event.attempts} attempts — escalated to ready-for-human.`;
  }
}

/**
 * The single role→string mapping every renderer speaks — the one authoritative
 * source for role wording across the headless prose lines, the Cockpit event
 * log, and the in-flight list. `word` is the capitalized long form (prose
 * dispatch: `Reviewer`); `abbr` is the compact tag (log / in-flight: `rev`).
 */
const ROLE_LABELS: Record<OrchestratorRole, { readonly word: string; readonly abbr: string }> = {
  implementer: { word: "Implementer", abbr: "impl" },
  reviewer: { word: "Reviewer", abbr: "rev" },
};

/** The capitalized role word for a dispatch line (`Implementer`/`Reviewer`). */
export function roleWord(role: OrchestratorRole): string {
  return ROLE_LABELS[role].word;
}

/** The compact role tag used in log / in-flight lines: `impl` / `rev`.
 *  Mirrors the labels the orchestrator's `lifecycle`/prose output already uses. */
export function roleAbbr(role: OrchestratorRole): string {
  return ROLE_LABELS[role].abbr;
}

/** The role prefix on a failed-resolution line. The Implementer has none (just
 *  `#N`), while the Reviewer reads `rev #N` — preserving today's asymmetry
 *  exactly. Returns the role tag + trailing space (or empty), so the caller
 *  always appends `#<issue>`. */
function roleFailedPrefix(role: OrchestratorRole): string {
  return role === "implementer" ? "" : `${roleAbbr(role)} `;
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
    case "fetch-failed":
    case "planner-no-plan":
    case "planner-failed":
    case "landing-failed":
      return "stderr";
    case "session-resolved":
      return event.status === "failed" ? "stderr" : "stdout";
    default:
      return "stdout";
  }
}

/**
 * Render one orchestrator event as a single compact line for the Cockpit Live
 * tab's scrolling event log. Distinct from {@link formatEventProse}: this is a
 * **total** formatter — every event produces exactly one glanceable line,
 * including a *successful* `session-resolved` (which prose deliberately renders
 * to nothing because the headless `lifecycle` markers cover it). The Cockpit's
 * job is the opposite of headless: surface every live resolution.
 *
 * No timestamp is included — the log line is the event's semantics only; the
 * React layer prefixes a wall-clock time from `event.ts`. Pure so the exact
 * strings are unit-testable in isolation. Exhaustive over the union, so a new
 * event type without a log line is a compile error, not a silently-omitted one.
 */
export function formatEventLog(event: OrchestratorEvent): string {
  switch (event.type) {
    case "tick":
      return `tick · ${event.free}/${event.poolSize} free · ${event.inflight} in-flight`;
    case "dispatch":
      return event.role === "implementer"
        ? `▶ dispatch impl #${event.issue}: ${event.title}`
        : `▶ dispatch ${roleAbbr(event.role)} PR #${event.pr} (#${event.issue})`;
    case "session-resolved":
      return event.status === "ok"
        ? `✓ ${roleAbbr(event.role)} #${event.issue} resolved · ${event.commits} commits`
        : `✗ ${roleAbbr(event.role)} #${event.issue} failed · ${event.error}`;
    case "pool-full":
      return "pool full · gh query skipped";
    case "buckets":
      return `buckets · merge ${event.merge} · review ${event.review} · agent ${event.agent} (${event.actionable} actionable)`;
    case "planner-emitted":
      return `planner emitted ${event.count} issue(s)`;
    case "plan-reused":
      return `plan cache hit · reused ${event.count} issue(s) · no planner call`;
    case "planner-skipped":
      return "planner skipped";
    case "planner-no-plan":
      return "planner produced no plan";
    case "planner-failed":
      return `⚠ planner failed · ${event.error}`;
    case "noop-escalated":
      return `⚠ #${event.issue} no commits · escalated to ready-for-human`;
    case "gh-error":
      return `⚠ gh ${event.args.join(" ")} failed · ${event.error}`;
    case "fetch-failed":
      return `✗ git fetch origin failed · ${event.error} · dispatch skipped`;
    case "reviewer-outcome":
      if (event.outcome === "give-up")
        return `⚠ rev #${event.issue} outcome · give-up · ${event.reason}`;
      if (event.outcome === "none") return `⚠ rev #${event.issue} outcome · none`;
      return `✓ rev #${event.issue} outcome · pass`;
    case "review-transition":
      return event.transition === "gate"
        ? `→ #${event.issue} gate opened · reviewed + ready`
        : `→ #${event.issue} escalated to ready-for-human`;
    case "landing-started":
      return `▶ landing PR #${event.pr} (#${event.issue})`;
    case "landing-landed":
      return `✓ landed PR #${event.pr} (#${event.issue})`;
    case "landing-failed":
      return `✗ landing PR #${event.pr} (#${event.issue}) failed · ${event.reason}`;
    case "attempt-failed":
      return `⚠ #${event.issue} ${event.phase} attempt ${event.attempt}/${event.limit} failed`;
    case "budget-exhausted":
      return `⚠ #${event.issue} ${event.phase} budget exhausted · ${event.attempts} attempts · escalated to ready-for-human`;
    default: {
      // Exhaustiveness guard: adding a new OrchestratorEvent type without a log
      // line here is a compile error, so the Live log can never silently omit one.
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** How prominent a log line is: a hard `failure`, a soft `warn`, or `normal`.
 *  The Cockpit maps this to a colour; the classification lives here so it stays
 *  in lock-step with the other renderers in the one seam. */
export type EventSeverity = "failure" | "warn" | "normal";

/**
 * Classify an event's severity for the Cockpit log's colour (failures red, soft
 * escalations yellow, everything else default). Exhaustive over the union so a
 * new event type must be given a severity here — one place, compile-enforced.
 */
export function eventSeverity(event: OrchestratorEvent): EventSeverity {
  switch (event.type) {
    case "gh-error":
    case "fetch-failed":
    case "planner-failed":
    case "landing-failed":
      return "failure";
    case "session-resolved":
      return event.status === "failed" ? "failure" : "normal";
    case "noop-escalated":
    case "planner-no-plan":
    case "attempt-failed":
    case "budget-exhausted":
      return "warn";
    case "reviewer-outcome":
      // A give-up or no-parseable-Outcome is a soft escalation (warn); a pass is
      // routine progress (normal).
      return event.outcome === "pass" ? "normal" : "warn";
    case "tick":
    case "pool-full":
    case "buckets":
    case "dispatch":
    case "planner-emitted":
    case "plan-reused":
    case "planner-skipped":
    case "review-transition":
    case "landing-started":
    case "landing-landed":
      return "normal";
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/**
 * The exhaustive tag map — every `OrchestratorEvent` variant MUST appear as a
 * key, or this literal fails to type-check (a missing key is a compile error).
 * This is what makes the Cockpit's decode allow-list ({@link EVENT_TYPES}) a
 * projection of the union rather than a hand-maintained parallel list that can
 * silently drift when a new event type is added.
 */
const EVENT_TYPE_TAGS: Record<OrchestratorEvent["type"], true> = {
  tick: true,
  "pool-full": true,
  buckets: true,
  dispatch: true,
  "planner-emitted": true,
  "plan-reused": true,
  "planner-skipped": true,
  "planner-no-plan": true,
  "planner-failed": true,
  "noop-escalated": true,
  "gh-error": true,
  "fetch-failed": true,
  "session-resolved": true,
  "reviewer-outcome": true,
  "review-transition": true,
  "landing-started": true,
  "landing-landed": true,
  "landing-failed": true,
  "attempt-failed": true,
  "budget-exhausted": true,
};

/** Every `type` discriminator the orchestrator can emit, derived from the union
 *  via {@link EVENT_TYPE_TAGS}. The Cockpit's decode path checks membership here
 *  so a stray non-event JSON line (or a future unknown type) is dropped rather
 *  than mis-rendered. */
export const EVENT_TYPES: ReadonlySet<OrchestratorEvent["type"]> = new Set(
  Object.keys(EVENT_TYPE_TAGS) as OrchestratorEvent["type"][]
);

/** Narrowing guard: is `type` a known orchestrator event discriminator? Used by
 *  the Cockpit's `parseEventLine` to accept only union members. */
export function isKnownEventType(type: string): type is OrchestratorEvent["type"] {
  return (EVENT_TYPES as ReadonlySet<string>).has(type);
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
  /** A Landing began for `pr` (issue `issue`, branch `branch`) — took a Pool slot. */
  landingStarted(pr: number, issue: number, branch: string): void;
  /** A Landing succeeded: the PR merged clean + green (`gh pr merge` ran). */
  landingLanded(pr: number, issue: number, branch: string): void;
  /** A Landing failed (conflict / red suite), escalated to `ready-for-human`. */
  landingFailed(pr: number, issue: number, branch: string, reason: string): void;
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
    role: OrchestratorRole;
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
  /** The per-tick `git fetch origin` failed — the tick's dispatch is skipped
   *  rather than proceeding on stale refs (ADR-0013). */
  fetchFailed(error: string): void;
  /** The Reviewer's parsed Outcome (ADR-0011): `pass` / `give-up` (with
   *  `reason`) / `none` when no parseable Outcome tag was produced. */
  reviewerOutcome(issue: number, outcome: "pass" | "give-up" | "none", reason: string | null): void;
  /** The applied Reviewer terminal transition: `gate` (reviewed + ready) or
   *  `give-up` (ready-for-human). */
  reviewTransition(issue: number, transition: "gate" | "give-up"): void;
  /** A Retry-budget attempt failed below the threshold (#98): `attempt` of
   *  `limit` for `issue`+`phase` — no state changed, the item stays in its bucket. */
  attemptFailed(issue: number, phase: string, attempt: number, limit: number): void;
  /** The Retry budget for `issue`+`phase` was exhausted after `attempts` failed
   *  attempts — the item was escalated to `ready-for-human` (#98). */
  budgetExhausted(issue: number, phase: string, attempts: number): void;
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
    landingStarted: (pr, issue, branch) =>
      emit({ type: "landing-started", pr, issue, branch, ts: stamp() }),
    landingLanded: (pr, issue, branch) =>
      emit({ type: "landing-landed", pr, issue, branch, ts: stamp() }),
    landingFailed: (pr, issue, branch, reason) =>
      emit({ type: "landing-failed", pr, issue, branch, reason, ts: stamp() }),
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
    fetchFailed: (error) => emit({ type: "fetch-failed", error, ts: stamp() }),
    reviewerOutcome: (issue, outcome, reason) =>
      emit({ type: "reviewer-outcome", issue, outcome, reason, ts: stamp() }),
    reviewTransition: (issue, transition) =>
      emit({ type: "review-transition", issue, transition, ts: stamp() }),
    attemptFailed: (issue, phase, attempt, limit) =>
      emit({ type: "attempt-failed", issue, phase, attempt, limit, ts: stamp() }),
    budgetExhausted: (issue, phase, attempts) =>
      emit({ type: "budget-exhausted", issue, phase, attempts, ts: stamp() }),
  };
}
