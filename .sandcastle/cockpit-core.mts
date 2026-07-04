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
