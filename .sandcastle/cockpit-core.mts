/**
 * Cockpit core — the pure, unit-testable helpers behind the Cockpit TUI
 * (`cockpit.tsx`, issue #80; ADR-0008). The Ink React layer is intentionally
 * thin and untested (per CODING_STANDARDS.md); everything with logic lives here
 * so it can be pinned by tests:
 *
 * - the **tab model** (`COCKPIT_TABS` + `cycleTab`) behind the tab-switch keybind,
 * - the **NDJSON stream** decode (`splitNdjsonChunk` + `parseEventLine`) that turns
 *   the supervised child's stdout chunks into typed orchestrator events,
 * - the **event log** (`formatEventLog` + `appendLogLine`) that renders those
 *   events as bounded, scrolling one-liners, and
 * - the **child-exit** classification (`describeChildExit`) that decides whether a
 *   child that went away was a clean Stop or a crash to surface.
 *
 * - the **supervisor** (`spawnOrchestrator`) that launches the orchestrator as a
 *   child process and threads its stdout/stderr through the decode above.
 *
 * The event *shape* is owned by `events.mts` (the contract the orchestrator emits
 * and the Cockpit consumes); this module only decodes and presents it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { OrchestratorEvent } from "./events.mts";
import type { PrunePlan } from "./prune-plan.mts";

/** The Cockpit's tabbed modes, in cycle order (CONTEXT.md: Cockpit). */
export const COCKPIT_TABS = ["live", "sessions", "maintenance"] as const;

/** One Cockpit tab id. */
export type CockpitTab = (typeof COCKPIT_TABS)[number];

/** Direction the tab-switch keybind moves through {@link COCKPIT_TABS}. */
export type CycleDirection = "next" | "prev";

/**
 * The pure model behind the ←/→ tab-switch keybind: return the tab one step
 * from `current` in `direction`, wrapping at both ends so the three tabs form a
 * ring. Kept side-effect-free so the wrap-around is unit-testable in isolation.
 */
export function cycleTab(current: CockpitTab, direction: CycleDirection): CockpitTab {
  const i = COCKPIT_TABS.indexOf(current);
  const delta = direction === "next" ? 1 : -1;
  const n = COCKPIT_TABS.length;
  return COCKPIT_TABS[(i + delta + n) % n];
}

/** The structural slice of Ink's `Key` that {@link routeCockpitInput} inspects —
 *  the modifiers the Cockpit's global keys are built from. */
export interface InputKey {
  readonly tab: boolean;
  readonly shift: boolean;
  readonly ctrl: boolean;
}

/** What the Cockpit's top-level input handler should do with a key chord:
 *  `quit` the Cockpit, `switch-tab` in a direction, or `delegate` the key to
 *  the focused tab (e.g. the embedded Session browser). */
export type CockpitInputAction =
  | { kind: "quit" }
  | { kind: "switch-tab"; direction: CycleDirection }
  | { kind: "delegate" };

/**
 * Route one key chord for the Cockpit's top-level input handler. The Cockpit
 * reserves a minimal set of **global** keys and delegates everything else to
 * whichever tab is focused, so an embedded tab (the Session browser, issue #82)
 * keeps its own keybindings without colliding with the shell.
 */
export function routeCockpitInput(input: string, key: InputKey): CockpitInputAction {
  if (input === "q" || (key.ctrl && input === "c")) return { kind: "quit" };
  if (key.tab) return { kind: "switch-tab", direction: key.shift ? "prev" : "next" };
  return { kind: "delegate" };
}

/** Every `type` discriminator the orchestrator can emit — the allow-list
 *  `parseEventLine` checks so a stray non-event JSON line (or a future unknown
 *  type) is dropped rather than mis-rendered. */
const KNOWN_EVENT_TYPES = new Set<OrchestratorEvent["type"]>([
  "tick",
  "pool-full",
  "buckets",
  "dispatch",
  "planner-emitted",
  "planner-skipped",
  "planner-no-plan",
  "planner-failed",
  "noop-escalated",
  "gh-error",
  "session-resolved",
]);

/**
 * Decode one line of the child's NDJSON stdout into a typed
 * {@link OrchestratorEvent}, or `null` when the line is not a usable event.
 *
 * The child's stdout is NDJSON-only in `SANDCASTLE_EVENT_FORMAT=ndjson` mode,
 * but a supervised process can still emit stray output (a blank line, a runtime
 * stack trace, a stray library log). So this is deliberately defensive: it
 * returns `null` for a blank line, non-JSON, non-object JSON, or a JSON object
 * whose `type` is not a known orchestrator event — the Cockpit simply skips
 * those rather than crashing or showing garbage.
 */
export function parseEventLine(line: string): OrchestratorEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || !KNOWN_EVENT_TYPES.has(type as OrchestratorEvent["type"])) {
    return null;
  }
  return parsed as OrchestratorEvent;
}

/** The result of feeding one stdout chunk through {@link splitNdjsonChunk}: the
 *  complete lines it yielded plus the still-incomplete trailing `rest` to carry
 *  into the next call. */
export interface ChunkSplit {
  /** The complete lines decoded from `buffer + chunk` (newline-terminated). */
  readonly lines: string[];
  /** The trailing partial line (no newline yet); prepend to the next chunk. */
  readonly rest: string;
}

/**
 * Split a freshly-arrived stdout `chunk` into complete lines, carrying any
 * partial trailing line in `rest`. A child's stdout arrives in arbitrary
 * chunks that do NOT respect line boundaries — one write can split a JSON
 * object across two `data` events — so the supervisor threads `rest` back in as
 * the `buffer` on the next call. Everything up to the final newline is a
 * complete line; whatever follows the last newline is the incomplete remainder
 * (empty when the chunk ended exactly on a newline).
 *
 * Pure (buffer in, {lines, rest} out) so the cross-chunk reassembly is
 * unit-testable without a live child process.
 */
export function splitNdjsonChunk(buffer: string, chunk: string): ChunkSplit {
  const combined = buffer + chunk;
  const parts = combined.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

/**
 * Render one orchestrator event as a single compact line for the Live tab's
 * scrolling event log. Distinct from `formatEventProse` in `events.mts`: this is
 * a **total** formatter — every event produces exactly one glanceable line,
 * including a *successful* `session-resolved` (which prose deliberately renders
 * to nothing because the headless `lifecycle` markers cover it). The Cockpit's
 * job is the opposite of headless: surface every live resolution.
 *
 * No timestamp is included — the log line is the event's semantics only; the
 * React layer prefixes a wall-clock time from `event.ts`. Pure so the exact
 * strings are unit-testable in isolation.
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
    default: {
      // Exhaustiveness guard: adding a new OrchestratorEvent type without a log
      // line here is a compile error, so the Live log can never silently omit one.
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/**
 * Append `entry` to the scrolling event log, keeping at most the last `cap`
 * entries. The Live feed is a long-lived stream (a tick every ~60s plus every
 * dispatch/resolution), so the log is a bounded ring: once it exceeds `cap` the
 * oldest entries fall off. Returns a NEW array (never mutates `lines`) so it
 * drops straight into a React `setState` updater. Generic over the entry type so
 * the Cockpit can carry richer entries (line + colour) through the same ring.
 */
export function appendLogLine<T>(lines: readonly T[], entry: T, cap: number): T[] {
  const next = [...lines, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** How a supervised orchestrator child ended, once it is gone. `stopped` is a
 *  clean end (a user Stop, or a rare clean exit); `crashed` is surfaced in the
 *  UI as an error without taking the Cockpit down (ADR-0008). */
export interface ChildExit {
  readonly status: "stopped" | "crashed";
  /** A short human line for the status bar / event log. */
  readonly message: string;
}

/** The raw exit signal from `child.on("exit", (code, signal))` plus whether the
 *  Cockpit itself asked the child to stop (so a Stop-triggered SIGTERM is not
 *  mistaken for a crash). */
export interface ChildExitInput {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | string | null;
  /** True when this exit followed a user Stop (or quit) — the Cockpit killed it. */
  readonly stoppedByUser: boolean;
}

/**
 * Classify a departed orchestrator child as a clean Stop or a crash to surface.
 * The orchestrator loop never self-exits, so any exit the Cockpit did NOT ask
 * for is unexpected: a non-zero code or an unexpected signal is a crash (shown
 * in the UI without killing the Cockpit, per ADR-0008), while a user-requested
 * Stop — or the degenerate clean `exit(0)` — is just "stopped". Pure so the
 * classification is unit-testable without spawning a process.
 */
export function describeChildExit(input: ChildExitInput): ChildExit {
  if (input.stoppedByUser) {
    return { status: "stopped", message: "orchestrator stopped" };
  }
  if (input.code !== null && input.code !== 0) {
    return { status: "crashed", message: `orchestrator crashed (exit code ${input.code})` };
  }
  if (input.signal !== null) {
    return { status: "crashed", message: `orchestrator crashed (signal ${input.signal})` };
  }
  return { status: "stopped", message: "orchestrator exited" };
}

/** How to launch the orchestrator child. Injected (rather than hard-coded) so
 *  the supervisor's wiring can be integration-tested against a fake emitter,
 *  mirroring this codebase's env/dep injection style (`createEvents`, `logPath`). */
export interface SpawnConfig {
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** The sinks the {@link spawnOrchestrator} supervisor pushes decoded child output
 *  into — the Cockpit maps these onto its event log + status state. */
export interface OrchestratorHandlers {
  /** A decoded orchestrator event from the child's NDJSON stdout. */
  onEvent(event: OrchestratorEvent): void;
  /** A stdout line that was NOT a parseable event (rare; surfaced raw). */
  onStdoutRaw(line: string): void;
  /** A stderr line — the per-agent sub-feed or a crash trace. */
  onStderr(line: string): void;
  /** The child is gone: classified as a clean stop or a crash to surface. */
  onExit(status: ChildExit["status"], message: string): void;
  /** The child could not be spawned at all (e.g. the command was not found). */
  onSpawnError(message: string): void;
}

/** Handle to a running orchestrator child — the Stop control the UI needs. */
export interface Supervisor {
  /** Flag this exit as user-requested and SIGTERM the child. */
  stop(): void;
}

/**
 * Spawn the orchestrator as a supervised child and wire its output into
 * `handlers`. This is the heart of ADR-0008: the orchestrator runs as a child
 * process, never in-process, so a throw in its loop cannot take the Cockpit
 * down. In NDJSON mode (set by the caller via `config.env`) the child's stdout
 * is pure NDJSON — each complete line is reassembled across chunks by
 * {@link splitNdjsonChunk}, decoded by {@link parseEventLine}, and delivered as a
 * typed event (or raw, if it somehow isn't one). stderr (the per-agent sub-feed
 * / crash traces) is delivered line-by-line. Exit is classified by
 * {@link describeChildExit}: a user {@link Supervisor.stop} is a clean `stopped`,
 * anything else unexpected is `crashed`.
 */
export function spawnOrchestrator(config: SpawnConfig, handlers: OrchestratorHandlers): Supervisor {
  let stoppedByUser = false;
  let outBuffer = "";
  let errBuffer = "";

  const child: ChildProcess = spawn(config.command, config.args, {
    cwd: config.cwd,
    env: config.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    const split = splitNdjsonChunk(outBuffer, chunk);
    outBuffer = split.rest;
    for (const line of split.lines) {
      if (line.trim() === "") continue;
      const event = parseEventLine(line);
      if (event) handlers.onEvent(event);
      else handlers.onStdoutRaw(line);
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    const split = splitNdjsonChunk(errBuffer, chunk);
    errBuffer = split.rest;
    for (const line of split.lines) {
      if (line.trim() !== "") handlers.onStderr(line);
    }
  });

  child.on("error", (err) => handlers.onSpawnError(err.message));
  child.on("exit", (code, signal) => {
    const exit = describeChildExit({ code, signal, stoppedByUser });
    handlers.onExit(exit.status, exit.message);
  });

  return {
    stop() {
      stoppedByUser = true;
      child.kill("SIGTERM");
    },
  };
}

/** One currently-running Session in the Live tab's in-flight list: an issue and
 *  the **phase** (role) whose Session is running for it. Derived purely from the
 *  structured event stream — an entry is added on `dispatch` and removed on
 *  `session-resolved` (never from the Manifest, which only gains a row *after* a
 *  Session resolves, ADR-0008). */
export interface InFlightEntry {
  readonly issue: number;
  readonly role: "implementer" | "reviewer" | "merger";
  /** The PR under review/merge; null for an Implementer (no PR yet). */
  readonly pr: number | null;
  /** The issue title (Implementer dispatch only; null for Reviewer/Merger). */
  readonly title: string | null;
}

/** The Live tab's derived monitor state: the in-flight list plus the Pool size.
 *  Everything the pool gauge and in-flight list render folds out of the event
 *  stream into this — see {@link reduceLiveEvent}. */
export interface LiveView {
  /** Currently-running Sessions, one per issue, in dispatch order. */
  readonly inflight: readonly InFlightEntry[];
  /** Pool capacity (`POOL_SIZE`), learned from the first `tick`; null until then. */
  readonly poolSize: number | null;
}

/** The zero state a fresh (or freshly restarted) Live monitor folds from. */
export const EMPTY_LIVE_VIEW: LiveView = { inflight: [], poolSize: null };

/**
 * Fold one orchestrator event into the Live monitor view — the pure reducer
 * behind the pool gauge and in-flight list (issue #81; ADR-0008). Only three
 * event types move the view:
 *
 * - `dispatch` **adds** an in-flight entry, keyed by issue number so an issue
 *   moving implement→review→merge replaces its phase in place (mirrors the
 *   orchestrator's issue/PR-keyed In-flight set, CONTEXT.md) rather than stacking
 *   duplicates.
 * - `session-resolved` **removes** the entry for that issue.
 * - `tick` captures `poolSize` for the gauge's denominator.
 *
 * Every other event leaves the view untouched (returned unchanged, same
 * reference). Pure (view in, new view out; never mutates `view`) so the whole
 * event→gauge/list derivation is unit-testable without the Ink layer.
 */
export function reduceLiveEvent(view: LiveView, event: OrchestratorEvent): LiveView {
  switch (event.type) {
    case "dispatch": {
      const rest = view.inflight.filter((e) => e.issue !== event.issue);
      const entry: InFlightEntry = {
        issue: event.issue,
        role: event.role,
        pr: event.pr,
        title: event.title,
      };
      return { ...view, inflight: [...rest, entry] };
    }
    case "session-resolved":
      return { ...view, inflight: view.inflight.filter((e) => e.issue !== event.issue) };
    case "tick":
      return { ...view, poolSize: event.poolSize };
    default:
      return view;
  }
}

/**
 * The pool gauge label: how many Pool slots are busy vs total, `N / POOL_SIZE`.
 * Busy is the derived in-flight count (kept in lock-step with the list), and the
 * total is the Pool size learned from `tick` — rendered `?` until the first tick
 * reports it. Pure so the exact string is unit-testable.
 */
export function formatPoolGauge(view: LiveView): string {
  const total = view.poolSize === null ? "?" : String(view.poolSize);
  return `${view.inflight.length} / ${total} busy`;
}

/**
 * Render one in-flight entry as a compact `phase · what` line for the in-flight
 * list: an Implementer shows its issue + title (`impl #12 · Add the widget`), a
 * Reviewer/Merger shows the PR it is acting on (`rev PR #90 (#44)`). Pure so the
 * exact strings are unit-testable.
 */
export function formatInFlight(entry: InFlightEntry): string {
  if (entry.role === "implementer") {
    return `impl #${entry.issue}${entry.title ? ` · ${entry.title}` : ""}`;
  }
  return `${roleAbbr(entry.role)} PR #${entry.pr} (#${entry.issue})`;
}

/** The compact role tag used in log lines: `impl` / `rev` / `merger`. Mirrors
 *  the labels the orchestrator's `lifecycle`/prose output already uses. */
function roleAbbr(role: "implementer" | "reviewer" | "merger"): string {
  switch (role) {
    case "implementer":
      return "impl";
    case "reviewer":
      return "rev";
    case "merger":
      return "merger";
  }
}

/** Why the Maintenance tab may not apply the prune plan right now, or `null`
 *  when it may: `running` = the orchestrator child is live (ADR-0009), `empty`
 *  = the plan deletes nothing. */
export type PruneApplyBlock = "running" | "empty" | null;

/** The Maintenance apply guard's verdict — whether apply is available and why
 *  not, the presentational copy derived from `blockedBy`. */
export interface PruneApplyDecision {
  readonly allowed: boolean;
  readonly blockedBy: PruneApplyBlock;
}

/**
 * Decide whether the Cockpit Maintenance tab may apply the prune plan. Apply is
 * refused while the orchestrator child is running — a live run is concurrently
 * creating the worktrees/branches Prune would delete, so "Stop the run before
 * pruning" (ADR-0009) — and is a no-op when the plan deletes nothing. Pure so
 * the guard is unit-testable without the Ink layer or a live child.
 */
export function describePruneApply(input: {
  running: boolean;
  plan: PrunePlan;
}): PruneApplyDecision {
  if (input.running) return { allowed: false, blockedBy: "running" };
  if (prunePlanTotal(input.plan) === 0) return { allowed: false, blockedBy: "empty" };
  return { allowed: true, blockedBy: null };
}

/**
 * Count how many things a prune plan would actually delete — run logs, merged
 * worktrees, merged branches, and the Merger-scratch worktrees/branches.
 * Deliberately excludes `skippedDirtyWorktrees`: those are *kept* (ADR-0004), so
 * a plan whose only entries are skipped-dirty deletes nothing. Drives the
 * Maintenance header count and the empty-plan guard. Pure.
 */
export function prunePlanTotal(plan: PrunePlan): number {
  return (
    plan.runLogs.length +
    plan.removableWorktrees.length +
    plan.deletableBranches.length +
    plan.removableMergerWorktrees.length +
    plan.deletableMergerBranches.length
  );
}

/** The Maintenance apply flow's phase: `idle` shows the plan preview + apply
 *  hint; `armed` shows the "delete N? confirm" prompt. Kept tiny (two states)
 *  so a destructive apply always passes through an explicit confirm. */
export type PruneApplyPhase = "idle" | "armed";

/** A Maintenance key mapped to an apply-flow intent: `arm` requests confirm,
 *  `confirm` proceeds with the deletion, `cancel` dismisses the prompt. */
export type PruneApplyInput = "arm" | "confirm" | "cancel";

/** The result of one {@link stepPruneApply} transition: the next phase, plus
 *  `apply` set true on exactly the transition that should run the deletion. */
export interface PruneApplyStep {
  readonly phase: PruneApplyPhase;
  readonly apply: boolean;
}

/**
 * Advance the Maintenance apply flow one step. Applying is the `--force`
 * equivalent (it deletes branches/worktrees), so it is never blind and never a
 * single stray key: `arm` from `idle` only opens the confirm prompt, and only a
 * `confirm` from `armed` sets `apply`. Both transitions are re-gated on the
 * caller's live `allowed` (from {@link describePruneApply}) so a run starting
 * between arm and confirm aborts the apply rather than racing the orchestrator
 * (ADR-0009). Pure so the whole guard is unit-testable without the Ink layer.
 */
export function stepPruneApply(
  phase: PruneApplyPhase,
  input: PruneApplyInput,
  allowed: boolean
): PruneApplyStep {
  if (phase === "idle" && input === "arm") {
    // Only open the confirm prompt for a plan that may actually be applied.
    return { phase: allowed ? "armed" : "idle", apply: false };
  }
  if (phase === "armed" && input === "confirm") {
    // Re-gate on the live guard: a run that started since arming aborts here
    // rather than deleting worktrees/branches out from under the orchestrator.
    return { phase: "idle", apply: allowed };
  }
  if (phase === "armed" && input === "cancel") {
    return { phase: "idle", apply: false };
  }
  return { phase, apply: false };
}
