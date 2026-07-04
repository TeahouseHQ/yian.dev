/**
 * Sandcastle session browser — interactive two-pane Ink TUI (issue #73).
 *
 * Builds on the static shell from #72 into the master/detail browser described
 * in `docs/adr/0007-session-browser-ink-tui.md`. The left pane is a focusable
 * **run→session tree**: ↑/↓ move the selection (kept on-screen via a small
 * viewport scroll), ←/→ (or Space/Enter) collapse/expand a Run to hide or reveal
 * its Sessions. The right pane is a **detail view** of the selected row — a
 * Session's manifest metadata (phase / issue / branch / started / ended /
 * computed duration / commits / tokens / status, with `error` shown for failed
 * Sessions) or, when a Run header is selected, a Run-level aggregate. Cross-
 * issue **Planner** Runs (`issue: null`) are rendered dim so they don't compete
 * with issue Runs. `r` reloads the manifest in place.
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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdin, useStdout } from "ink";

import {
  DEFAULT_WINDOW_DAYS,
  detailFields,
  flattenTree,
  groupRuns,
  manifestPath,
  parseWindowArgs,
  readManifest,
  resolveCutoff,
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
};

/** One grouped Run, as produced by `groupRuns` (runId + its entries + max endedAt). */
type Run = { runId: string; entries: Entry[]; endedAt: number };

/** A navigable row in the flattened tree (run header or session under a run). */
type TreeRow =
  | { kind: "run"; runId: string; run: Run; depth: 0 }
  | { kind: "session"; runId: string; run: Run; entry: Entry; depth: 1 };

/** Left-pane width (columns). Generous enough for `run-<stamp>` ids + a count. */
const LEFT_WIDTH = 46;

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
  // Cap the rendered rows to the viewport so a long tree never overflows the
  // terminal and the cursor row is always on-screen.

  /** Re-read the manifest in place (the `r` key). */
  const reload = useCallback(async () => {
    if (!existsSync(manifestPath)) {
      setEntries([]);
      setMessage(
        `No manifest found at ${manifestPath}.\nRun sandcastle first; sessions are recorded on Run resolution.`
      );
      setCursor(0);
      return;
    }
    try {
      const e = (await readManifest()) as Entry[];
      setEntries(e);
      setMessage(e.length === 0 ? `Manifest is empty: ${manifestPath}` : undefined);
    } catch (err) {
      setEntries([]);
      setMessage(
        `Could not read manifest at ${manifestPath}:\n${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
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

  useInput(
    (input, key) => {
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
      } else if (input === " " || key.return) {
        if (current && collapsed.has(current.runId)) expandCurrent();
        else collapseCurrent();
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
      <Box flexDirection="column">
        <Text bold color="cyan">
          Sandcastle sessions — {windowLabel}
        </Text>
        <Text dimColor>
          ↑/↓ move · ←/→ (or Space) collapse/expand · r reload · q quit
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
  let initialEntries: Entry[] = [];
  let initialMessage: string | undefined;
  if (!existsSync(manifestPath)) {
    initialMessage = `No manifest found at ${manifestPath}.\nRun sandcastle first; sessions are recorded on Run resolution.`;
  } else {
    try {
      initialEntries = (await readManifest()) as Entry[];
      if (initialEntries.length === 0) initialMessage = `Manifest is empty: ${manifestPath}`;
    } catch (err) {
      initialMessage = `Could not read manifest at ${manifestPath}:\n${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

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
