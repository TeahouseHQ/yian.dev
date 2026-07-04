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
 * **Live feed** (NDJSON, from #78), parsed line-by-line and rendered as a
 * scrolling **event log**. Enter again **Stop**s it (SIGTERM); Start after a
 * stop/crash restarts. The child's stderr (the per-agent sub-feed + any crash
 * trace) is surfaced dimmed in the same log. A child crash/exit is reported in
 * the UI (status line + a coloured log line) without unmounting the Cockpit.
 *
 * **Sessions** and **Maintenance** are placeholder tabs in this slice (their
 * standalone commands, `sandcastle:browse` / `sandcastle:prune`, still work).
 * Headless `pnpm sandcastle` (no Cockpit) still runs the orchestrator loop
 * directly — this file only adds a supervisor on top of that same entry point.
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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdin, useStdout } from "ink";

import {
  appendLogLine,
  COCKPIT_TABS,
  cycleTab,
  formatEventLog,
  spawnOrchestrator,
  type CockpitTab,
  type Supervisor,
} from "./cockpit-core.mjs";
import type { OrchestratorEvent } from "./events.mjs";

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

/** The Live tab's supervised-child status. Launches `idle`; `running` while a
 *  child is alive; `stopped` after a clean Stop/exit; `crashed` after an
 *  unexpected exit (surfaced, never fatal to the Cockpit). */
type ChildStatus = "idle" | "running" | "stopped" | "crashed";

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

/** Turn one parsed orchestrator event into a coloured log entry: failures red,
 *  soft warnings yellow, everything else default. The line text is the pure,
 *  tested `formatEventLog`; only the colour choice is presentational. */
function eventEntry(ev: OrchestratorEvent): LogEntry {
  const failure =
    ev.type === "gh-error" ||
    ev.type === "planner-failed" ||
    (ev.type === "session-resolved" && ev.status === "failed");
  const warn = ev.type === "noop-escalated" || ev.type === "planner-no-plan";
  return {
    text: `${clock(ev.ts)}  ${formatEventLog(ev)}`,
    color: failure ? "red" : warn ? "yellow" : undefined,
  };
}

/** How the Cockpit launches the orchestrator: `tsx main.mts` in NDJSON mode,
 *  from the repo root, with `node_modules/.bin` on PATH so `tsx` resolves even
 *  when launched outside a pnpm script, and colour disabled so the child's
 *  stderr prose stays clean in the log. Passed to the tested `spawnOrchestrator`. */
const ORCHESTRATOR_SPAWN = {
  command: "tsx",
  args: [ORCHESTRATOR_ENTRY],
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    SANDCASTLE_EVENT_FORMAT: "ndjson",
    PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`,
    FORCE_COLOR: "0",
  },
} as const;

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
    case "idle":
      return "gray";
  }
}

/** The Live tab: status/Start-Stop header + the scrolling event log. */
function LiveTab({
  status,
  statusMessage,
  log,
  height,
}: {
  status: ChildStatus;
  statusMessage: string;
  log: LogEntry[];
  /** Max event-log rows to render (terminal-bounded; the log tail-follows). */
  height: number;
}): React.ReactElement {
  const action = status === "running" ? "Stop" : "Start";
  const visible = log.slice(Math.max(0, log.length - Math.max(1, height)));
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row">
        <Text>orchestrator: </Text>
        <Text bold color={statusColor(status)}>
          {status}
        </Text>
        <Text dimColor> — {statusMessage}</Text>
        <Text dimColor> · Enter to {action}</Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        marginTop={1}
        borderStyle="single"
        borderColor="cyan"
      >
        <Text bold>
          Event log <Text dimColor>({log.length})</Text>
        </Text>
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
  );
}

/** A placeholder tab (Sessions / Maintenance) — named, with its standalone route. */
function PlaceholderTab({ title, hint }: { title: string; hint: string }): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="gray" marginTop={1}>
      <Text bold>{title}</Text>
      <Text dimColor>Coming soon in the Cockpit.</Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

/** Top-level Cockpit frame: owns the tab + supervised-child state and input. */
function Cockpit(): React.ReactElement {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const inputActive = isRawModeSupported === true;

  const [tab, setTab] = useState<CockpitTab>("live");
  const [status, setStatus] = useState<ChildStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("not started");
  const [log, setLog] = useState<LogEntry[]>([]);

  // The live supervisor (null when no child is running). A ref, not state, so
  // the async stdout/exit handlers always see the current child without stale
  // closures and toggling it never triggers a re-render on its own.
  const supervisorRef = useRef<Supervisor | null>(null);

  const pushLog = useCallback((entry: LogEntry) => {
    setLog((l) => appendLogLine(l, entry, LOG_CAP));
  }, []);

  /** Start the orchestrator child (no-op if one is already running). */
  const start = useCallback(() => {
    if (supervisorRef.current) return;
    setStatus("running");
    setStatusMessage("running");
    pushLog({ text: "▶ started orchestrator (tsx main.mts)", color: "cyan" });
    supervisorRef.current = spawnOrchestrator(ORCHESTRATOR_SPAWN, {
      onEvent: (ev) => pushLog(eventEntry(ev)),
      onStdoutRaw: (line) => pushLog({ text: line, dim: true }),
      onStderr: (line) => pushLog({ text: line, dim: true }),
      onExit: (exitStatus, message) => {
        supervisorRef.current = null;
        setStatus(exitStatus);
        setStatusMessage(message);
        pushLog({
          text: `${exitStatus === "crashed" ? "✗" : "■"} ${message}`,
          color: exitStatus === "crashed" ? "red" : "yellow",
        });
      },
      onSpawnError: (message) => {
        supervisorRef.current = null;
        setStatus("crashed");
        setStatusMessage(`failed to start: ${message}`);
        pushLog({ text: `✗ failed to start orchestrator: ${message}`, color: "red" });
      },
    });
  }, [pushLog]);

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
  // child — SIGTERM it on teardown.
  useEffect(() => () => supervisorRef.current?.stop(), []);

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        quit();
        return;
      }
      if (key.leftArrow) {
        setTab((t) => cycleTab(t, "prev"));
        return;
      }
      if (key.rightArrow) {
        setTab((t) => cycleTab(t, "next"));
        return;
      }
      // Enter toggles Start/Stop, but only on the Live tab (the only functional
      // one this slice); it is inert on the placeholder tabs.
      if (key.return && tab === "live") {
        if (status === "running") stop();
        else start();
      }
    },
    { isActive: inputActive }
  );

  // Event-log viewport: terminal rows minus the surrounding chrome (tab bar,
  // status line, log-box border + header, footer). A sane default keeps the
  // slice math total when stdout has no rows (non-TTY).
  const termRows = stdout?.rows;
  const logHeight = termRows ? Math.max(3, termRows - 10) : 20;

  return (
    <Box flexDirection="column">
      <TabBar tab={tab} />
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {tab === "live" ? (
          <LiveTab status={status} statusMessage={statusMessage} log={log} height={logHeight} />
        ) : tab === "sessions" ? (
          <PlaceholderTab title="Sessions" hint="Standalone: `pnpm sandcastle:browse`" />
        ) : (
          <PlaceholderTab title="Maintenance" hint="Standalone: `pnpm sandcastle:prune`" />
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>←/→ switch tab · Enter Start/Stop · q quit</Text>
      </Box>
    </Box>
  );
}

async function main(): Promise<void> {
  const instance = render(<Cockpit />);
  await instance.waitUntilExit();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
