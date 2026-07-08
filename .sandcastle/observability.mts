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
 *
 * This module also owns the **Manifest** (`.sandcastle/sessions/manifest.jsonl`):
 * an append-only index — one line per resolved agent `run()` — that maps each
 * human-meaningful Run/phase/issue to its captured session id/path, commits, and
 * usage (see docs/adr/0001-relocate-and-source-transcripts-from-session-jsonl.md).
 * Entries are appended at run resolution (never batched) so a crashed or
 * Ctrl-C'd Run still leaves a complete record; a rejected `run()` still gets a
 * best-effort `status: "failed"` entry with the error and timing, and — when a
 * session JSONL was captured before the crash — a best-effort Transcript link
 * resolved from the sessions dir (issue #94), so the failures you most need to
 * audit are viewable in the Session browser and render CLI instead of showing
 * "not available locally".
 */
import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentStreamEvent,
  IterationResult,
  IterationUsage,
  LoggingOption,
} from "@ai-hero/sandcastle";
import type { ParsedOutcome } from "./dispatch.mts";

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
 * Which stream the per-agent Live-feed prose (lifecycle markers + observe
 * stream lines) writes to. In structured-event mode
 * (`SANDCASTLE_EVENT_FORMAT=ndjson`) the orchestrator's typed event stream owns
 * stdout as one JSON object per line (see `events.mts`; ADR-0008), so this lossy
 * per-agent prose yields stdout and moves to stderr — still glanceable to a
 * developer watching the child process, but never corrupting the NDJSON the
 * Cockpit parses. In prose mode (default) it stays on stdout, unchanged. Pure
 * + env-injected so the routing is unit-testable in isolation.
 */
export function liveProseStream(env: Env = process.env): "stdout" | "stderr" {
  return env.SANDCASTLE_EVENT_FORMAT === "ndjson" ? "stderr" : "stdout";
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
  verbose: boolean
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
export function formatLifecycleLine(label: string, kind: LifecycleKind, detail?: number): string {
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
 * `formatLifecycleLine` — to stdout in prose mode, or to stderr in structured-
 * event mode (so it never corrupts the NDJSON the Cockpit parses on stdout).
 */
export function lifecycle(label: string): LifecycleMarkers {
  const useStderr = liveProseStream() === "stderr";
  const emit = (kind: LifecycleKind, detail?: number) => {
    const line = formatLifecycleLine(label, kind, detail);
    // Looked up at call time (not captured) so test spies on console.log/error
    // intercept the write.
    if (useStderr) console.error(line);
    else console.log(line);
  };
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
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "");
  return join(process.cwd(), ".sandcastle", "logs", `${stamp}-${slug}.log`);
}

/**
 * Build a file-mode `logging` config whose `onAgentStreamEvent` prints prefixed
 * `toolCall` lines (plus `text`/`raw` when verbose) — to stdout in prose mode,
 * or to stderr in structured-event mode so it never corrupts the NDJSON the
 * Cockpit parses on stdout. Wire into every `pi()` agent `run()` via the
 * `logging` option.
 *
 * Verbosity is read once at construction time and threaded into both the
 * handler's suppression and sandcastle's own `logging.verbose`.
 */
// Always the file-mode variant (sandcastle only fires onAgentStreamEvent when
// logging to a file). Narrowing from the LoggingOption union lets callers reach
// `path`/`onAgentStreamEvent` without re-narrowing.
export function observe(label: string): Extract<LoggingOption, { type: "file" }> {
  const verbose = isVerbose();
  const useStderr = liveProseStream() === "stderr";
  return {
    type: "file",
    path: logPath(label),
    verbose,
    onAgentStreamEvent: (event: AgentStreamEvent) => {
      const line = formatStreamLine(label, event, verbose);
      if (line === null) return;
      // Looked up at call time (not captured) so test spies intercept the write.
      if (useStderr) console.error(line);
      else console.log(line);
    },
  };
}

/** Take the first line of a (possibly multi-line) string, trimmed. */
function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return (nl === -1 ? s : s.slice(0, nl)).trim();
}

// ---- Manifest (issue #53) -------------------------------------------------

/** Extract a human-readable message from an unknown throwable. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Absolute path to the relocated sessions dir (gitignored). Passed as
 * `sessionStorage.hostSessionsDir` to every `pi()` call so captured session
 * JSONL lands under `<sessionsDir>/--<encoded-cwd>--/` in the repo instead of
 * mixing with the developer's other local pi sessions. The encoded-cwd subdir
 * is load-bearing for pi resume and must not be flattened — see ADR 0001.
 */
export const sessionsDir = join(process.cwd(), ".sandcastle", "sessions");

/** Absolute path to the append-only session manifest. */
export const manifestPath = join(sessionsDir, "manifest.jsonl");

/**
 * Structural slice of a sandcastle run result, common to both top-level `run()`
 * and sandbox `run()`, used to build manifest entries without coupling to either
 * concrete type. Both `RunResult` and `SandboxRunResult` are assignable.
 */
export interface RunLike {
  readonly iterations: ReadonlyArray<IterationResult>;
  readonly commits: ReadonlyArray<{ sha: string }>;
}

/**
 * The {@link RunLike} for an agent-free phase — a Landing (ADR-0012). A Landing
 * runs no agent, so it captures no Session (no iterations) and produces no
 * commits of its own (the branch was already committed by the Implementer). Fed
 * to {@link buildManifestEntry} it yields a null session / usage and 0 commits,
 * so the Landing appears in the Manifest under the issue's runId as an entry
 * with no Transcript link — exactly what "agent-free entry" means.
 */
export const agentFreeResult: RunLike = { iterations: [], commits: [] };

/** Fields describing a captured session, extracted from the last iteration. */
export interface SessionSlice {
  readonly sessionId?: string;
  readonly sessionFile?: string;
  readonly usage?: IterationUsage;
}

/**
 * Extract the session id / file / usage from the last iteration that captured
 * one. The run's "session" is the final iteration's; earlier iterations are
 * retries. Returns `{}` when no iteration captured a session (e.g. capture
 * disabled) so callers can fall back to nulls uniformly.
 *
 * Pure and env-free so it is unit-testable in isolation.
 */
export function lastSession(result: RunLike): SessionSlice {
  for (let i = result.iterations.length - 1; i >= 0; i--) {
    const it = result.iterations[i];
    if (it.sessionId || it.sessionFilePath) {
      return { sessionId: it.sessionId, sessionFile: it.sessionFilePath, usage: it.usage };
    }
  }
  return {};
}

/**
 * One row in the append-only session manifest. Carries the full field set per
 * issue #53: `{ runId, phase, issue, branch, sessionId, sessionFile, commits,
 * usage, startedAt, endedAt, status }`, plus `error` on failed entries only.
 */
export interface ManifestEntry {
  /** Groups an issue's lifecycle (impl/rev, plus its agent-free `land` entry) as a
   *  deterministic run-issue-<n>, or a per-invocation stamp for the cross-issue
   *  Planner (CONTEXT.md: Run). */
  readonly runId: string;
  /** Orchestrator phase that produced this entry: planner | impl | rev | land
   *  (the agent-free Landing, ADR-0012). */
  readonly phase: string;
  /** GitHub issue number the session worked on, or null for orchestrator-wide phases. */
  readonly issue: number | null;
  /** Branch the session worked on, or null for host phases with no single branch. */
  readonly branch: string | null;
  /** Captured pi/Claude session id (key to the transcript file), or null when unavailable. */
  readonly sessionId: string | null;
  /** Host path sandcastle reported for the session, or null. For pi this is the
   *  session directory (sandcastle's `hostSessionFilePath` ignores the id); the
   *  exact file is `<sessionFile>/*_<sessionId>.jsonl`, found via `sessionId`. */
  readonly sessionFile: string | null;
  /** Number of commits the agent produced. 0 for failed / commit-less runs. */
  readonly commits: number;
  /** Token usage from the session iteration, or null when the provider reports none. */
  readonly usage: IterationUsage | null;
  /** ISO timestamp when the agent run() started. */
  readonly startedAt: string;
  /** ISO timestamp when the agent run() resolved. */
  readonly endedAt: string;
  /** "ok" for a resolved run, "failed" for a rejected one. */
  readonly status: "ok" | "failed";
  /** The structured Outcome the Session self-reported (ADR-0011), or null when
   *  the phase reports none (impl/planner/land) or the Session produced no
   *  parseable Outcome (a failed attempt against the Retry budget). Lets the
   *  Session browser show pass/give-up/no-outcome at a glance. */
  readonly outcome: ParsedOutcome | null;
  /** The concrete model this Session actually ran on (e.g. `litellm/glm-5.2`,
   *  `claude-opus-4-8`), resolved at dispatch from the active Model profile's map
   *  for the phase's role (ADR-0016). Null for an agent-free Landing (ADR-0012),
   *  which runs no agent and has no model. The profile name is reconstructable;
   *  the resolved model is the fact worth persisting for cost/quality audits. */
  readonly resolvedModel: string | null;
  /** Present only on failed entries: the error message. */
  readonly error?: string;
}

/** Arguments shared by both manifest entry builders. */
interface ManifestEntryArgs {
  readonly runId: string;
  readonly phase: string;
  readonly issue?: number | null;
  readonly branch?: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date;
  /** The concrete model resolved for this Session's role at dispatch (ADR-0016),
   *  or null/omitted for an agent-free Landing that ran no agent (ADR-0012). */
  readonly resolvedModel?: string | null;
}

/**
 * Build a manifest entry for a successfully resolved agent run. Pure and
 * env-free so the field set + nulling rules are unit-testable in isolation.
 */
export function buildManifestEntry(
  args: ManifestEntryArgs & { result: RunLike; outcome?: ParsedOutcome | null }
): ManifestEntry {
  const session = lastSession(args.result);
  return {
    runId: args.runId,
    phase: args.phase,
    issue: args.issue ?? null,
    branch: args.branch ?? null,
    sessionId: session.sessionId ?? null,
    sessionFile: session.sessionFile ?? null,
    commits: args.result.commits.length,
    usage: session.usage ?? null,
    startedAt: args.startedAt.toISOString(),
    endedAt: args.endedAt.toISOString(),
    status: "ok",
    outcome: args.outcome ?? null,
    resolvedModel: args.resolvedModel ?? null,
  };
}

/**
 * A resolved Transcript link for a failed run: the captured session JSONL and
 * (best-effort) the session id parsed from its filename. `usage` and `commits`
 * remain unknown on the failure path, so they are not part of this slice.
 */
export interface ResolvedSession {
  readonly sessionId: string | null;
  readonly sessionFile: string;
}

/**
 * Build a best-effort manifest entry for a rejected agent run. The generic
 * `run()` failure carries no `RunResult`, so `commits` / `usage` are left 0/null.
 *
 * When `session` is supplied (resolved via {@link resolveFailedSessionFile}) its
 * `sessionFile` / `sessionId` are recorded so the failure's Transcript — the
 * session JSONL captured before the crash — is viewable in the Session browser
 * and render CLI. When it is absent (nothing captured), both stay null and the
 * browser renders the existing "not available locally" note. The error is
 * stringified for the record. Pure and env-free so the field set is unit-testable.
 */
export function buildFailedManifestEntry(
  args: ManifestEntryArgs & { error: unknown; session?: ResolvedSession | null }
): ManifestEntry {
  return {
    runId: args.runId,
    phase: args.phase,
    issue: args.issue ?? null,
    branch: args.branch ?? null,
    sessionId: args.session?.sessionId ?? null,
    sessionFile: args.session?.sessionFile ?? null,
    commits: 0,
    usage: null,
    startedAt: args.startedAt.toISOString(),
    endedAt: args.endedAt.toISOString(),
    status: "failed",
    outcome: null,
    resolvedModel: args.resolvedModel ?? null,
    error: errorMessage(args.error),
  };
}

// ---- Failed-run Transcript resolution (issue #94) -------------------------

/** A captured session JSONL candidate: its absolute path and mtime in ms. */
export interface SessionCandidate {
  readonly file: string;
  readonly mtimeMs: number;
}

/** The half-open run window a failed session's JSONL must have been written in. */
export interface RunWindow {
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/**
 * Pick the session JSONL captured by a now-failed `run()`, best-effort: the
 * newest candidate whose mtime falls within the run's `[startedAt, endedAt]`
 * window. The window is load-bearing — it excludes JSONL left by *earlier*
 * completed runs (mtime < startedAt), so a run that captured nothing resolves to
 * `null` (keeping the "not available" behavior) instead of mislinking a prior
 * run's Transcript. Under parallelism several sessions may share the window;
 * newest-wins is the documented heuristic and ties resolve to input order.
 *
 * Pure and fs-free so the selection rule is unit-testable in isolation.
 */
export function pickFailedSessionFile(
  candidates: readonly SessionCandidate[],
  window: RunWindow
): string | null {
  const startMs = window.startedAt.getTime();
  const endMs = window.endedAt.getTime();
  let best: SessionCandidate | null = null;
  for (const c of candidates) {
    if (c.mtimeMs < startMs || c.mtimeMs > endMs) continue;
    if (best === null || c.mtimeMs > best.mtimeMs) best = c;
  }
  return best ? best.file : null;
}

/**
 * Parse the pi session id from a `<stamp>_<sessionId>.jsonl` filename, or `null`
 * when the name has no `_<id>.jsonl` suffix. Pure. The id is a convenience for
 * the record — resolution/render locate the Transcript by the `sessionFile` path
 * directly, so a null here never breaks viewing.
 */
export function sessionIdFromFile(file: string): string | null {
  const base = file.split(/[/\\]/).pop() ?? file;
  const m = base.match(/_([^_]+)\.jsonl$/);
  return m ? m[1] : null;
}

/** Recursively collect every `*.jsonl` under `dir` with its mtime. Never throws. */
async function collectSessionCandidates(dir: string): Promise<SessionCandidate[]> {
  const out: SessionCandidate[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let names: string[];
    try {
      names = await readdir(current);
    } catch {
      continue; // unreadable / missing dir — skip
    }
    for (const name of names) {
      const full = join(current, name);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) stack.push(full);
      else if (s.isFile() && name.endsWith(".jsonl")) out.push({ file: full, mtimeMs: s.mtimeMs });
    }
  }
  return out;
}

/**
 * Resolve the Transcript link for a failed run best-effort: scan `baseDir` (the
 * sessions dir, laid out `<baseDir>/--<encoded-cwd>--/<stamp>_<id>.jsonl` per
 * ADR 0001) for session JSONL and {@link pickFailedSessionFile} the newest one
 * written during the run window. Returns `null` when nothing was captured in the
 * window. Never throws — observability must not break the run — so any fs error
 * degrades to `null` (the caller records a null link, unchanged from before).
 */
export async function resolveFailedSessionFile(
  window: RunWindow,
  baseDir: string = sessionsDir
): Promise<ResolvedSession | null> {
  try {
    const file = pickFailedSessionFile(await collectSessionCandidates(baseDir), window);
    return file ? { sessionFile: file, sessionId: sessionIdFromFile(file) } : null;
  } catch (err) {
    console.error(`[manifest] failed to resolve transcript for failed run: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Generate a `runId`. When `issueNumber` is given, returns a deterministic
 * `run-issue-<n>` id that is stable for that issue's whole lifecycle — its
 * Implementer and Reviewer Sessions and its agent-free Landing all share it
 * (mirrors the `sandcastle/issue-N` branch), so auditing everything that happened to an issue
 * is a single lookup. When omitted, returns a unique per-invocation
 * millisecond-stamped id — the cross-issue **Planner** Session's id, which has no
 * issue to bind to (CONTEXT.md: Run). `now` is injectable for deterministic
 * tests of the per-invocation path and is ignored on the deterministic path.
 */
export function generateRunId(issueNumber?: number, now: Date = new Date()): string {
  if (issueNumber !== undefined) {
    return `run-issue-${issueNumber}`;
  }
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "");
  return `run-${stamp}`;
}

/**
 * Append one manifest entry as a single JSON line to `manifest.jsonl`. Creates
 * the file (and its parent dir) on first write. Called once per session at run
 * resolution — never batched — so a mid-Run crash still leaves a complete record.
 *
 * Best-effort: never throws. Observability must not break the run, so a write
 * failure (e.g. read-only mount) is logged to stderr and swallowed. Node is
 * single-threaded and each line is a single sub-PIPE_BUF `appendFile` with
 * `O_APPEND`, so concurrent appends from parallel impl/rev runs do not interleave.
 */
export async function appendManifestLine(
  entry: ManifestEntry,
  path: string = manifestPath
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.error(`[manifest] failed to append to ${path}: ${errorMessage(err)}`);
  }
}
