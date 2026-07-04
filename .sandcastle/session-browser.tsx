/**
 * Sandcastle session browser — interactive two-pane Ink TUI (issues #72–#74).
 *
 * Builds on the static shell from #72 into the master/detail browser described
 * in `docs/adr/0007-session-browser-ink-tui.md`. The left pane is a focusable
 * **run→session tree**: ↑/↓ move the selection (kept on-screen via a small
 * viewport scroll), ←/→ (or Space) collapse/expand a Run to hide or reveal
 * its Sessions. The right pane is a **detail view** of the selected row — a
 * Session's manifest metadata (phase / issue / branch / started / ended /
 * computed duration / commits / tokens / status, with `error` shown for failed
 * Sessions) or, when a Run header is selected, a Run-level aggregate. Cross-
 * issue **Planner** Runs (`issue: null`) are rendered dim so they don't compete
 * with issue Runs. `r` reloads the manifest in place.
 *
 * Pressing **Enter** on a Session opens a **full-screen transcript pager**
 * (#74) showing that Session's rendered Transcript — produced by the reused
 * pure core in `render-transcript.mjs` (`resolveTranscriptFile` then
 * `parseTranscript` then `renderTranscript`, never reimplemented). Scrolling:
 * `j`/`k` (line), `PgUp`/`PgDn` (page), `g`/`G` (top/bottom). `Esc` returns to
 * the two-pane tree with the selection preserved. When no local JSONL resolves
 * for a Session the pager degrades to the Session's metadata plus a
 * "transcript not available locally" note instead of erroring.
 *
 * All query/render logic is imported from the zero-dep core in
 * `render-transcript.mjs` (readManifest / withinWindow / groupRuns /
 * flattenTree / detailFields / runSummaryFields / runIssue) — never duplicated
 * — so this file is just the interactive layer (ADR-0007). Pure helpers there
 * are unit-tested; per CODING_STANDARDS.md the React components are not.
 *
 * Run via `pnpm sandcastle:browse` (i.e. `tsx .sandcastle/session-browser.tsx`).
 * The `.sandcastle/package.json` `{"type":"module"}` marker makes this `.tsx`
 * ESM so Ink's transitive `yoga-layout@3` (top-level await) loads under tsx.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdin, useStdout } from "ink";

import {
  DEFAULT_WINDOW_DAYS,
  detailFields,
  flattenTree,
  groupRuns,
  manifestPath,
  pagerOffset,
  parseTranscript,
  parseWindowArgs,
  readManifest,
  renderTranscript,
  resolveCutoff,
  resolveTranscriptFile,
  runIssue,
  runSummaryFields,
  withinWindow,
} from "./render-transcript.mjs";

/** One manifest entry, as read by `readManifest` (a structural slice of the full shape). */
type Entry = {
  runId?: string;
  phase?: string;
  issue?: number | null;
  branch?: string | null;
  commits?: number;
  usage?: unknown;
  startedAt?: string;
  endedAt?: string;
  status?: "ok" | "failed";
  error?: string;
  /** pi session id + the sessionFile the manifest recorded (a dir for pi). */
  sessionId?: string | null;
  sessionFile?: string | null;
};

/** One grouped Run, as produced by `groupRuns` (runId + its entries + max endedAt). */
type Run = { runId: string; entries: Entry[]; endedAt: number };

/** A navigable row in the flattened tree (run header or session under a run). */
type TreeRow =
  | { kind: "run"; runId: string; run: Run; depth: 0 }
  | { kind: "session"; runId: string; run: Run; entry: Entry; depth: 1 };

/** Left-pane width (columns). Generous enough for `run-<stamp>` ids + a count. */
const LEFT_WIDTH = 46;

/** Pager rows reserved for chrome: top/bottom border (2) + header (1) + help (1). */
const PAGER_OVERHEAD = 4;

/** A scroll action the transcript pager understands (mirrors the core helper). */
type PagerAction = "up" | "down" | "pageUp" | "pageDown" | "home" | "end";

/**
 * Human-readable label for the active window, from the parsed `{ days, since }`.
 * Mirrors `resolveCutoff` precedence (since → days → 3-day default).
 */
function windowLabelOf(opts: { days?: number; since?: string }): string {
  if (opts.since !== undefined) return `since ${opts.since}`;
  if (opts.days !== undefined) {
    return opts.days <= 0 ? "all time" : `last ${opts.days} day${opts.days === 1 ? "" : "s"}`;
  }
  return `last ${DEFAULT_WINDOW_DAYS} days`;
}

/** A label/value pair, as produced by the core `detailFields` / `runSummaryFields`. */
type Field = { label: string; value: string };

/**
 * Read the manifest, mapping the missing / empty / unreadable cases to a
 * user-facing yellow message. Shared by the initial synchronous read in
 * `main()` and the in-place `r` reload, so both degrade identically.
 */
async function loadManifest(): Promise<{ entries: Entry[]; message?: string }> {
  if (!existsSync(manifestPath)) {
    return {
      entries: [],
      message: `No manifest found at ${manifestPath}.\nRun sandcastle first; sessions are recorded on Run resolution.`,
    };
  }
  try {
    const entries = (await readManifest()) as Entry[];
    return {
      entries,
      message: entries.length === 0 ? `Manifest is empty: ${manifestPath}` : undefined,
    };
  } catch (err) {
    return {
      entries: [],
      message: `Could not read manifest at ${manifestPath}:\n${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/** Render a label/value list, colouring a failed Session's Status red. */
function FieldList({
  fields,
  failed,
}: {
  fields: Field[];
  failed?: boolean;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {fields.map((f) => {
        const isStatus = f.label === "Status";
        const color = isStatus && failed ? "red" : undefined;
        return (
          <Box key={f.label} flexDirection="row">
            <Box width={13}>
              <Text dimColor>{f.label}</Text>
            </Box>
            <Text color={color} bold={isStatus}>
              {f.value}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** The left pane: a scrollable, keyboard-navigable run→session tree. */
function TreePane({
  rows,
  offset,
  height,
  cursor,
  collapsed,
}: {
  rows: TreeRow[];
  offset: number;
  /** Max rows to render (the terminal-bounded viewport). */
  height: number;
  cursor: number;
  collapsed: Set<string>;
}): React.ReactElement {
  const visible = rows.slice(offset, offset + Math.max(1, height));
  return (
    <Box flexDirection="column" width={LEFT_WIDTH} borderStyle="single" borderColor="cyan">
      <Text bold>
        Sessions{" "}
        <Text dimColor>({rows.length})</Text>
      </Text>
      {visible.length === 0 ? (
        <Text dimColor>(empty)</Text>
      ) : (
        visible.map((row, i) => {
          const selected = offset + i === cursor;
          const isPlanner = runIssue(row.run) === null;
          if (row.kind === "run") {
            const expanded = !collapsed.has(row.runId);
            const glyph = expanded ? "▾" : "▸";
            const issue = runIssue(row.run);
            const name = issue == null ? row.runId : `${row.runId} · #${issue}`;
            const n = row.run.entries.length;
            return (
              <Text
                key={`r-${row.runId}`}
                wrap="truncate-end"
                bold={selected}
                inverse={selected}
                dimColor={isPlanner && !selected}
              >
                {selected ? "❯ " : "  "}
                {glyph} {name} ({n})
              </Text>
            );
          }
          const e = row.entry;
          const ref = e.issue == null ? "-" : `#${e.issue}`;
          const flag = e.status === "failed" ? " ✗" : "";
          return (
            <Text
              key={`s-${i}`}
              wrap="truncate-end"
              bold={selected}
              inverse={selected}
              dimColor={isPlanner && !selected}
            >
              {selected ? "❯ " : "  "}
              {"  "}
              {e.phase ?? "?"} {ref} · {e.commits ?? 0}c{flag}
            </Text>
          );
        })
      )}
    </Box>
  );
}

/** The right pane: detail for the selected Session, or a Run's aggregate. */
function DetailPane({ current }: { current: TreeRow | undefined }): React.ReactElement {
  let body: React.ReactNode;
  if (!current) {
    body = <Text dimColor>Select a row.</Text>;
  } else if (current.kind === "run") {
    const issue = runIssue(current.run);
    body = (
      <Box flexDirection="column">
        <Text bold>
          Run {current.runId}{" "}
          <Text dimColor>{issue == null ? "(planner)" : `#${issue}`}</Text>
        </Text>
        <FieldList fields={runSummaryFields(current.run) as Field[]} />
      </Box>
    );
  } else {
    const e = current.entry;
    const ref = e.issue == null ? "(planner)" : `#${e.issue}`;
    body = (
      <Box flexDirection="column">
        <Text bold>
          {(e.phase ?? "?")} {ref}
        </Text>
        <FieldList fields={detailFields(e) as Field[]} failed={e.status === "failed"} />
      </Box>
    );
  }
  return (
    <Box flexGrow={1} marginLeft={1} borderStyle="single" borderColor="cyan" flexDirection="column">
      <Text bold>Detail</Text>
      {body}
    </Box>
  );
}

/**
 * The full-screen transcript pager (issue #74). Renders a Session's Transcript
 * (text produced by the reused core pipeline — `resolveTranscriptFile` →
 * `parseTranscript` → `renderTranscript`) scrolled by `offset`. While the file
 * resolves it shows a loading line; when none resolves locally it shows the
 * Session's manifest metadata plus a clear "transcript not available locally"
 * note. Each source line is truncated to the viewport width so a wide tool
 * result can't break the layout, and only the visible slice is rendered so a
 * long transcript scrolls smoothly.
 */
function PagerView({
  entry,
  text,
  loading,
  offset,
  height,
}: {
  entry: Entry;
  /** The rendered transcript, or null when none resolved locally. */
  text: string | null;
  loading: boolean;
  offset: number;
  /** Max body rows to render (the terminal-bounded viewport). */
  height: number;
}): React.ReactElement {
  const ref = entry.issue == null ? "(planner)" : `#${entry.issue}`;
  const title = `${entry.phase ?? "?"} ${ref}`;
  let body: React.ReactNode;
  if (loading) {
    body = <Text dimColor>Loading transcript…</Text>;
  } else if (text === null) {
    body = (
      <Box flexDirection="column">
        <Text bold color="yellow">
          transcript not available locally
        </Text>
        <Text dimColor>
          No JSONL resolved for this session (pruned, or a failed session that never produced one).
        </Text>
        <Box marginTop={1} flexDirection="column">
          <FieldList fields={detailFields(entry) as Field[]} failed={entry.status === "failed"} />
        </Box>
      </Box>
    );
  } else {
    const lines = text.split("\n");
    const visible = lines.slice(offset, offset + Math.max(1, height));
    body = (
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((line, i) => (
          // Empty source lines render as a blank row so blank-separated blocks
          // keep their spacing; long lines truncate to the viewport width so a
          // wide tool result can't push the layout around.
          <Text key={i} wrap="truncate-end">
            {line === "" ? " " : line}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan">
      <Text bold>
        Transcript — {title}{" "}
        <Text dimColor>Esc back</Text>
      </Text>
      {body}
      <Text dimColor>j/k line · PgUp/PgDn page · g/G top/bottom · Esc back · q quit</Text>
    </Box>
  );
}

/** Top-level browser frame: owns the tree/detail state + keyboard input. */
function Browser({
  initialEntries,
  initialMessage,
  windowOpts,
  windowLabel,
}: {
  initialEntries: Entry[];
  initialMessage?: string;
  windowOpts: { days?: number; since?: string };
  windowLabel: string;
}): React.ReactElement {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const inputActive = isRawModeSupported === true;

  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [message, setMessage] = useState<string | undefined>(initialMessage);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [scroll, setScroll] = useState(0);

  // Pager state (#74). `pagerEntry` doubles as the mode flag: non-null means a
  // Session's transcript is open full-screen (the tree is hidden). `pagerText`
  // is the rendered transcript, or null while loading / when none resolved.
  const [pagerEntry, setPagerEntry] = useState<Entry | null>(null);
  const [pagerText, setPagerText] = useState<string | null>(null);
  const [pagerLoading, setPagerLoading] = useState(false);
  const [pagerScroll, setPagerScroll] = useState(0);

  // Runs in-window (newest-first); re-derived on reload. resolveCutoff is
  // re-evaluated here so a reload re-windows against "now".
  const runs = useMemo<Run[]>(
    () => groupRuns(withinWindow(entries, resolveCutoff(windowOpts))) as Run[],
    [entries, windowOpts]
  );
  const rows = useMemo<TreeRow[]>(
    () => flattenTree(runs, collapsed) as TreeRow[],
    [runs, collapsed]
  );

  // Clamp the cursor into range (a reload may shrink the tree).
  const clampedCursor = rows.length === 0 ? -1 : Math.min(cursor, rows.length - 1);

  // Tree viewport height: reserve room for the header/help line + pane borders.
  const termRows = stdout?.rows;
  const inner = termRows ? Math.max(3, termRows - 6) : rows.length;
  // Pager body height: the terminal minus border (2) + header (1) + help (1).
  // The pager is only reachable in TTY mode (Enter needs raw input), but a
  // sane default keeps the slice math total when stdout has no rows.
  const pagerBodyHeight = termRows ? Math.max(1, termRows - PAGER_OVERHEAD) : 20;
  // Keep the cursor within the visible window; only scroll when it leaves.
  useEffect(() => {
    setScroll((s) => {
      if (clampedCursor < 0) return 0;
      if (clampedCursor < s) return clampedCursor;
      if (clampedCursor >= s + inner) return Math.max(0, clampedCursor - inner + 1);
      return s;
    });
  }, [clampedCursor, inner]);
  const maxOffset = Math.max(0, rows.length - inner);
  const offset = Math.min(scroll, maxOffset);
  const current = clampedCursor >= 0 ? rows[clampedCursor] : undefined;

  /**
   * Load a Session's rendered transcript when its pager opens (#74). Reuses
   * the core pipeline — `resolveTranscriptFile` → `parseTranscript` →
   * `renderTranscript` — so rendering is never duplicated here. A missing file
   * (pruned / failed-never-produced) leaves `pagerText` null so the pager shows
   * the metadata + "not available" note; a read/parse failure degrades the
   * same way rather than crashing. `cancelled` ignores a result that lands
   * after the user has already hit Esc. The loading/text/scroll state is reset
   * synchronously by `openPager` so the first paint already reads "Loading…"
   * (never a flash of "not available" before the async resolves).
   */
  useEffect(() => {
    if (!pagerEntry) return;
    let cancelled = false;
    void (async () => {
      const file = await resolveTranscriptFile(pagerEntry);
      if (cancelled) return;
      if (!file) {
        setPagerLoading(false);
        return;
      }
      try {
        const raw = await readFile(file, "utf8");
        if (cancelled) return;
        setPagerText(renderTranscript(parseTranscript(raw).records));
      } catch {
        setPagerText(null);
      }
      setPagerLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pagerEntry]);

  /** Re-read the manifest in place (the `r` key). */
  const reload = useCallback(async () => {
    const { entries: reloaded, message: reloadMessage } = await loadManifest();
    setEntries(reloaded);
    setMessage(reloadMessage);
    setCursor(0);
  }, []);

  /** Collapse the run containing the cursor (← / Space when expanded). */
  const collapseCurrent = useCallback(() => {
    if (!current) return;
    const rid = current.runId;
    if (collapsed.has(rid)) return;
    const next = new Set(collapsed);
    next.add(rid);
    setCollapsed(next);
    // Move the cursor to the (still-present) run header so it never lands on a
    // row that just disappeared.
    const idx = rows.findIndex((r) => r.kind === "run" && r.runId === rid);
    if (idx >= 0) setCursor(idx);
  }, [current, collapsed, rows]);

  /** Expand the run containing the cursor (→ / Space when collapsed). */
  const expandCurrent = useCallback(() => {
    if (!current) return;
    const rid = current.runId;
    if (!collapsed.has(rid)) return;
    const next = new Set(collapsed);
    next.delete(rid);
    setCollapsed(next);
  }, [current, collapsed]);

  /** Toggle the cursor's run between collapsed/expanded (Space / Enter-on-run). */
  const toggleCurrent = useCallback(() => {
    if (!current) return;
    if (collapsed.has(current.runId)) expandCurrent();
    else collapseCurrent();
  }, [current, collapsed, expandCurrent, collapseCurrent]);

  /** Open the transcript pager for a Session (Enter on a session row). Resets
   * loading/text/scroll synchronously so the first paint reads "Loading…". */
  const openPager = useCallback((entry: Entry) => {
    setPagerEntry(entry);
    setPagerText(null);
    setPagerLoading(true);
    setPagerScroll(0);
  }, []);

  /** Close the pager and return to the two-pane tree (Esc); selection is intact. */
  const closePager = useCallback(() => {
    setPagerEntry(null);
    setPagerText(null);
    setPagerLoading(false);
    setPagerScroll(0);
  }, []);

  useInput(
    (input, key) => {
      // Pager mode (#74): Esc returns to the tree; q / Ctrl-C quit; j/k,
      // PgUp/PgDn, g/G scroll the rendered transcript. The scroll math is the
      // pure `pagerOffset` helper, clamped to the current line count + viewport.
      if (pagerEntry) {
        if (key.escape) {
          closePager();
          return;
        }
        if (input === "q" || (key.ctrl && input === "c")) {
          void exit();
          return;
        }
        const lineCount = pagerText === null ? 0 : pagerText.split("\n").length;
        let action: PagerAction | null = null;
        if (input === "j") action = "down";
        else if (input === "k") action = "up";
        else if (key.pageDown) action = "pageDown";
        else if (key.pageUp) action = "pageUp";
        else if (input === "g") action = "home";
        else if (input === "G") action = "end";
        if (action) {
          setPagerScroll((o) => pagerOffset(o, lineCount, pagerBodyHeight, action));
        }
        return;
      }

      // Tree mode.
      if (input === "q" || (key.ctrl && input === "c")) {
        void exit();
        return;
      }
      if (input === "r") {
        void reload();
        return;
      }
      if (rows.length === 0) return;
      if (key.upArrow) {
        setCursor((c) => Math.max(0, Math.min(c, rows.length - 1) - 1));
      } else if (key.downArrow) {
        setCursor((c) => Math.min(rows.length - 1, Math.max(0, c) + 1));
      } else if (key.leftArrow) {
        collapseCurrent();
      } else if (key.rightArrow) {
        expandCurrent();
      } else if (input === " ") {
        toggleCurrent();
      } else if (key.return) {
        // Enter on a Session opens its transcript; on a run header, toggle.
        if (current?.kind === "session") openPager(current.entry);
        else toggleCurrent();
      } else if (key.home) {
        setCursor(0);
      } else if (key.end || input === "G") {
        setCursor(rows.length - 1);
      }
    },
    { isActive: inputActive }
  );

  return (
    <Box flexDirection="column">
      {pagerEntry ? (
        // Pager mode (#74): the transcript replaces the two-pane tree. Esc (handled
        // above) returns to the tree with the selection intact.
        <PagerView
          entry={pagerEntry}
          text={pagerText}
          loading={pagerLoading}
          offset={pagerScroll}
          height={pagerBodyHeight}
        />
      ) : (
        <>
          <Box flexDirection="column">
            <Text bold color="cyan">
              Sandcastle sessions — {windowLabel}
            </Text>
            <Text dimColor>
              ↑/↓ move · ←/→ (or Space) collapse/expand · Enter transcript · r reload · q quit
            </Text>
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <TreePane
              rows={rows}
              offset={offset}
              height={inner}
              cursor={clampedCursor}
              collapsed={collapsed}
            />
            <DetailPane current={current} />
          </Box>
          {message ? (
            <Box marginTop={1}>
              <Text color="yellow">{message}</Text>
            </Box>
          ) : null}
        </>
      )}
    </Box>
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  let windowOpts: { days?: number; since?: string };
  try {
    windowOpts = parseWindowArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
    return;
  }
  const windowLabel = windowLabelOf(windowOpts);

  // Initial read in main() so the first paint is synchronous (no loading
  // flash); the Browser's `r` key re-reads from the same source on demand.
  const { entries: initialEntries, message: initialMessage } = await loadManifest();

  const instance = render(
    <Browser
      initialEntries={initialEntries}
      initialMessage={initialMessage}
      windowOpts={windowOpts}
      windowLabel={windowLabel}
    />
  );
  await instance.waitUntilExit();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
