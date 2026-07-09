/**
 * Cockpit core — the pure, unit-testable helpers behind the Cockpit TUI
 * (`cockpit.tsx`, issue #80; ADR-0008). The Ink React layer is intentionally
 * thin and untested (per CODING_STANDARDS.md); everything with logic lives here
 * so it can be pinned by tests:
 *
 * - the **tab model** (`COCKPIT_TABS` + `cycleTab`) behind the tab-switch keybind,
 * - the **NDJSON stream** decode (`splitNdjsonChunk` + `parseEventLine`) that turns
 *   the supervised child's stdout chunks into typed orchestrator events,
 * - the **event log** ring (`appendLogLine`) that bounds those rendered one-liners, and
 * - the **child-exit** classification (`describeChildExit`) that decides whether a
 *   child that went away was a clean Stop or a crash to surface.
 *
 * - the **supervisor** (`spawnOrchestrator`) that launches the orchestrator as a
 *   child process and threads its stdout/stderr through the decode above.
 *
 * The event *shape* AND its rendering are owned by `events.mts` — the single
 * event-rendering seam (`formatEventLog`, `eventSeverity`, `roleAbbr`, the
 * `isKnownEventType` allow-list). This module only decodes the stream and folds
 * it into view state; it renders no event strings of its own.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { DRAIN_EXIT_CODE } from "./dispatch.mts";
import {
  isKnownEventType,
  roleAbbr,
  type OrchestratorEvent,
  type OrchestratorRole,
} from "./events.mts";
import { profileNames, type ProfileName } from "./model-profiles.mts";
import type { PrunePlan, PruneWorktree } from "./prune-plan.mts";

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

/**
 * The pure model behind the Live tab's `p` key (ADR-0016): return the next
 * {@link ProfileName} round-robin through the shipped catalog, wrapping past the
 * last so the profiles form a ring — exactly as {@link cycleTab} does for tabs.
 * Because it steps only through {@link profileNames} (the declared catalog) and
 * returns a `ProfileName`, an invalid profile can never be constructed from the
 * Cockpit's own picker (the issue's invariant); a bad name is reachable only from
 * a hand-typed `--profile` flag, which `main.mts` rejects loudly.
 */
export function cycleProfile(current: ProfileName): ProfileName {
  const names = profileNames();
  const i = names.indexOf(current);
  return names[(i + 1) % names.length];
}

/** The Live header's Model-profile copy: the `running` profile the live child was
 *  spawned with (`—` before the first Start), and the `pending` selection shown
 *  as "Start to apply" — non-null ONLY when it differs from `running`. */
export interface ProfileHeader {
  readonly running: string;
  readonly pending: string | null;
}

/**
 * Format the Live tab's Model-profile header (ADR-0016). `running` is the profile
 * the live orchestrator child was spawned with — `null` before the first Start,
 * rendered `—`. `pending` is the `selected` profile the next manual Start will
 * apply, surfaced ONLY when it differs from `running` (so an unchanged selection
 * adds no noise); before the first Start it always differs from `null`, so the
 * seed is shown as pending. Pure so the exact copy is unit-testable without Ink.
 */
export function formatProfileHeader(
  running: ProfileName | null,
  selected: ProfileName
): ProfileHeader {
  return {
    running: running ?? "—",
    pending: running === selected ? null : selected,
  };
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
 *
 * The allow-list is `isKnownEventType` from `events.mts`, derived from the event
 * union — so it can never drift from the shipped events by hand.
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
  if (typeof type !== "string" || !isKnownEventType(type)) return null;
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
 *  UI as an error without taking the Cockpit down (ADR-0008); `restarting` is a
 *  self-restart drain (ADR-0013) the supervisor auto-respawns from. */
export interface ChildExit {
  readonly status: "stopped" | "crashed" | "restarting";
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
  /** True when the stop had to escalate to SIGKILL because the child ignored
   *  SIGTERM (#93) — a *forced* stop, distinguished from a clean one below. */
  readonly forced?: boolean;
}

/**
 * Classify a departed orchestrator child as a clean Stop, a self-restart drain,
 * or a crash to surface. A user-requested Stop — or the degenerate clean
 * `exit(0)` — is "stopped". Otherwise the orchestrator loop self-exits only to
 * self-restart on upgraded code, which it signals with {@link DRAIN_EXIT_CODE}
 * (ADR-0013): that is "restarting", and the supervisor auto-respawns it. Any
 * OTHER unexpected exit — a different non-zero code or an unexpected signal — is
 * a crash, shown in the UI without killing the Cockpit (ADR-0008) and never
 * auto-respawned. The user-Stop check comes first so a Stop that happens to
 * coincide with the drain code never respawns behind the user's back. Pure so the
 * classification is unit-testable without spawning a process.
 */
export function describeChildExit(input: ChildExitInput): ChildExit {
  if (input.stoppedByUser) {
    return input.forced
      ? { status: "stopped", message: "orchestrator force-killed (ignored stop)" }
      : { status: "stopped", message: "orchestrator stopped" };
  }
  if (input.code === DRAIN_EXIT_CODE) {
    return {
      status: "restarting",
      message: `orchestrator restarting on new code (drain exit code ${DRAIN_EXIT_CODE})`,
    };
  }
  if (input.code !== null && input.code !== 0) {
    return { status: "crashed", message: `orchestrator crashed (exit code ${input.code})` };
  }
  if (input.signal !== null) {
    return { status: "crashed", message: `orchestrator crashed (signal ${input.signal})` };
  }
  return { status: "stopped", message: "orchestrator exited" };
}

/** The default grace period the supervisor waits after SIGTERM before escalating
 *  to SIGKILL — long enough for the orchestrator to drain a Poll tick and dispose
 *  its sandboxes, short enough that a wedged child doesn't hang the Live tab (#93). */
export const DEFAULT_STOP_GRACE_MS = 10_000;

/** The side effects {@link createStopEscalation} drives, injected so the pure
 *  escalation decision is unit-testable against a fake clock and signal spies. */
export interface StopEscalationDeps {
  /** Ask the child to stop gracefully (SIGTERM). */
  sigterm(): void;
  /** Force the child down (SIGKILL) after it ignored SIGTERM. */
  sigkill(): void;
  /** Arm a one-shot timer for `ms`; returns a function that cancels it. */
  setTimer(ms: number, fn: () => void): () => void;
  /** How long to wait after SIGTERM before escalating to SIGKILL. */
  graceMs: number;
}

/** The escalation handle the supervisor drives: {@link StopEscalation.stop} begins
 *  a graceful stop, {@link StopEscalation.onExit} tells it the child is gone. */
export interface StopEscalation {
  /** Begin a graceful stop: SIGTERM now, SIGKILL after the grace period if the
   *  child has not exited. Idempotent — repeated calls do not re-signal. */
  stop(): void;
  /** The child has exited; cancel any pending SIGKILL. */
  onExit(): void;
}

/**
 * The pure stop-escalation state machine behind the supervisor's Stop (#93). A
 * wedged orchestrator that ignores SIGTERM would otherwise stay alive forever, so
 * `stop()` sends SIGTERM and arms a grace timer; if the child has not exited when
 * the timer fires it is escalated to SIGKILL. A child that exits promptly calls
 * `onExit()` first, which cancels the timer — so a well-behaved child is *never*
 * SIGKILLed.
 *
 * All I/O (signals, the clock) is injected via {@link StopEscalationDeps}, so the
 * escalation decision is unit-testable with a fake timer, with the thin imperative
 * layer in {@link spawnOrchestrator} doing the actual `child.kill` / `setTimeout`.
 */
export function createStopEscalation(deps: StopEscalationDeps): StopEscalation {
  let phase: "idle" | "terminating" | "done" = "idle";
  let cancelTimer: (() => void) | null = null;

  return {
    stop() {
      if (phase !== "idle") return; // already stopping (or gone) — don't re-signal
      phase = "terminating";
      deps.sigterm();
      cancelTimer = deps.setTimer(deps.graceMs, () => {
        cancelTimer = null;
        if (phase === "terminating") deps.sigkill();
      });
    },
    onExit() {
      phase = "done";
      if (cancelTimer) {
        cancelTimer();
        cancelTimer = null;
      }
    },
  };
}

/** How to launch the orchestrator child. Injected (rather than hard-coded) so
 *  the supervisor's wiring can be integration-tested against a fake emitter,
 *  mirroring this codebase's env/dep injection style (`createEvents`, `logPath`). */
export interface SpawnConfig {
  readonly command: string;
  // readonly so callers can pass an `as const` literal (e.g. ORCHESTRATOR_SPAWN);
  // the supervisor only ever reads args, and node's spawn() accepts readonly too.
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Grace period (ms) after SIGTERM before the supervisor escalates to SIGKILL;
   *  defaults to {@link DEFAULT_STOP_GRACE_MS}. Injectable so the escalation is
   *  integration-testable without a real 10s wait (#93). */
  readonly graceMs?: number;
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
  /** Flag this exit as user-requested and stop the child: SIGTERM, then SIGKILL
   *  after the grace period if it has not exited (#93). */
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
  let forced = false;
  let outBuffer = "";
  let errBuffer = "";

  const child: ChildProcess = spawn(config.command, config.args, {
    cwd: config.cwd,
    env: config.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Escalate a Stop from SIGTERM to SIGKILL if the child wedges (#93). The
  // decision is the pure createStopEscalation; this layer just does the
  // signalling and real-clock timer.
  const escalation = createStopEscalation({
    sigterm: () => child.kill("SIGTERM"),
    sigkill: () => {
      forced = true;
      child.kill("SIGKILL");
    },
    setTimer: (ms, fn) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
    graceMs: config.graceMs ?? DEFAULT_STOP_GRACE_MS,
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
    escalation.onExit(); // child is gone — cancel any pending SIGKILL
    const exit = describeChildExit({ code, signal, stoppedByUser, forced });
    handlers.onExit(exit.status, exit.message);
  });

  return {
    stop() {
      stoppedByUser = true;
      escalation.stop();
    },
  };
}

/** What a Pool slot in the in-flight list is doing: an agent Session's
 *  {@link OrchestratorRole}, or the agent-free `"landing"` phase (ADR-0012).
 *  A Landing is not a Session but still occupies a slot, so it appears here. */
export type InFlightRole = OrchestratorRole | "landing";

/** One currently-occupied Pool slot in the Live tab's in-flight list: an issue
 *  and the **phase** running for it — an Implementer/Reviewer Session or the
 *  agent-free Landing. Derived purely from the structured event stream — an
 *  entry is added on `dispatch` / `landing-started` and removed on
 *  `session-resolved` / `landing-landed` / `landing-failed` (never from the
 *  Manifest, which only gains a row *after* a slot resolves, ADR-0008). */
export interface InFlightEntry {
  readonly issue: number;
  readonly role: InFlightRole;
  /** The PR under review/landing; null for an Implementer (no PR yet). */
  readonly pr: number | null;
  /** The issue title (Implementer dispatch only; null for Reviewer/Landing). */
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
 * - `dispatch` / `landing-started` **add** an in-flight entry, keyed by issue
 *   number so an issue moving implement→review→land replaces its phase in place
 *   (mirrors the orchestrator's issue/PR-keyed In-flight set, CONTEXT.md) rather
 *   than stacking duplicates.
 * - `session-resolved` / `landing-landed` / `landing-failed` **remove** the
 *   entry for that issue.
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
    case "landing-started": {
      const rest = view.inflight.filter((e) => e.issue !== event.issue);
      const entry: InFlightEntry = {
        issue: event.issue,
        role: "landing",
        pr: event.pr,
        title: null,
      };
      return { ...view, inflight: [...rest, entry] };
    }
    case "session-resolved":
    case "landing-landed":
    case "landing-failed":
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
 * Reviewer or Landing shows the PR it is acting on (`rev PR #90 (#44)`,
 * `land PR #90 (#44)`). Pure so the exact strings are unit-testable.
 */
export function formatInFlight(entry: InFlightEntry): string {
  if (entry.role === "implementer") {
    return `impl #${entry.issue}${entry.title ? ` · ${entry.title}` : ""}`;
  }
  const tag = entry.role === "landing" ? "land" : roleAbbr(entry.role);
  return `${tag} PR #${entry.pr} (#${entry.issue})`;
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

// ── Flatten the prune buckets into one pager-scrollable list (ADR-0015) ────────
//
// The Maintenance tab no longer stacks its 5–6 buckets as separate boxes (which
// overflow the terminal once the plan is large); it flattens them into a single
// ordered list of rows the shared viewport reducer scrolls as one offset.
// Bucket headers stay inline as separators, so the operator still reads the
// plan category-by-category; apply is all-or-nothing, so there is no per-row
// cursor to track. Pure so the layout is unit-testable without the Ink layer.

/** A row's semantic tone — `warn` is the kept (skipped-dirty) bucket surfaced in
 *  yellow; every other bucket is `normal`. Carried on the row (not derived from
 *  the label) so the shell's colour choice is stable, not string-matched. */
export type PruneRowTone = "normal" | "warn";

/** One row of the flattened Maintenance prune list (ADR-0015). A `bucket-header`
 *  is an inline separator carrying its bucket's label + live count (and tone);
 *  an `item` is one concrete deletion (a run-log path, a worktree, or a branch).
 *  Flattening lets the pager scroll a single offset over every bucket at once —
 *  apply is all-or-nothing, so nothing here is selectable. */
export type PruneRow =
  | { kind: "bucket-header"; label: string; count: number; tone: PruneRowTone }
  | { kind: "item"; text: string };

/** The bucket order the Maintenance preview always lays out (ADR-0004): the
 *  five standard deletion buckets in a fixed reading order, with the kept
 *  skipped-dirty bucket appended only when non-empty. Defined as data so the
 *  flatten (and its tests) reference one source of truth for the ordering. */
export function pruneBuckets(plan: PrunePlan): {
  readonly label: string;
  readonly tone: PruneRowTone;
  readonly items: readonly (string | PruneWorktree)[];
}[] {
  const standard: { label: string; tone: PruneRowTone; items: readonly (string | PruneWorktree)[] }[] =
    [
      { label: "Run logs to delete", tone: "normal", items: plan.runLogs },
      { label: "Merged worktrees to remove", tone: "normal", items: plan.removableWorktrees },
      {
        label: "Merged sandcastle branches to delete",
        tone: "normal",
        items: plan.deletableBranches,
      },
      {
        label: "Leftover Merger worktrees to remove",
        tone: "normal",
        items: plan.removableMergerWorktrees,
      },
      {
        label: "Leftover Merger branches to force-delete",
        tone: "normal",
        items: plan.deletableMergerBranches,
      },
    ];
  // The skipped-dirty bucket is surfaced only when there is something to warn
  // about — mirroring the prior per-bucket preview, which rendered it
  // conditionally. Kept items carry the `warn` tone so the shell paints them
  // yellow without string-matching the label.
  if (plan.skippedDirtyWorktrees.length > 0) {
    standard.push({
      label: "⚠ Skipped — uncommitted changes (kept)",
      tone: "warn",
      items: plan.skippedDirtyWorktrees,
    });
  }
  return standard;
}

/** Render one prune item to its row text. Run logs and branch names are plain
 *  strings shown verbatim (matching the prior per-bucket preview); a worktree
 *  shows its repo-relative path plus the branch checked out in it. Pure. */
export function pruneItemText(item: string | PruneWorktree, repoRoot: string): string {
  if (typeof item === "string") return item;
  const rel = item.path.replace(repoRoot + "/", "");
  return `${rel} [${item.branch}]`;
}

/**
 * Flatten a prune plan into one ordered list of rows the Maintenance pager
 * scrolls as a single viewport (ADR-0015). The five standard buckets always
 * appear (in {@link pruneBuckets}' fixed order) as header rows carrying their
 * live count, followed by their item rows; the kept skipped-dirty bucket is
 * appended (header + items) only when non-empty. Worktree paths are
 * repo-relativized via {@link pruneItemText} so the rows stay compact, exactly
 * as the prior per-bucket preview rendered them — only the layout changes
 * (stacked boxes → one scrollable list), not the content. Pure (plan + repoRoot
 * in, rows out) so the whole flatten is unit-testable without the Ink layer.
 */
export function flattenPrunePlan(plan: PrunePlan, repoRoot: string): PruneRow[] {
  const rows: PruneRow[] = [];
  for (const bucket of pruneBuckets(plan)) {
    rows.push({ kind: "bucket-header", label: bucket.label, count: bucket.items.length, tone: bucket.tone });
    for (const item of bucket.items) {
      rows.push({ kind: "item", text: pruneItemText(item, repoRoot) });
    }
  }
  return rows;
}

// ── Alternate screen buffer (ADR-0015) ───────────────────────────────────────

/** Enter the alternate screen buffer (`ESC[?1049h`) — the blank full-height
 *  canvas vim/less/htop take over. Written once on Cockpit mount in a TTY. */
export const ENTER_ALT_SCREEN = "\x1b[?1049h";

/** Restore the normal screen buffer (`ESC[?1049l`) — switch back so the
 *  operator's prior terminal contents/scrollback reappear intact on quit. */
export const RESTORE_NORMAL_SCREEN = "\x1b[?1049l";

/** Decide whether the Cockpit should take over the alternate screen buffer:
 *  only in a real TTY. A piped/non-TTY run must stay in the normal buffer and
 *  emit NO alt-screen escapes (ADR-0015: it still renders, it just does not grab
 *  the canvas). Pure so the gate is unit-testable without a live stream. */
export function shouldUseAltScreen(stdout: { isTTY?: boolean }): boolean {
  return stdout.isTTY === true;
}

// ── Viewport + follow-mode reducer (ADR-0015) ─────────────────────────────────
//
// The shared, pure scroll model behind every long Cockpit panel. Each panel's
// scroll region is a `flexGrow` Box whose real height is measured (Ink's
// `measureElement`); the panel slices its content to that height via the
// `offset` here, and `follow` decides whether new content re-tails the view. The
// Live event log runs it in always-following (tail) mode; later panels (the
// Maintenance pager, a scrollback-able log) reuse the same transitions. The .tsx
// shell only wires refs + measureElement + keystrokes onto this pure core.

/** The scrollable viewport state shared by every long panel. */
export interface ViewportState {
  /** Rows scrolled down from the top, clamped into `[0, max(lines-height, 0)]`. */
  readonly offset: number;
  /** True in tail/auto-follow mode (the view tracks new content); false once the
   *  user scrolls up — a paused view is not yanked by live events. */
  readonly follow: boolean;
}

/** The tail-following zero state a fresh viewport starts in (ADR-0015). The Live
 *  event log never leaves follow, so it always shows the newest events. */
export const FOLLOWING_VIEWPORT: ViewportState = { offset: 0, follow: true };

/** A user scroll request against a viewport. `home`/`end` jump to the top/bottom
 *  (and re-engage / pause follow); `line`/`page` step by one row or one viewport
 *  height. */
export type ViewportScroll =
  | { kind: "line"; dir: -1 | 1 }
  | { kind: "page"; dir: -1 | 1 }
  | { kind: "home" }
  | { kind: "end" };

/** One viewport transition. `content` reconciles to new dimensions/content (it
 *  is also dispatched on terminal resize, when the measured height changes);
 *  `scroll` applies a user scroll step. Both carry the panel's current `lines`
 *  and `height` so the offset can be clamped. */
export type ViewportInput =
  | { kind: "content"; lines: number; height: number }
  | { kind: "scroll"; step: ViewportScroll; lines: number; height: number };

/** Clamp `offset` into the valid `[0, max(lines-height, 0)]` range — the largest
 *  offset at which the last `height` rows still fully fit. 0 once everything fits
 *  (height >= lines), and 0 defensively for a non-positive height. Pure. */
export function clampViewportOffset(offset: number, lines: number, height: number): number {
  if (height <= 0) return 0;
  const max = Math.max(0, lines - height);
  if (offset <= 0) return 0;
  if (offset >= max) return max;
  return offset;
}

/** The tail offset — the start of the last `height` rows — so a following
 *  viewport always shows the newest content. Pure. */
export function tailViewportOffset(lines: number, height: number): number {
  return clampViewportOffset(Number.POSITIVE_INFINITY, lines, height);
}

/** Advance a viewport by one input, keeping the offset clamped and the follow
 *  flag consistent (ADR-0015):
 *
 *  - `content` (new lines / resize): a following view re-tails; a paused view
 *    holds its offset (clamped) so a live stream never yanks a scrolled-up view
 *    back down.
 *  - `scroll` `end`: jump to the tail AND re-engage follow.
 *  - `scroll` `home`: jump to the top AND pause follow.
 *  - `scroll` `line`/`page` up: step back and PAUSE follow (the paused indicator
 *    shows; new content will not move the view).
 *  - `scroll` `line`/`page` down: step forward (clamped at the tail); leaves
 *    follow as-is — a following view stays following, a paused view stays paused
 *    (only `end` re-engages the tail).
 *
 *  Pure (state + input in, new state out) so every transition is unit-testable
 *  without the Ink layer. */
export function reduceViewport(state: ViewportState, input: ViewportInput): ViewportState {
  if (input.kind === "content") {
    if (state.follow) {
      return { offset: tailViewportOffset(input.lines, input.height), follow: true };
    }
    return { offset: clampViewportOffset(state.offset, input.lines, input.height), follow: false };
  }
  const { step, lines, height } = input;
  if (step.kind === "end") {
    return { offset: tailViewportOffset(lines, height), follow: true };
  }
  if (step.kind === "home") {
    return { offset: 0, follow: false };
  }
  const delta = step.kind === "line" ? step.dir : step.dir * Math.max(1, height);
  const offset = clampViewportOffset(state.offset + delta, lines, height);
  // Up-steps always pause follow; down-steps leave it exactly as-is.
  const follow = step.dir < 0 ? false : state.follow;
  return { offset, follow };
}

/** The structural slice of Ink's `Key` that {@link viewportScrollFromKey}
 *  inspects — the navigation bits shared by the Live log and the Maintenance
 *  pager. Mirrors {@link InputKey} (the global router's slice) in shape. */
export interface ScrollKey {
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly pageUp?: boolean;
  readonly pageDown?: boolean;
  readonly home?: boolean;
  readonly end?: boolean;
}

/**
 * Map one Ink key chord to a {@link ViewportScroll} step, or `null` when it is
 * not a scroll key. Shared by both scrolling Cockpit panels (ADR-0015): the Live
 * event log's Follow mode and the Maintenance pager answer the SAME chord —
 * ↑/↓ line, PgUp/PgDn page, g/Home top, G/End tail — so an operator's fingers
 * move identically between them. `G`/End resolve to `end` (which
 * {@link reduceViewport} wires to re-engage Follow), and `g`/Home to `home`
 * (which pauses it).
 *
 * Returns `null` for every key that is NOT a scroll key — critically including
 * the Maintenance apply controls `a`/`y`/`n`/`r` and the Live action keys
 * (Enter/`p`) — so this chord never collides with a panel's other controls (the
 * issue's AC). Pure (input + key in, step out) so the whole chord + the
 * non-collision guarantee are unit-testable without Ink.
 */
export function viewportScrollFromKey(input: string, key: ScrollKey): ViewportScroll | null {
  if (key.upArrow) return { kind: "line", dir: -1 };
  if (key.downArrow) return { kind: "line", dir: 1 };
  if (key.pageUp) return { kind: "page", dir: -1 };
  if (key.pageDown) return { kind: "page", dir: 1 };
  if (input === "g" || key.home) return { kind: "home" };
  if (input === "G" || key.end) return { kind: "end" };
  return null;
}
