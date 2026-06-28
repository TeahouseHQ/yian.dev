/**
 * Sandcastle transcript query + render CLI (issue #54).
 *
 * Turns the stored **Manifest** (`.sandcastle/sessions/manifest.jsonl`, issue
 * #53) and the captured **Transcripts** (session JSONL per ADR 0001) into
 * something you can actually query and read, keyed by human-meaningful
 * identifiers (run / phase / issue) rather than timestamped filenames.
 *
 *   node .sandcastle/render-transcript.mjs                    # list latest Run's Sessions
 *   node .sandcastle/render-transcript.mjs --issue 44         # render that Session's Transcript
 *   node .sandcastle/render-transcript.mjs --phase impl
 *   node .sandcastle/render-transcript.mjs --run latest
 *   node .sandcastle/render-transcript.mjs --run run-20260628120000123
 *
 * This file is plain ESM (.mjs) with only node built-in dependencies, so it runs
 * via `node` with no loader flags. All the query/render logic is exported as
 * pure functions so `.sandcastle/render-transcript.test.mjs` can unit-test them
 * against small in-memory fixtures; `main()` is the thin CLI glue.
 *
 * NOTE: `sessionsDir` / `manifestPath` intentionally duplicate the two-line
 * definitions in `observability.mts` rather than importing it, so this CLI does
 * not depend on TypeScript type-stripping at runtime. They MUST stay in sync
 * (both resolve to `<cwd>/.sandcastle/sessions` + `manifest.jsonl`).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Absolute path to the sessions dir — mirrors observability.mts `sessionsDir`. */
export const sessionsDir = join(process.cwd(), ".sandcastle", "sessions");

/** Absolute path to the append-only manifest — mirrors observability.mts `manifestPath`. */
export const manifestPath = join(sessionsDir, "manifest.jsonl");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

/** @typedef {{ run?: string, issue?: number, phase?: string }} Filter */

/**
 * Parse CLI argv into a Filter. Unknown flags are ignored. `--issue` must be an
 * integer; `--phase` / `--run` are strings. Supports both `--flag value` and
 * `--flag=value`. An empty result means "list mode" (no filters).
 * @param {readonly string[]} argv
 * @returns {Filter}
 */
export function parseArgs(argv) {
  /** @type {Filter} */
  const filter = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key = null;
    let inline = null;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        key = a.slice(2, eq);
        inline = a.slice(eq + 1);
      } else {
        key = a.slice(2);
      }
    } else {
      continue; // ignore positional / unknown tokens
    }

    if (key === "help" || key === "h") {
      filter.help = true;
      continue;
    }
    if (key !== "issue" && key !== "phase" && key !== "run") continue;

    const value = inline !== null ? inline : argv[i + 1];
    if (value === undefined) {
      throw new Error(`--${key} requires a value`);
    }
    if (inline === null) i++; // consume the next argv token

    if (key === "issue") {
      const n = Number(value);
      if (!Number.isInteger(n)) {
        throw new Error(`--issue must be an integer, got: ${value}`);
      }
      filter.issue = n;
    } else if (key === "phase") {
      filter.phase = value;
    } else {
      filter.run = value;
    }
  }
  return filter;
}

/** True iff no filter is set (the no-args "list latest Run" mode). */
export function isListMode(filter) {
  return filter.run === undefined && filter.issue === undefined && filter.phase === undefined;
}

// ---------------------------------------------------------------------------
// Manifest query
// ---------------------------------------------------------------------------

/**
 * Read + parse the manifest into entry objects (one per non-blank line).
 * @param {string} path
 * @returns {Promise<object[]>}
 */
export async function readManifest(path = manifestPath) {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

/**
 * The runId whose latest entry ended most recently. The manifest is append-only
 * at session resolution, so the newest Run is the one with the maximum
 * `endedAt` across its entries. Returns null for an empty manifest.
 * @param {readonly object[]} entries
 * @returns {string | null}
 */
export function latestRunId(entries) {
  /** @type {string | null} */
  let bestId = null;
  let bestAt = -1;
  for (const e of entries) {
    const at = Date.parse(e.endedAt ?? e.startedAt ?? "");
    if (Number.isNaN(at)) continue;
    if (at > bestAt) {
      bestAt = at;
      bestId = e.runId;
    }
  }
  return bestId;
}

/**
 * Filter manifest entries by issue / phase / run (AND). `--run latest` is
 * resolved to the newest runId. An empty filter returns every entry.
 * @param {readonly object[]} entries
 * @param {Filter} filter
 * @returns {object[]}
 */
export function filterEntries(entries, filter) {
  const run = filter.run === "latest" ? (latestRunId(entries) ?? "") : (filter.run ?? "");
  return entries.filter((e) => {
    if (filter.issue !== undefined && e.issue !== filter.issue) return false;
    if (filter.phase !== undefined && e.phase !== filter.phase) return false;
    if (filter.run !== undefined && e.runId !== run) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Summary rendering (no-args listing / per-Run audit)
// ---------------------------------------------------------------------------

/** Render a manifest-shape IterationUsage as a compact token line, or `(no usage)`. */
export function summarizeUsage(usage) {
  if (!usage) return "(no usage)";
  const parts = [];
  if (usage.inputTokens != null) parts.push(`in=${usage.inputTokens}`);
  if (usage.outputTokens != null) parts.push(`out=${usage.outputTokens}`);
  if (usage.cacheReadInputTokens != null) parts.push(`cacheRead=${usage.cacheReadInputTokens}`);
  if (usage.cacheCreationInputTokens != null)
    parts.push(`cacheWrite=${usage.cacheCreationInputTokens}`);
  return parts.join("  ") || "(no usage)";
}

/** Render one manifest entry as a summary row. */
export function summarizeEntry(entry) {
  const issue = entry.issue == null ? "-" : `#${entry.issue}`;
  const branch = entry.branch ?? "-";
  const n = entry.commits ?? 0;
  const commits = `${n} commit${n === 1 ? "" : "s"}`;
  const usage = summarizeUsage(entry.usage);
  const status = entry.status === "failed" ? `failed: ${entry.error ?? "(unknown)"}` : "ok";
  return `${entry.phase}  ${issue}  ${branch}  ${commits}  ${usage}  ${status}`;
}

/**
 * Render a listing of one (or more) Runs' sessions as the per-Run audit
 * summary. Entries are grouped by runId so multiple Runs read cleanly.
 * @param {readonly object[]} entries
 * @returns {string}
 */
export function renderRunSummary(entries) {
  /** @type {Map<string, object[]>} */
  const byRun = new Map();
  for (const e of entries) {
    if (!byRun.has(e.runId)) byRun.set(e.runId, []);
    byRun.get(e.runId).push(e);
  }
  const blocks = [];
  for (const [runId, group] of byRun) {
    blocks.push(`Run ${runId}  (${group.length} session${group.length === 1 ? "" : "s"})`);
    for (const e of group) blocks.push(`  ${summarizeEntry(e)}`);
  }
  return blocks.join("\n");
}

// ---------------------------------------------------------------------------
// Transcript parsing + rendering
// ---------------------------------------------------------------------------

/**
 * Parse captured session JSONL into records. Blank lines are skipped; lines
 * that fail JSON.parse are collected into `errors` (with 1-based line numbers)
 * rather than aborting the whole transcript — a single corrupt line should not
 * hide the rest of an audit.
 * @param {string} text
 * @returns {{ records: object[], errors: { line: number, error: string }[] }}
 */
export function parseTranscript(text) {
  const lines = text.split("\n");
  const records = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      errors.push({ line: i + 1, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { records, errors };
}

/** Render the raw provider per-message usage (input, output, cache read/write, total). */
export function formatTranscriptUsage(usage) {
  if (!usage) return "";
  const parts = [];
  if (usage.input != null) parts.push(`in=${usage.input}`);
  if (usage.output != null) parts.push(`out=${usage.output}`);
  if (usage.cacheRead != null) parts.push(`cacheRead=${usage.cacheRead}`);
  if (usage.cacheWrite != null) parts.push(`cacheWrite=${usage.cacheWrite}`);
  if (usage.totalTokens != null) parts.push(`total=${usage.totalTokens}`);
  return parts.join("  ");
}

/** Render a tool-call arguments object as `key: value` lines. */
export function formatArguments(args) {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${renderValue(v)}`).join("\n");
}

/** @param {unknown} v */
function renderValue(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Indent every line of `s` by `n` spaces. Empty string → no trailing indent. */
function indent(s, n) {
  if (s === "") return "";
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

/**
 * Render parsed transcript records as a human-readable string: per assistant
 * message the model + usage, then its thinking / text / tool-call blocks (with
 * inputs), followed by each tool result (errors flagged). User prompts are
 * shown too for context.
 * @param {readonly object[]} records
 * @returns {string}
 */
export function renderTranscript(records) {
  const blocks = [];
  for (const rec of records) {
    if (rec.type !== "message" || !rec.message) continue;
    const msg = rec.message;
    const role = msg.role;

    if (role === "user") {
      const text = contentToText(msg.content);
      if (text) {
        blocks.push("── user ──");
        blocks.push(indent(text.trim(), 2));
      }
      continue;
    }

    if (role === "assistant") {
      const usage = formatTranscriptUsage(msg.usage);
      const model = msg.model ?? "?";
      const head =
        usage !== "" ? `── assistant (${model}) · ${usage} ──` : `── assistant (${model}) ──`;
      blocks.push(head);
      for (const block of msg.content ?? []) {
        const type = block?.type;
        if (type === "thinking") {
          blocks.push("  thinking:");
          blocks.push(indent(String(block.thinking ?? "").trim(), 4));
        } else if (type === "text") {
          blocks.push(indent(String(block.text ?? "").trim(), 2));
        } else if (type === "toolCall") {
          const args = formatArguments(block.arguments);
          blocks.push(`  ▶ ${block.name ?? "?"}`);
          if (args !== "") blocks.push(indent(args, 4));
        }
      }
      continue;
    }

    if (role === "toolResult") {
      const text = contentToText(msg.content);
      const flag = msg.isError ? " [error]" : "";
      const name = msg.toolName ? ` (${msg.toolName})` : "";
      blocks.push(`── tool result${name}${flag} ──`);
      blocks.push(indent(String(text ?? "").trim(), 2));
      continue;
    }
  }
  return blocks.filter((b) => b !== "").join("\n");
}

/** Coerce a message `content` (string | content-block array) to a flat string. */
function contentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && typeof c.text === "string" ? c.text : ""))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Transcript file resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the actual transcript JSONL for a manifest entry. The manifest's
 * `sessionFile` is whatever sandcastle reported: for pi it is the session
 * *directory* (sandcastle's `hostSessionFilePath` ignores the id), so the file
 * is located by `sessionId` (see ADR 0001). Resolution order:
 *   1. `sessionFile` is an existing file → use it directly.
 *   2. `sessionFile` is a directory → find `*_<sessionId>.jsonl` inside it.
 *   3. fall back to a recursive search of `sessionsDir` for `*_<sessionId>.jsonl`.
 * Returns null when nothing can be found.
 *
 * @param {{ sessionId?: string|null, sessionFile?: string|null }} entry
 * @param {string} [baseDir=sessionsDir]
 * @returns {Promise<string|null>}
 */
export async function resolveTranscriptFile(entry, baseDir = sessionsDir) {
  const { sessionId, sessionFile } = entry;
  // 1. sessionFile points straight at a file.
  if (sessionFile) {
    try {
      const s = await stat(sessionFile);
      if (s.isFile()) return sessionFile;
      if (s.isDirectory() && sessionId) {
        const hit = await findBySessionId(sessionFile, sessionId);
        if (hit) return hit;
      }
    } catch {
      // fall through to recursive search
    }
  }
  // 2/3. recursive search by sessionId.
  if (sessionId && existsSync(baseDir)) {
    return findRecursively(baseDir, sessionId);
  }
  return null;
}

/** Find `<dir>/*_<sessionId>.jsonl` (the pi naming `<stamp>_<sessionId>.jsonl`). */
async function findBySessionId(dir, sessionId) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const needle = `_${sessionId}.jsonl`;
  const hit = names.find((n) => n.endsWith(needle));
  return hit ? join(dir, hit) : null;
}

/** Depth-first search for any `*_<sessionId>.jsonl` under `dir`. */
async function findRecursively(dir, sessionId) {
  const needle = `_${sessionId}.jsonl`;
  let stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let names;
    try {
      names = await readdir(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(current, name);
      if (name.endsWith(needle)) {
        try {
          const s = await stat(full);
          if (s.isFile()) return full;
        } catch {
          // ignore, keep searching
        }
      } else {
        // recurse into subdirs (e.g. the encoded-cwd dir) — best-effort
        try {
          const s = await stat(full);
          if (s.isDirectory()) stack.push(full);
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `Sandcastle transcript query + render CLI (issue #54)

Usage:
  node .sandcastle/render-transcript.mjs                 List the latest Run's Sessions
  node .sandcastle/render-transcript.mjs --issue 44      Render that Session's Transcript
  node .sandcastle/render-transcript.mjs --phase impl    Render impl-phase Session(s)
  node .sandcastle/render-transcript.mjs --run latest    Render the latest Run's Session(s)
  node .sandcastle/render-transcript.mjs --run <runId>   Render a specific Run

Filters combine with AND. Reads .sandcastle/sessions/manifest.jsonl and locates
the transcript JSONL by sessionId (the manifest sessionFile may be a directory).`;

/**
 * CLI entry. Returns the process exit code (does not call process.exit itself,
 * so it stays unit-testable). Errors are printed to stderr with a graceful
 * message rather than a stack trace.
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  let filter;
  try {
    filter = parseArgs(argv);
  } catch (err) {
    console.error(String(err.message ?? err));
    console.error("\n" + HELP);
    return 2;
  }
  if (filter.help) {
    console.log(HELP);
    return 0;
  }

  // Graceful missing-manifest message.
  if (!existsSync(manifestPath)) {
    console.error(
      `No manifest found at ${manifestPath}.\nRun sandcastle first; sessions are recorded on Run resolution.`
    );
    return 1;
  }

  const entries = await readManifest();
  if (entries.length === 0) {
    console.error(`Manifest is empty: ${manifestPath}`);
    return 1;
  }

  if (isListMode(filter)) {
    // No-args: list the latest Run's Sessions.
    const latest = latestRunId(entries);
    if (!latest) {
      console.error("Could not determine the latest Run from the manifest.");
      return 1;
    }
    console.log(renderRunSummary(filterEntries(entries, { run: latest })));
    return 0;
  }

  // Filtered mode: resolve + render each matching session's Transcript.
  const matched = filterEntries(entries, filter);
  if (matched.length === 0) {
    console.error(`No sessions match ${JSON.stringify(filter)}.`);
    return 1;
  }

  let exit = 0;
  for (const entry of matched) {
    const file = await resolveTranscriptFile(entry);
    console.log(`\n### ${summarizeEntry(entry)}`);
    if (!file) {
      console.error(
        `  (no transcript found for sessionId ${entry.sessionId ?? "?"}; ` +
          `looked under ${entry.sessionFile ?? sessionsDir})`
      );
      exit = 1;
      continue;
    }
    console.log(`  transcript: ${file}`);
    const text = await readFile(file, "utf8");
    const { records, errors } = parseTranscript(text);
    console.log(indent(renderTranscript(records), 2));
    for (const e of errors) {
      console.error(`  warning: skipped malformed line ${e.line}: ${e.error}`);
    }
  }
  return exit;
}

// Run only when invoked directly, not when imported by the test.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}
