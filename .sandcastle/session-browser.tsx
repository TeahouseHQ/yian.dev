/**
 * Sandcastle session browser — interactive Ink TUI (issue #72).
 *
 * The first tracer bullet for the Session browser (see CONTEXT.md; design in
 * docs/adr/0007-session-browser-ink-tui.md): on launch it reads the manifest
 * (`.sandcastle/sessions/manifest.jsonl`) via the **existing pure core** in
 * `render-transcript.mjs` — imported, not reimplemented — windows it to the
 * last 3 days (`--since` / `--days` to override), groups the entries into Runs
 * sorted newest-first by each Run's max `endedAt`, and renders them as a static
 * list: each Run header followed by its Sessions. `q` (or Ctrl-C) quits.
 *
 * This slice is local-only and read-once; interaction and transcript rendering
 * come in later slices (issues #73 / #74). Ink is a deliberate deviation from
 * the sibling CLI's zero-dep stance — see ADR-0007; the zero-dep constraint is
 * owned by `render-transcript.mjs`, not this tool.
 *
 * Run via `pnpm sandcastle:browse` (i.e. `tsx .sandcastle/session-browser.tsx`).
 * The `.sandcastle/package.json` `{"type":"module"}` marker makes this `.tsx`
 * ESM so Ink's transitive `yoga-layout@3` (top-level await) loads under tsx.
 */
import { existsSync } from "node:fs";
import React from "react";
import { Box, render, Text, useApp, useInput, useStdin } from "ink";

import {
  DEFAULT_WINDOW_DAYS,
  groupRuns,
  manifestPath,
  parseWindowArgs,
  readManifest,
  resolveCutoff,
  summarizeEntry,
  withinWindow,
} from "./render-transcript.mjs";

/** One grouped Run, as produced by `groupRuns` (runId + its sessions + max endedAt). */
type Run = { runId: string; entries: object[]; endedAt: number };

/**
 * Listen for `q` (and Ctrl-C as a backstop to Ink's built-in `exitOnCtrlC`) and
 * exit the app. `useInput` is gated on `isRawModeSupported` so a non-TTY run
 * (pipe / CI) renders the static list without crashing on raw-mode setup.
 */
function QuitOnQ(): React.ReactElement {
  const { exit } = useApp();
  // `stdin.isTTY` is `undefined` (not `false`) when there's no TTY, so coerce
  // to a strict boolean: Ink's useInput only short-circuits on `isActive ===
  // false`, and a non-TTY run must not call setRawMode(true) (it throws).
  const { isRawModeSupported } = useStdin();
  const active = isRawModeSupported === true;
  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) void exit();
    },
    { isActive: active }
  );
  return <></>;
}

/** One Run: a header line + its Sessions (reusing the CLI's summary row). */
function RunBlock({ run }: { run: Run }): React.ReactElement {
  const n = run.entries.length;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>
        Run {run.runId} ({n} session{n === 1 ? "" : "s"})
      </Text>
      {run.entries.map((e, i) => (
        <Text key={i}> {summarizeEntry(e)}</Text>
      ))}
    </Box>
  );
}

/** Top-level browser frame. `message`, when set, replaces the run list. */
function Browser({
  runs,
  windowLabel,
  message,
}: {
  runs: Run[];
  windowLabel: string;
  message?: string;
}): React.ReactElement {
  let body: React.ReactNode;
  if (message != null) {
    body = <Text color="yellow">{message}</Text>;
  } else if (runs.length === 0) {
    body = <Text color="yellow">No runs in this window.</Text>;
  } else {
    body = runs.map((run) => <RunBlock key={run.runId} run={run} />);
  }
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Sandcastle sessions — {windowLabel}
      </Text>
      <Text dimColor>Press q (or Ctrl-C) to quit.</Text>
      <Box flexDirection="column" marginTop={1}>
        {body}
      </Box>
      <QuitOnQ />
    </Box>
  );
}

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
  const cutoff = resolveCutoff(windowOpts);
  const windowLabel = windowLabelOf(windowOpts);

  // Missing manifest — graceful message, no crash.
  if (!existsSync(manifestPath)) {
    render(
      <Browser
        runs={[]}
        windowLabel={windowLabel}
        message={`No manifest found at ${manifestPath}.\nRun sandcastle first; sessions are recorded on Run resolution.`}
      />
    );
    return;
  }

  // Read manifest; a corrupt line is reported rather than aborting.
  let entries: object[];
  try {
    entries = await readManifest();
  } catch (err) {
    render(
      <Browser
        runs={[]}
        windowLabel={windowLabel}
        message={`Could not read manifest at ${manifestPath}:\n${
          err instanceof Error ? err.message : String(err)
        }`}
      />
    );
    return;
  }

  if (entries.length === 0) {
    render(
      <Browser runs={[]} windowLabel={windowLabel} message={`Manifest is empty: ${manifestPath}`} />
    );
    return;
  }

  const recent = groupRuns(withinWindow(entries, cutoff));
  // cutoff === NO_WINDOW ⇒ windowLabel already says "all time"; otherwise name
  // the window. (NO_WINDOW only happens via --days 0.)
  render(<Browser runs={recent} windowLabel={windowLabel} />);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
