/**
 * Sandcastle live-feed observability.
 *
 * The parallel Phase-2 agents (up to `MAX_PARALLEL`) write only to their own
 * `.sandcastle/logs/*.log` Run log files, so it is near-impossible to see what
 * any of them is doing in real time. This module is the seam that mirrors a
 * lossy, glanceable view of each agent onto the orchestrator's stdout — the
 * **Live feed** (see CONTEXT.md glossary), distinct from the lossless
 * **Transcript** (sourced from the captured session JSONL, see
 * docs/adr/0001-relocate-and-source-transcripts-from-session-jsonl.md).
 *
 * `observe(label)` returns a file-mode sandcastle `logging` config whose
 * `onAgentStreamEvent` handler prints one prefixed line per event. File mode is
 * required: sandcastle only invokes `onAgentStreamEvent` in log-to-file mode.
 * The returned config keeps a real `path` under `.sandcastle/logs/` so the
 * existing Run-log-to-file behavior is preserved — only the filename is now
 * `<stamp>-<slug>.log` (slug-stamped by the label) instead of sandcastle's
 * branch-derived default, because the branch is not known at `observe()` time.
 *
 * By default only `toolCall` events are printed (the live feed is "is it stuck
 * / what is it touching"). `text` is fragmented by sandcastle's
 * `TextDeltaBuffer` and noisy across interleaved agents, so it — and `raw` —
 * are suppressed unless `SANDCASTLE_VERBOSE=1`, which also flips on sandcastle's
 * own `logging.verbose` for deep single-agent debugging.
 *
 * Note: pi `thinking` blocks are not surfaced as a live event by sandcastle, so
 * reasoning never appears here — intentionally. Live = actions; Transcript =
 * full reasoning.
 */
import { join } from "node:path";
import type { AgentStreamEvent, LoggingOption } from "@ai-hero/sandcastle";

const TOOL_GLYPH = "▶";
const TEXT_GLYPH = "»";
const RAW_GLYPH = "#";
const LIFE_GLYPH = "●";
const OK_GLYPH = "✓";

/** A lifecycle marker kind emitted by the orchestrator around `run()` calls. */
export type LifecycleKind = "start" | "done" | "sandbox" | "commits";

/** Environment accessor, overridable for tests. */
type Env = Record<string, string | undefined>;

/** True iff the verbose live feed is requested (text + raw + sandcastle verbose). */
export function isVerbose(env: Env = process.env): boolean {
  return env.SANDCASTLE_VERBOSE === "1";
}

/**
 * Format one agent stream event as a single prefixed stdout line, or `null`
 * when the event is suppressed by the current verbosity.
 *
 * Pure and env-free so the formatting rules are unit-testable in isolation.
 */
export function formatStreamLine(
  label: string,
  event: AgentStreamEvent,
  verbose: boolean,
): string | null {
  const prefix = `[${label}]`;
  switch (event.type) {
    case "toolCall":
      return `${prefix} ${TOOL_GLYPH} ${event.name}(${firstLine(event.formattedArgs)})`;
    case "text":
      return verbose ? `${prefix} ${TEXT_GLYPH} ${event.message}` : null;
    case "raw":
      return verbose ? `${prefix} ${RAW_GLYPH} ${event.line}` : null;
  }
}

/** Format a lifecycle marker line for the orchestrator's own transitions. */
export function formatLifecycleLine(
  label: string,
  kind: LifecycleKind,
  detail?: number,
): string {
  const prefix = `[${label}]`;
  switch (kind) {
    case "start":
      return `${prefix} ${LIFE_GLYPH} start`;
    case "done":
      return `${prefix} ${LIFE_GLYPH} done`;
    case "sandbox":
      return `${prefix} ${LIFE_GLYPH} sandbox ready`;
    case "commits": {
      const n = detail ?? 0;
      return `${prefix} ${OK_GLYPH} ${n} commit${n === 1 ? "" : "s"}`;
    }
  }
}

/** Bound lifecycle markers for a single agent label. */
export interface LifecycleMarkers {
  /** Agent invocation started. */
  start(): void;
  /** Agent invocation finished. */
  done(): void;
  /** Sandbox / worktree ready for the agent (after `createSandbox`). */
  sandbox(): void;
  /** Report the number of commits an agent produced. */
  commits(n: number): void;
}

/**
 * Bound prefixed lifecycle markers for `label`. Each call prints one
 * `formatLifecycleLine` to stdout.
 */
export function lifecycle(label: string): LifecycleMarkers {
  const emit = (kind: LifecycleKind, detail?: number) =>
    console.log(formatLifecycleLine(label, kind, detail));
  return {
    start: () => emit("start"),
    done: () => emit("done"),
    sandbox: () => emit("sandbox"),
    commits: (n: number) => emit("commits", n),
  };
}

/**
 * Build the Run-log file path for an agent. Lands under `.sandcastle/logs/` and
 * is unique per call: the stamp carries millisecond resolution and the slug
 * carries the label, so concurrent agents (distinct labels) and successive runs
 * of the same label never collide.
 *
 * `now` is injectable for deterministic tests.
 */
export function logPath(label: string, now: Date = new Date()): string {
  const slug =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "");
  return join(process.cwd(), ".sandcastle", "logs", `${stamp}-${slug}.log`);
}

/**
 * Build a file-mode `logging` config whose `onAgentStreamEvent` prints prefixed
 * `toolCall` lines (plus `text`/`raw` when verbose) to the orchestrator's
 * stdout. Wire into every `pi()` agent `run()` via the `logging` option.
 *
 * Verbosity is read once at construction time and threaded into both the
 * handler's suppression and sandcastle's own `logging.verbose`.
 */
export function observe(label: string): LoggingOption {
  const verbose = isVerbose();
  return {
    type: "file",
    path: logPath(label),
    verbose,
    onAgentStreamEvent: (event: AgentStreamEvent) => {
      const line = formatStreamLine(label, event, verbose);
      if (line !== null) console.log(line);
    },
  };
}

/** Take the first line of a (possibly multi-line) string, trimmed. */
function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return (nl === -1 ? s : s.slice(0, nl)).trim();
}
