/**
 * Session browser view — the reusable, mountable Ink component behind both the
 * standalone `sandcastle:browse` command (`session-browser.tsx`) and the
 * Cockpit's **Sessions tab** (`cockpit.tsx`, issue #82; CONTEXT.md: Session
 * browser / Cockpit). One implementation, two mount points — the browser UI is
 * never duplicated between the two entry points.
 *
 * The component owns the interactive two-pane browser (issues #72–#74): a
 * focusable **run→session tree** (left) beside a **detail view** (right), and a
 * full-screen **transcript pager** reached with Enter. ↑/↓ move the selection,
 * ←/→ (or Space) collapse/expand a Run, `r` reloads the manifest in place, and
 * in the pager ↑/↓, `PgUp`/`PgDn`, `g`/`G` scroll (the shared viewport chord,
 * ADR-0015) while `Esc` returns.
 *
 * All query/render logic is imported from the zero-dep core in
 * `render-transcript.mjs` (readManifest / withinWindow / groupRuns /
 * flattenTree / detailFields / runSummaryFields / runIssue / resolveTranscript*
 * …) — never duplicated — so this file is just the interactive layer (ADR-0007).
 * Per CODING_STANDARDS.md the React components are not unit-tested; the pure
 * helpers they call are.
 *
 * **Embedding contract (`standalone`).** Standalone, the browser owns its own
 * `q` / Ctrl-C quit (it *is* the whole app). Embedded in the Cockpit
 * (`standalone={false}`), it yields those global keys to the Cockpit shell,
 * whose `routeCockpitInput` owns quit and Tab/Shift+Tab tab-switching and
 * delegates every other key (↑/↓/←/→, Enter, r, pager keys) down to this
 * component while the Sessions tab is focused. The Cockpit mounts this only
 * while that tab is focused, so its `useInput` is naturally scoped.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  measureElement,
  Text,
  useApp,
  useInput,
  useStdin,
  useStdout,
  type DOMElement,
} from "ink";

import {
  DEFAULT_WINDOW_DAYS,
  detailFields,
  flattenTree,
  groupRuns,
  manifestPath,
  parseTranscript,
  readManifest,
  renderTranscript,
  resolveCutoff,
  resolveTranscriptFile,
  runIssue,
  runSummaryFields,
  withinWindow,
} from "./render-transcript.mjs";
import { useMeasuredHeight, useViewport } from "./viewport-hooks.jsx";

/** One manifest entry, as read by `readManifest` (a structural slice of the full shape). */
export type Entry = {
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

/** The window options the browser filters Runs against. */
export interface WindowOpts {
  days?: number;
  since?: string;
}

/**
 * Human-readable label for the active window, from the parsed `{ days, since }`.
 * Mirrors `resolveCutoff` precedence (since → days → 3-day default).
 */
export function windowLabelOf(opts: WindowOpts): string {
  if (opts.since !== undefined) return `since ${opts.since}`;
  if (opts.days !== undefined) {
    return opts.days <= 0 ? "all time" : `last ${opts.days} day${opts.days === 1 ? "" : "s"}`;
  }
  return `last ${DEFAULT_WINDOW_DAYS} days`;
}

/** A label/value pair, as produced by the core `detailFields` / `runSummaryFields`. */
type Field = { label: string; value: string };

/** The manifest data (plus any user-facing message) a browser mount is seeded with. */
export interface ManifestLoad {
  entries: Entry[];
  message?: string;
}

/**
 * Read the manifest, mapping the missing / empty / unreadable cases to a
 * user-facing yellow message. Shared by both entry points' initial read and the
 * in-place `r` reload, so every mount degrades identically.
 */
export async function loadManifest(): Promise<ManifestLoad> {
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
function FieldList({ fields, failed }: { fields: Field[]; failed?: boolean }): React.ReactElement {
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
  contentRef,
}: {
  rows: TreeRow[];
  offset: number;
  /** Max rows to render — measured from the rendered content box (ADR-0015). */
  height: number;
  cursor: number;
  collapsed: Set<string>;
  /** Ref on the scrollable content box; the parent measures it for `height`. */
  contentRef: React.RefObject<DOMElement | null>;
}): React.ReactElement {
  const visible = rows.slice(offset, offset + Math.max(1, height));
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width={LEFT_WIDTH}
      overflow="hidden"
      borderStyle="single"
      borderColor="cyan"
    >
      <Text bold>
        Sessions <Text dimColor>({rows.length})</Text>
      </Text>
      <Box ref={contentRef} flexDirection="column" flexGrow={1} overflow="hidden">
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
          Run {current.runId} <Text dimColor>{issue == null ? "(planner)" : `#${issue}`}</Text>
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
          {e.phase ?? "?"} {ref}
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
 * `parseTranscript` → `renderTranscript`) scrolled inside a **measured Viewport**
 * (ADR-0015): the SAME shared `useMeasuredHeight` + `useViewport` the Live event
 * log and Maintenance pager use, so all three scroll surfaces answer one chord
 * — ↑/↓ · PgUp/PgDn · g/G — and can never drift apart. Like the Maintenance
 * pager the Transcript is static, so the viewport starts at the TOP (offset 0,
 * follow off) with no paused indicator; the measured body box self-corrects on
 * terminal resize. While the file resolves it shows a loading line; when none
 * resolves locally it shows the Session's manifest metadata plus a clear
 * "transcript not available locally" note. Each source line is truncated to the
 * viewport width so a wide tool result can't break the layout, and only the
 * visible slice is rendered so a long transcript scrolls smoothly.
 *
 * `useViewport` registers its own scoped `useInput` for the scroll chord; because
 * the Cockpit/browser mounts this component only in pager mode, that chord is
 * naturally scoped to the pager (the shell's outer `useInput` keeps Esc/quit).
 */
function PagerView({
  entry,
  text,
  loading,
}: {
  entry: Entry;
  /** The rendered transcript, or null when none resolved locally. */
  text: string | null;
  loading: boolean;
}): React.ReactElement {
  const ref = entry.issue == null ? "(planner)" : `#${entry.issue}`;
  const title = `${entry.phase ?? "?"} ${ref}`;
  // Hooks run unconditionally (rules of hooks) even in the loading / not-available
  // branches, where there is simply nothing to scroll (lines = 0). The body ref is
  // only attached in the scrollable branch, so the measurement is a no-op otherwise.
  const lines = text === null ? [] : text.split("\n");
  const [bodyRef, height] = useMeasuredHeight(20);
  const viewport = useViewport(lines.length, height, { offset: 0, follow: false });

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
    const visible = lines.slice(viewport.offset, viewport.offset + height);
    body = (
      <Box ref={bodyRef} flexDirection="column" flexGrow={1} overflow="hidden">
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
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderColor="cyan"
      overflow="hidden"
    >
      <Text bold>
        Transcript — {title} <Text dimColor>Esc back</Text>
      </Text>
      {body}
      <Text dimColor>↑/↓ line · PgUp/PgDn page · g/G top/bottom · Esc back · q quit</Text>
    </Box>
  );
}

/**
 * The reusable session-browser frame: owns the tree/detail state + keyboard
 * input, mounted by both `sandcastle:browse` and the Cockpit's Sessions tab.
 * `standalone` (default true) governs whether it owns its own `q` / Ctrl-C quit;
 * embedded in the Cockpit it is passed `false` so the shell owns quit (see the
 * embedding contract in the file header).
 */
export function SessionBrowser({
  initialEntries,
  initialMessage,
  windowOpts,
  windowLabel,
  standalone = true,
}: {
  initialEntries: Entry[];
  initialMessage?: string;
  windowOpts: WindowOpts;
  windowLabel: string;
  standalone?: boolean;
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

  // Tree viewport height is MEASURED from the rendered content box (ADR-0015),
  // not a hand-tuned `termRows - N`: the content box is a flexGrow child of the
  // bounded fullscreen canvas, so its measured height is exactly the rows that
  // fit, and it self-corrects on terminal resize (Ink re-renders → re-measure →
  // re-clamp). The transcript pager measures its own body the same way, via the
  // shared `useMeasuredHeight` inside `PagerView`.
  const termRows = stdout?.rows;
  const treeRef = useRef<DOMElement>(null);
  const [treeHeight, setTreeHeight] = useState(() => termRows ?? rows.length);
  useEffect(() => {
    const node = treeRef.current;
    if (!node) return;
    const h = Math.max(1, measureElement(node).height);
    setTreeHeight((prev) => (prev === h ? prev : h));
  }); // every commit; bails on an unchanged measurement so it converges, no loop
  const inner = treeHeight;
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
   * loading/text synchronously so the first paint reads "Loading…"; the pager's
   * own `useViewport` seeds a fresh top-of-transcript offset on mount. */
  const openPager = useCallback((entry: Entry) => {
    setPagerEntry(entry);
    setPagerText(null);
    setPagerLoading(true);
  }, []);

  /** Close the pager and return to the two-pane tree (Esc); selection is intact. */
  const closePager = useCallback(() => {
    setPagerEntry(null);
    setPagerText(null);
    setPagerLoading(false);
  }, []);

  useInput(
    (input, key) => {
      // Pager mode (#74): Esc returns to the tree; q / Ctrl-C quit (standalone
      // only — embedded, the Cockpit owns quit). Scrolling (↑/↓ · PgUp/PgDn ·
      // g/G) is owned by the transcript pager's own `useViewport` (ADR-0015),
      // mounted only in pager mode so its chord is naturally scoped; the early
      // return here keeps the tree keys inert while the transcript is open.
      if (pagerEntry) {
        if (key.escape) {
          closePager();
          return;
        }
        if (standalone && (input === "q" || (key.ctrl && input === "c"))) {
          void exit();
          return;
        }
        return;
      }

      // Tree mode. Standalone owns q / Ctrl-C quit; embedded it yields them to
      // the Cockpit shell (which routes quit + tab-switch, #82).
      if (standalone && (input === "q" || (key.ctrl && input === "c"))) {
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
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {pagerEntry ? (
        // Pager mode (#74): the transcript replaces the two-pane tree. Esc (handled
        // above) returns to the tree with the selection intact.
        <PagerView entry={pagerEntry} text={pagerText} loading={pagerLoading} />
      ) : (
        <>
          <Box flexDirection="column">
            <Text bold color="cyan">
              Sandcastle sessions — {windowLabel}
            </Text>
            <Text dimColor>
              ↑/↓ move · ←/→ (or Space) collapse/expand · Enter transcript · r reload
              {standalone ? " · q quit" : ""}
            </Text>
          </Box>
          <Box flexDirection="row" marginTop={1} flexGrow={1} overflow="hidden">
            <TreePane
              rows={rows}
              offset={offset}
              height={inner}
              cursor={clampedCursor}
              collapsed={collapsed}
              contentRef={treeRef}
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
