/**
 * Sandcastle Cockpit — the single Ink TUI that consolidates the Sandcastle
 * surfaces into tabbed modes (issue #80; CONTEXT.md: Cockpit, ADR-0008).
 *
 * This slice is the foundational tracer bullet: a tabbed shell — **[Live]**
 * **[Sessions]** **[Maintenance]** — that launches **idle** (no run started).
 * ←/→ cycle the tabs; `q` / Ctrl-C quit cleanly, stopping any child first.
 *
 * The **Live** tab is functional: it **supervises the orchestrator as a child
 * process** (never in-process — a crash in the loop must not take the Cockpit
 * down, ADR-0008). Enter **Start**s `tsx main.mts` with
 * `SANDCASTLE_EVENT_FORMAT=ndjson`; the child's stdout is the structured
 * **Live feed** (NDJSON, from #78), parsed line-by-line and rendered as the full
 * orchestrator monitor (issue #81): a status/Start-Stop header, a **pool gauge**
 * (`N / POOL_SIZE` busy), an **in-flight list** of currently-running issues +
 * phases, and a scrolling **event log**. The gauge and in-flight list derive
 * purely from the event stream via `reduceLiveEvent` — a `dispatch` adds an
 * entry, a `session-resolved` removes it — never from the Manifest (which only
 * gains a row *after* a Session resolves, ADR-0008). Enter again **Stop**s it
 * (SIGTERM); Start after a stop/crash restarts (resetting the monitor). The
 * child's stderr (the per-agent sub-feed + any crash trace) is surfaced dimmed
 * in the same log. A child crash/exit is reported in the UI (status line + a
 * coloured log line) without unmounting the Cockpit.
 *
 * The **Sessions** tab embeds the reusable {@link SessionBrowser} component
 * (issue #82) — the *same* implementation the standalone `sandcastle:browse`
 * command mounts, no duplication. It is mounted only while the tab is focused,
 * so its own keybindings (↑/↓, ←/→, Enter, r, the pager keys) are naturally
 * scoped to it; the shell keeps quit + Tab/Shift+Tab tab-switching via the pure
 * `routeCockpitInput`, delegating every other key to the focused tab. The
 * manifest is loaded lazily the first time the tab is opened.
 *
 * The **Maintenance** tab (issue #83) runs Prune from inside the Cockpit. It
 * renders the live **dry-run plan** — the same categorized deletions the CLI
 * shows — by calling `discoverPruneState` + the pure `planPrune` (#79), so there
 * is no forked logic. The preview is always available. `a` **arms** an apply and
 * `y` **confirms** it (the `--force` equivalent, via `applyPrunePlan`); apply is
 * never blind (the plan is always shown first) and never a single stray key. Per
 * ADR-0009 apply is **blocked while the orchestrator child is running** — a live
 * run is concurrently creating the worktrees/branches Prune would delete — so
 * the guard (`describePruneApply`) refuses to arm/confirm while `status` is
 * `running`; `r` reloads the plan. Headless `pnpm sandcastle` (no Cockpit) still
 * runs the orchestrator loop directly — this file only adds a supervisor on top
 * of that same entry point.
 *
 * All logic with behaviour lives in the pure, unit-tested `cockpit-core.mts`
 * (tab cycling, NDJSON decode, log formatting, child-exit classification); this
 * file is the thin Ink layer + the imperative spawn wiring, untested per
 * CODING_STANDARDS.md (like `session-browser.tsx`). It is imported as
 * `./cockpit-core.mjs` so tsc (which typechecks `.tsx`) resolves the `.mts`
 * source — the same `.mjs`-specifier convention `session-browser.tsx` uses.
 *
 * Run via `pnpm sandcastle:cockpit` (i.e. `tsx .sandcastle/cockpit.tsx`). The
 * `.sandcastle/package.json` `{"type":"module"}` marker makes this `.tsx` ESM so
 * Ink's transitive `yoga-layout@3` (top-level await) loads under tsx (ADR-0007).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdin, useStdout } from "ink";

import { useMeasuredHeight, useViewport } from "./viewport-hooks.jsx";

import {
  appendLogLine,
  COCKPIT_TABS,
  cycleProfile,
  cycleTab,
  describePruneApply,
  EMPTY_LIVE_VIEW,
  ENTER_ALT_SCREEN,
  flattenPrunePlan,
  FOLLOWING_VIEWPORT,
  formatInFlight,
  formatPoolGauge,
  formatProfileHeader,
  prunePlanTotal,
  reduceLiveEvent,
  RESTORE_NORMAL_SCREEN,
  routeCockpitInput,
  shouldUseAltScreen,
  spawnOrchestrator,
  stepPruneApply,
  type CockpitTab,
  type LiveView,
  type PruneApplyPhase,
  type PruneRow,
  type SpawnConfig,
  type Supervisor,
} from "./cockpit-core.mjs";
import { formatEventLog, eventSeverity, type OrchestratorEvent } from "./events.mjs";
import {
  parseProfileFlag,
  profileNames,
  resolveProfile,
  type ProfileName,
} from "./model-profiles.mjs";
import { planPrune, type PrunePlan } from "./prune-plan.mjs";
import { applyPrunePlan, discoverPruneState } from "./prune-driver.mjs";
import {
  EMPTY_BROWSER_VIEW,
  loadManifest,
  SessionBrowser,
  windowLabelOf,
  type BrowserView,
  type ManifestLoad,
} from "./SessionBrowser.jsx";

/** Absolute path to the orchestrator entry, resolved from THIS file so the
 *  child launches regardless of the caller's cwd. */
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Repo root (parent of `.sandcastle/`) — the child's cwd, so the orchestrator's
 *  relative prompt/session paths (`./.sandcastle/…`) resolve as they do headless. */
const REPO_ROOT = path.dirname(THIS_DIR);
const ORCHESTRATOR_ENTRY = path.join(THIS_DIR, "main.mts");
/** Local bin dir, prepended to the child's PATH so `tsx` resolves even when the
 *  Cockpit was launched without pnpm putting `node_modules/.bin` on PATH. */
const BIN_DIR = path.join(REPO_ROOT, "node_modules", ".bin");

/** Cap on the scrolling event log (bounded ring; oldest entries fall off). */
const LOG_CAP = 1000;

/** Cap on the Maintenance tab's apply-output log (a short bounded ring). */
const MAINT_LOG_CAP = 200;

/** The Cockpit Sessions tab uses the browser's default window (last 3 days); the
 *  standalone `sandcastle:browse` still accepts `--days` / `--since` on argv. */
const SESSIONS_WINDOW = {};
const SESSIONS_WINDOW_LABEL = windowLabelOf(SESSIONS_WINDOW);

/** The Live tab's supervised-child status. Launches `idle`; `running` while a
 *  child is alive; `stopped` after a clean Stop/exit; `crashed` after an
 *  unexpected exit (surfaced, never fatal to the Cockpit); `restarting` briefly
 *  while a self-restart drain (ADR-0013) respawns the child on new code. */
type ChildStatus = "idle" | "running" | "stopped" | "crashed" | "restarting";

/** One rendered line in the scrolling event log, with optional colour/dim. */
interface LogEntry {
  readonly text: string;
  readonly color?: string;
  readonly dim?: boolean;
}

/** Human tab labels for the tab bar (ids are lowercase in `COCKPIT_TABS`). */
const TAB_LABELS: Record<CockpitTab, string> = {
  live: "Live",
  sessions: "Sessions",
  maintenance: "Maintenance",
};

/** Wall-clock `HH:MM:SS` prefix for a log line, from an event's ISO `ts`. */
function clock(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toLocaleTimeString("en-GB", { hour12: false });
}

/** Map an event's severity to a log-line colour: failures red, soft warnings
 *  yellow, everything else default. The classification lives in the event seam
 *  (`eventSeverity`); this is only the presentational colour choice. */
const SEVERITY_COLOR: Record<ReturnType<typeof eventSeverity>, string | undefined> = {
  failure: "red",
  warn: "yellow",
  normal: undefined,
};

/** Turn one parsed orchestrator event into a coloured log entry. The line text
 *  is the pure, tested `formatEventLog`; the colour is `eventSeverity` mapped
 *  through {@link SEVERITY_COLOR}. */
function eventEntry(ev: OrchestratorEvent): LogEntry {
  return {
    text: `${clock(ev.ts)}  ${formatEventLog(ev)}`,
    color: SEVERITY_COLOR[eventSeverity(ev)],
  };
}

/** How the Cockpit launches the orchestrator: `tsx main.mts` in NDJSON mode,
 *  from the repo root, with `node_modules/.bin` on PATH so `tsx` resolves even
 *  when launched outside a pnpm script, and colour disabled so the child's
 *  stderr prose stays clean in the log. Passed to the tested `spawnOrchestrator`.
 *
 *  Parameterised by the Model profile to run (ADR-0016): the Cockpit is
 *  authoritative about which profile the child uses, so it sets `SANDCASTLE_PROFILE`
 *  explicitly (overriding any inherited value) — `main.mts` reads only that env var.
 *  Every spawn names its profile: a manual Start passes `selected`, a self-restart
 *  drain (ADR-0013) passes the draining child's own profile, never a pending switch. */
function orchestratorSpawn(profile: ProfileName): SpawnConfig {
  return {
    command: "tsx",
    args: [ORCHESTRATOR_ENTRY],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SANDCASTLE_EVENT_FORMAT: "ndjson",
      SANDCASTLE_PROFILE: profile,
      PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`,
      FORCE_COLOR: "0",
    },
  };
}

// ── Alternate screen buffer (ADR-0015) ──────────────────────────────────────
//
// In a TTY the Cockpit owns a blank full-height canvas (the alternate screen
// buffer vim/less/htop use) so it never overflows the real terminal; on any
// teardown path that canvas is restored and the operator's prior scrollback
// reappears. `altScreenActive` guards the restore so every exit path (clean
// quit, SIGINT/SIGTERM, uncaught throw, React unmount) can call it idempotently.
let altScreenActive = false;

/** Enter the alternate screen buffer, but ONLY in a real TTY — a piped/non-TTY
 *  run must emit no escapes (ADR-0015). Written before the first Ink paint so the
 *  operator never sees a flash of the normal-buffer frame. */
function enterAltScreen(): void {
  if (altScreenActive) return;
  if (!shouldUseAltScreen(process.stdout)) return;
  process.stdout.write(ENTER_ALT_SCREEN);
  altScreenActive = true;
}

/** Restore the normal screen buffer if the Cockpit took it over. Idempotent so
 *  every teardown path can call it without double-writing the escape. */
function exitAltScreen(): void {
  if (!altScreenActive) return;
  process.stdout.write(RESTORE_NORMAL_SCREEN);
  altScreenActive = false;
}

/** The tab bar: the active tab bracketed + highlighted, the rest dim. */
function TabBar({ tab }: { tab: CockpitTab }): React.ReactElement {
  return (
    <Box flexDirection="row">
      {COCKPIT_TABS.map((t) => {
        const active = t === tab;
        return (
          <Box key={t} marginRight={1}>
            <Text bold={active} color={active ? "cyan" : undefined} dimColor={!active}>
              {active ? `[${TAB_LABELS[t]}]` : ` ${TAB_LABELS[t]} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** Colour for the Live status word, by child status. */
function statusColor(status: ChildStatus): string {
  switch (status) {
    case "running":
      return "green";
    case "crashed":
      return "red";
    case "stopped":
      return "yellow";
    case "restarting":
      return "cyan";
    case "idle":
      return "gray";
  }
}

/** The in-flight panel: the pool gauge (busy/total slots) over the list of
 *  currently-running Sessions, all folded from the event stream into `view`. */
function InFlightPanel({ view }: { view: LiveView }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      <Box flexDirection="row">
        <Text bold>Pool </Text>
        <Text color="green">{formatPoolGauge(view)}</Text>
      </Box>
      {view.inflight.length === 0 ? (
        <Text dimColor>no Sessions in flight</Text>
      ) : (
        view.inflight.map((entry) => (
          <Text key={entry.issue} wrap="truncate-end">
            · {formatInFlight(entry)}
          </Text>
        ))
      )}
    </Box>
  );
}

/** The Live tab: status/Start-Stop header + pool gauge & in-flight list + the
 *  scrolling event log. The gauge/list derive purely from the event stream via
 *  `view` (never the Manifest — ADR-0008); the log runs the shared viewport
 *  reducer in **Follow mode** (ADR-0015): it auto-tails the newest events by
 *  default, but ↑/↓ · PgUp/PgDn · g/G scroll back through history. While scrolled
 *  up, Follow is **paused** — a paused indicator shows and incoming events do
 *  not yank the view down; `G`/End re-engages the tail. Its height is measured
 *  from the rendered log box (no magic constant), so it self-corrects on
 *  terminal resize and the in-flight list above takes its natural height. */
function LiveTab({
  status,
  statusMessage,
  running,
  selected,
  view,
  log,
}: {
  status: ChildStatus;
  statusMessage: string;
  /** The Model profile the live child was spawned with; null before first Start. */
  running: ProfileName | null;
  /** The Model profile the next manual Start will apply (`p` cycles it). */
  selected: ProfileName;
  view: LiveView;
  log: LogEntry[];
}): React.ReactElement {
  const action = status === "running" ? "Stop" : "Start";
  const profile = formatProfileHeader(running, selected);

  // Follow-mode viewport (ADR-0015): the log auto-tails the newest events, but
  // ↑/↓ · PgUp/PgDn · g/G scroll back through history (pausing Follow); G/End
  // re-engages the tail. `useMeasuredHeight` sizes the log box (no magic
  // constant); `useViewport` owns the state + wires the shared scroll chord,
  // which returns null for Enter/`p`/`q`/Tab so it never collides with the
  // Cockpit's Start/Stop, profile-cycle, or quit/tab-switch keys.
  const [logBoxRef, height] = useMeasuredHeight(20);
  const viewport = useViewport(log.length, height, FOLLOWING_VIEWPORT);
  const visible = log.slice(viewport.offset, viewport.offset + height);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexDirection="row">
        <Text>orchestrator: </Text>
        <Text bold color={statusColor(status)}>
          {status}
        </Text>
        <Text dimColor> — {statusMessage}</Text>
        <Text dimColor> · Enter to {action}</Text>
      </Box>
      <Box flexDirection="row">
        <Text dimColor>profile — running: </Text>
        <Text bold color="magenta">
          {profile.running}
        </Text>
        {profile.pending !== null && (
          <>
            <Text dimColor> · selected: </Text>
            <Text bold color="cyan">
              {profile.pending}
            </Text>
            <Text dimColor> (Start to apply)</Text>
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <InFlightPanel view={view} />
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        marginTop={1}
        borderStyle="single"
        borderColor="cyan"
        overflow="hidden"
      >
        <Text bold>
          Event log <Text dimColor>({log.length})</Text>
          {!viewport.follow && <Text color="yellow"> ⏸ paused — G/End to follow the tail</Text>}
        </Text>
        <Box ref={logBoxRef} flexDirection="column" flexGrow={1} overflow="hidden">
          {visible.length === 0 ? (
            <Text dimColor>idle — no events yet. Press Enter to Start the orchestrator.</Text>
          ) : (
            visible.map((entry, i) => (
              <Text key={i} wrap="truncate-end" color={entry.color} dimColor={entry.dim}>
                {entry.text === "" ? " " : entry.text}
              </Text>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** The plan the Maintenance tab renders, paired with the repo root its paths are
 *  reported relative to (and that `applyPrunePlan` deletes against). */
interface MaintPlan {
  readonly plan: PrunePlan;
  readonly repoRoot: string;
}

/** The Maintenance prune plan as one pager-scrollable viewport (ADR-0015).
 *  The 5–6 buckets are flattened (pure `flattenPrunePlan`) into a single ordered
 *  list of rows — bucket headers stay inline as separators, their items follow —
 *  and the whole thing scrolls as one offset. Apply is all-or-nothing, so there
 *  is no per-row cursor to track. ↑/↓ · PgUp/PgDn · g/G share the Live log's
 *  chord (`viewportScrollFromKey`); those keys never collide with the apply
 *  controls (`a`/`y`/`n`/`r`), which the Cockpit shell owns — the mapper returns
 *  null for every one of them (the issue's no-collision AC). Starts at the TOP
 *  (offset 0, not following) so the operator reads the dry-run preview from the
 *  first bucket down; the measured body box self-corrects on terminal resize. */
function PrunePager({ rows }: { rows: PruneRow[] }): React.ReactElement {
  // The plan is static, so the viewport starts at the TOP (offset 0, follow
  // off) to read the preview top-to-bottom. `useViewport` owns the state +
  // wires the shared scroll chord, which returns null for `a`/`y`/`n`/`r` so it
  // never collides with the apply controls the Cockpit shell owns (ADR-0015).
  const [bodyRef, height] = useMeasuredHeight(20);
  const viewport = useViewport(rows.length, height, { offset: 0, follow: false });
  const visible = rows.slice(viewport.offset, viewport.offset + height);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      marginTop={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      overflow="hidden"
    >
      <Box ref={bodyRef} flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((row, i) =>
          row.kind === "bucket-header" ? (
            <Text key={i} color={row.tone === "warn" ? "yellow" : undefined}>
              {row.label} ({row.count})
            </Text>
          ) : (
            <Text key={i} dimColor wrap="truncate-end">
              {" "}
              · {row.text}
            </Text>
          )
        )}
      </Box>
    </Box>
  );
}

/**
 * The Maintenance tab: the live Prune dry-run plan (from `planPrune`, #79) with
 * a guarded, explicit apply. The preview always renders; the apply control's
 * copy is driven by the pure `describePruneApply` guard + `applyPhase` — blocked
 * while a run is live (ADR-0009), a no-op when the plan is empty, an arm→confirm
 * prompt otherwise. All decisions are pure and tested in `cockpit-core.mts`; this
 * is just their presentation.
 */
function MaintenanceTab({
  maint,
  error,
  running,
  phase,
  log,
}: {
  maint: MaintPlan | null;
  error: string | null;
  running: boolean;
  phase: PruneApplyPhase;
  log: LogEntry[];
}): React.ReactElement {
  if (error !== null) {
    return (
      <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="red" marginTop={1}>
        <Text bold>Maintenance — Prune</Text>
        <Text color="red">could not compute plan: {error}</Text>
        <Text dimColor>Press r to retry.</Text>
      </Box>
    );
  }
  if (maint === null) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderColor="gray"
        marginTop={1}
      >
        <Text bold>Maintenance — Prune</Text>
        <Text dimColor>Computing dry-run plan…</Text>
      </Box>
    );
  }

  const { plan, repoRoot } = maint;
  const decision = describePruneApply({ running, plan });
  const total = prunePlanTotal(plan);
  // Flatten the 5–6 buckets into one ordered list of rows the pager scrolls as
  // a single offset (ADR-0015). Memoized so a re-render (e.g. applyPhase change)
  // doesn't re-flatten; the plan is stable between reloads.
  const rows = useMemo(() => flattenPrunePlan(plan, repoRoot), [plan, repoRoot]);

  // The apply control line: the confirm prompt when armed, else the guard's
  // reason (blocked/empty) or the ready-to-arm hint.
  const control =
    phase === "armed" ? (
      <Text color="yellow" bold>
        ⚠ Delete {total} item(s)? y to confirm · n/Esc to cancel
      </Text>
    ) : decision.blockedBy === "running" ? (
      <Text color="red">
        apply blocked — orchestrator is running. Stop the run before pruning (ADR-0009).
      </Text>
    ) : decision.blockedBy === "empty" ? (
      <Text dimColor>nothing to prune.</Text>
    ) : (
      <Text color="cyan">a to apply — deletes {total} item(s) · r to reload</Text>
    );

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} overflow="hidden">
      <Box flexDirection="row">
        <Text bold>Maintenance — Prune </Text>
        <Text dimColor>dry-run plan · {total} deletion(s)</Text>
      </Box>
      <PrunePager rows={rows} />
      <Box marginTop={1}>{control}</Box>
      {log.length > 0 && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan">
          <Text bold>Apply output</Text>
          {log.map((entry, i) => (
            <Text key={i} wrap="truncate-end" color={entry.color} dimColor={entry.dim}>
              {entry.text}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Top-level Cockpit frame: owns the tab + supervised-child state and input. */
function Cockpit({ initialProfile }: { initialProfile: ProfileName }): React.ReactElement {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const inputActive = isRawModeSupported === true;

  const [tab, setTab] = useState<CockpitTab>("live");
  const [status, setStatus] = useState<ChildStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("not started");
  // The Model profile the next manual Start will apply — seeded from `--profile`
  // and cycled by `p` (ADR-0016). `cycleProfile` keeps it a valid ProfileName.
  const [selected, setSelected] = useState<ProfileName>(initialProfile);
  // The profile the live child was spawned with; null until the first Start.
  // Set optimistically on a manual Start (running := selected) and reconciled from
  // the child's own `profile-selected` event (the source of truth, ADR-0016).
  const [running, setRunning] = useState<ProfileName | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  // The derived Live monitor state (pool gauge + in-flight list), folded from
  // the event stream by the pure `reduceLiveEvent` — never the Manifest.
  const [view, setView] = useState<LiveView>(EMPTY_LIVE_VIEW);
  // The Sessions tab's manifest, loaded lazily on first open (null until then).
  const [sessions, setSessions] = useState<ManifestLoad | null>(null);
  // The Sessions browser's view position, held here so it survives the browser
  // being unmounted on a tab switch (the browser seeds from it and reports every
  // change back). Without this a tab switch resets expansion/cursor/scroll/pager.
  const [sessionsView, setSessionsView] = useState<BrowserView>(EMPTY_BROWSER_VIEW);
  // The Maintenance tab's dry-run prune plan (null until first computed), the
  // last discovery error (if any), the arm→confirm apply phase, and the bounded
  // apply-output log.
  const [maint, setMaint] = useState<MaintPlan | null>(null);
  const [maintError, setMaintError] = useState<string | null>(null);
  const [applyPhase, setApplyPhase] = useState<PruneApplyPhase>("idle");
  const [maintLog, setMaintLog] = useState<LogEntry[]>([]);

  // The live supervisor (null when no child is running). A ref, not state, so
  // the async stdout/exit handlers always see the current child without stale
  // closures and toggling it never triggers a re-render on its own.
  const supervisorRef = useRef<Supervisor | null>(null);
  // Holds the latest `spawnWith` so the exit handler can respawn the child after a
  // self-restart drain (ADR-0013) without closing over a stale version of it. Set
  // from an effect below, once `spawnWith` is defined.
  const spawnRef = useRef<(profile: ProfileName) => void>(() => {});
  // Guards prune discovery against re-entrancy: the lazy-load effect and the `r`
  // key can both fire while a discovery microtask is already pending.
  const maintLoadingRef = useRef(false);

  const pushLog = useCallback((entry: LogEntry) => {
    setLog((l) => appendLogLine(l, entry, LOG_CAP));
  }, []);

  const pushMaintLog = useCallback((entry: LogEntry) => {
    setMaintLog((l) => appendLogLine(l, entry, MAINT_LOG_CAP));
  }, []);

  /** Recompute the dry-run prune plan off disk (lazy first open + `r` reload +
   *  after an apply). Discovery is synchronous git I/O, so it is deferred to a
   *  microtask to keep the Ink render loop responsive, and guarded against
   *  re-entrancy. The preview is always a dry run; nothing is deleted here. */
  const reloadPlan = useCallback(() => {
    if (maintLoadingRef.current) return;
    maintLoadingRef.current = true;
    setMaint(null);
    setMaintError(null);
    void Promise.resolve().then(() => {
      try {
        const state = discoverPruneState(REPO_ROOT);
        setMaint({ plan: planPrune(state), repoRoot: state.repoRoot });
      } catch (err) {
        setMaintError(err instanceof Error ? err.message : String(err));
      } finally {
        maintLoadingRef.current = false;
      }
    });
  }, []);

  /** Apply the plan (the `--force` equivalent) once the confirm guard passes,
   *  streaming each deletion into the apply log, then reload so the preview
   *  reflects what is left. `applyPrunePlan` is synchronous git/fs. */
  const runApply = useCallback(
    (target: MaintPlan) => {
      pushMaintLog({
        text: `▶ applying prune (${prunePlanTotal(target.plan)} item(s))…`,
        color: "cyan",
      });
      try {
        applyPrunePlan(target.plan, target.repoRoot, {
          onProgress: (line) => pushMaintLog({ text: `  ${line}` }),
          onWarning: (line) => pushMaintLog({ text: `  ⚠ ${line}`, color: "yellow" }),
        });
        pushMaintLog({ text: "✓ prune applied", color: "green" });
      } catch (err) {
        pushMaintLog({
          text: `✗ prune failed: ${err instanceof Error ? err.message : String(err)}`,
          color: "red",
        });
      }
      reloadPlan();
    },
    [pushMaintLog, reloadPlan]
  );

  /** Spawn the orchestrator child on a given Model profile (no-op if one is
   *  already running). Used by both a manual Start (with `selected`) and a
   *  self-restart drain respawn (with the draining child's own profile). */
  const spawnWith = useCallback(
    (profile: ProfileName) => {
      if (supervisorRef.current) return;
      setStatus("running");
      setStatusMessage("running");
      setView(EMPTY_LIVE_VIEW); // fresh monitor for this run (in-flight is non-durable)
      pushLog({ text: `▶ started orchestrator (profile: ${profile})`, color: "cyan" });
      supervisorRef.current = spawnOrchestrator(orchestratorSpawn(profile), {
        onEvent: (ev) => {
          setView((v) => reduceLiveEvent(v, ev));
          // The child reports the profile it resolved (ADR-0016) — the source of
          // truth for `running`, reconciling the optimistic set at manual Start.
          if (ev.type === "profile-selected" && (profileNames() as string[]).includes(ev.profile)) {
            setRunning(ev.profile as ProfileName);
          }
          pushLog(eventEntry(ev));
        },
        onStdoutRaw: (line) => pushLog({ text: line, dim: true }),
        onStderr: (line) => pushLog({ text: line, dim: true }),
        onExit: (exitStatus, message) => {
          supervisorRef.current = null;
          setStatus(exitStatus);
          setStatusMessage(message);
          pushLog({
            text: `${exitStatus === "crashed" ? "✗" : exitStatus === "restarting" ? "⟳" : "■"} ${message}`,
            color:
              exitStatus === "crashed" ? "red" : exitStatus === "restarting" ? "cyan" : "yellow",
          });
          // ADR-0013: a self-restart drain auto-respawns the child on the new code —
          // the supervisor's job, not the human's (an unattended loop must follow
          // its own upgrades). It respawns with `profile` — the profile THIS
          // draining child ran on — never `selected`, so a pending model switch is
          // not smuggled into a code-freshness restart (ADR-0016). A `crashed` exit
          // is deliberately NOT respawned.
          if (exitStatus === "restarting") spawnRef.current(profile);
        },
        onSpawnError: (message) => {
          supervisorRef.current = null;
          setStatus("crashed");
          setStatusMessage(`failed to start: ${message}`);
          pushLog({ text: `✗ failed to start orchestrator: ${message}`, color: "red" });
        },
      });
    },
    [pushLog]
  );

  // Keep the respawn hook pointing at the latest `spawnWith` so the exit handler's
  // self-restart (ADR-0013) never calls a stale closure.
  useEffect(() => {
    spawnRef.current = spawnWith;
  }, [spawnWith]);

  /** Manual Start (Enter on the Live tab): apply the pending selection —
   *  `running := selected` (ADR-0016) — and spawn the child on it. */
  const start = useCallback(
    (target: ProfileName) => {
      setRunning(target);
      spawnWith(target);
    },
    [spawnWith]
  );

  /** Stop the running orchestrator child (no-op if none). */
  const stop = useCallback(() => {
    if (!supervisorRef.current) return;
    setStatusMessage("stopping…");
    supervisorRef.current.stop();
  }, []);

  /** Quit the Cockpit, stopping any running child first (`q` / Ctrl-C). */
  const quit = useCallback(() => {
    supervisorRef.current?.stop();
    void exit();
  }, [exit]);

  // Safety net: if the Cockpit unmounts for any other reason, don't orphan the
  // child — SIGTERM it on teardown — and restore the operator's terminal if the
  // Cockpit had taken over the alternate screen (ADR-0015: never strand them in
  // the alt buffer).
  useEffect(
    () => () => {
      supervisorRef.current?.stop();
      exitAltScreen();
    },
    []
  );

  // Lazily load the manifest the first time the Sessions tab is opened, so the
  // embedded browser has data to seed from; its own `r` key reloads in place
  // from the same source thereafter.
  useEffect(() => {
    if (tab !== "sessions" || sessions !== null) return;
    let cancelled = false;
    void loadManifest().then((loaded) => {
      if (!cancelled) setSessions(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, sessions]);

  // Lazily compute the prune plan the first time the Maintenance tab is opened
  // (and after a reload/apply clears it); `r` recomputes in place thereafter. A
  // prior discovery error is NOT auto-retried (it would loop) — `r` retries.
  useEffect(() => {
    if (tab === "maintenance" && maint === null && maintError === null) reloadPlan();
  }, [tab, maint, maintError, reloadPlan]);

  // Disarm any pending apply the instant a run starts: a live orchestrator makes
  // apply unsafe (ADR-0009), so the confirm prompt must not linger. The confirm
  // path is re-guarded too (`stepPruneApply` aborts on a flipped guard), so this
  // is belt-and-suspenders for the UI.
  useEffect(() => {
    if (status === "running") setApplyPhase("idle");
  }, [status]);

  useInput(
    (input, key) => {
      // The Cockpit reserves only global keys — quit and Tab/Shift+Tab tab-switch
      // — and delegates every other key to the focused tab (#82). On the Sessions
      // tab that means the embedded SessionBrowser (which registers its own
      // useInput while mounted) owns ↑/↓, ←/→, Enter, r, and the pager keys.
      // `routeCockpitInput` is the pure, tested classifier.
      const action = routeCockpitInput(input, key);
      if (action.kind === "quit") {
        quit();
        return;
      }
      if (action.kind === "switch-tab") {
        setTab((t) => cycleTab(t, action.direction));
        return;
      }
      // Delegated. The Live tab has no child component, so its Start/Stop still
      // lives in the shell: Enter toggles it, and is inert on the other tabs.
      if (key.return && tab === "live") {
        if (status === "running") stop();
        else start(selected);
        return;
      }
      // `p` on the Live tab cycles the selected Model profile round-robin
      // (ADR-0016). It only ever mutates `selected`; the switch takes effect on
      // the next Start, never mid-run. `cycleProfile` keeps it a valid name.
      if (tab === "live" && input === "p") {
        setSelected((s) => cycleProfile(s));
        return;
      }
      // The Maintenance tab likewise has no child component: the shell drives its
      // guarded apply. `r` reloads the plan; `a`/`y`/`n`+Esc step the pure
      // arm→confirm machine, re-gated on the live guard so a run starting between
      // arm and confirm aborts the delete (ADR-0009).
      if (tab === "maintenance") {
        if (input === "r") {
          setApplyPhase("idle");
          reloadPlan();
          return;
        }
        const intent =
          input === "a"
            ? "arm"
            : input === "y"
              ? "confirm"
              : input === "n" || key.escape
                ? "cancel"
                : null;
        if (intent === null) return;
        const allowed =
          maint !== null &&
          describePruneApply({ running: status === "running", plan: maint.plan }).allowed;
        const step = stepPruneApply(applyPhase, intent, allowed);
        setApplyPhase(step.phase);
        if (step.apply && maint !== null) runApply(maint);
      }
    },
    { isActive: inputActive }
  );

  // The Cockpit canvas is pinned to the terminal height (ADR-0015): the root
  // Box takes stdout.rows so the flexGrow children (the tab content, the Live
  // event log) are height-bounded and their measured viewports are real, not
  // natural-content. Unset on a non-TTY stream (piped), where Ink renders the
  // single final frame at natural height and the alt screen is skipped.
  const termRows = stdout?.rows;

  return (
    <Box flexDirection="column" height={termRows} overflow="hidden">
      <TabBar tab={tab} />
      <Box flexDirection="column" flexGrow={1} marginTop={1} overflow="hidden">
        {tab === "live" ? (
          <LiveTab
            status={status}
            statusMessage={statusMessage}
            running={running}
            selected={selected}
            view={view}
            log={log}
          />
        ) : tab === "sessions" ? (
          sessions ? (
            <SessionBrowser
              initialEntries={sessions.entries}
              initialMessage={sessions.message}
              windowOpts={SESSIONS_WINDOW}
              windowLabel={SESSIONS_WINDOW_LABEL}
              standalone={false}
              // Persist the browser's in-place `r` reload into the shell's own
              // `sessions` state so it survives the unmount on a tab switch and
              // re-seeds the browser on return (otherwise a remount reverts to
              // the first-load manifest).
              onReload={setSessions}
              // Likewise persist the view position (expansion/cursor/scroll/pager)
              // so a tab switch restores where the operator was, not the top of
              // the tree.
              initialView={sessionsView}
              onViewChange={setSessionsView}
            />
          ) : (
            <Text dimColor>Loading sessions…</Text>
          )
        ) : (
          <MaintenanceTab
            maint={maint}
            error={maintError}
            running={status === "running"}
            phase={applyPhase}
            log={maintLog}
          />
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Tab/⇧Tab switch tab
          {tab === "live"
            ? " · Enter Start/Stop · p profile · ↑/↓ PgUp/PgDn g/G scroll (G follow)"
            : tab === "maintenance"
              ? " · a apply · r reload · ↑/↓ PgUp/PgDn g/G scroll"
              : ""}{" "}
          · q quit
        </Text>
      </Box>
    </Box>
  );
}

async function main(): Promise<void> {
  // Seed the selected Model profile from `--profile <name>` (ADR-0016), reusing the
  // exact parse + validate `run.mts`/`main.mts` use. Absent → the documented default
  // (`mixed`); an unknown name is a LOUD non-zero exit here — a typo must not
  // silently launch the wrong (expensive) models, the ADR-0014 fail-loud posture.
  // Every name the Cockpit constructs after this (via `cycleProfile`) is valid by
  // construction, so this is the only place a bad profile can enter.
  const resolution = resolveProfile(parseProfileFlag(process.argv.slice(2)) ?? undefined);
  if (!resolution.ok) {
    console.error(resolution.error);
    process.exit(1);
  }

  // Take over the alternate screen buffer BEFORE the first Ink paint (ADR-0015)
  // so the operator never sees a flash of the normal-buffer frame, and register
  // a restore on EVERY teardown path — clean exit, external SIGINT/SIGTERM, and
  // an uncaught throw/rejection — so a crash never strands them in the alt
  // buffer. `exitAltScreen` is idempotent, so overlapping paths are safe.
  enterAltScreen();
  const onSignal = (sig: "SIGINT" | "SIGTERM"): void => {
    exitAltScreen();
    // Conventional 128+signum exit so a wrapper sees a signal-driven stop.
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  const onUncaught = (err: unknown): void => {
    exitAltScreen();
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  };
  const onUnhandled = (reason: unknown): void => {
    exitAltScreen();
    console.error("Unhandled promise rejection:", reason);
    process.exit(1);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("uncaughtException", onUncaught);
  process.once("unhandledRejection", onUnhandled);

  // Render under the try so a failure in Ink's mount also restores the
  // operator's terminal and deregisters the signal handlers above — the AC's
  // "never left in the alt buffer" covers a render-time throw too.
  try {
    const instance = render(<Cockpit initialProfile={resolution.profile.name} />);
    await instance.waitUntilExit();
  } finally {
    // Clean quit (q / Ctrl-C via the shell) — restore the operator's terminal.
    exitAltScreen();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
