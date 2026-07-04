# The Cockpit supervises the orchestrator as a child process over a structured event stream

The Cockpit TUI runs the orchestrator (`main.mts`) as a spawned child process,
not in-process, and renders live state from a structured event stream (NDJSON on
the child's stdout) rather than scraping `console.log` prose. The **Live feed**
becomes one typed event stream with two renderers — a prose formatter for
headless `sandcastle` runs, the Cockpit's widgets for the TUI.

## Considered Options

- **Child process + structured events (chosen)** — isolation and restartability:
  the orchestrator is a long-lived, crash-prone daemon (Docker / GitHub /
  network), so a throw in its loop must not take the UI down, and `main.mts`
  stays independently runnable headless (CI, servers). Cost: live state is
  bounded by what crosses the pipe — accepted, with the event schema as the
  contract.
- **In-process** — the Cockpit imports and runs the loop for direct access to
  in-memory `pool` / `inflight` state, but couples an infinite concurrent loop
  to the render process (a throw kills the UI) and forces `main.mts` to stop
  writing to stdout.
- **No orchestrator change (tail Run logs + Manifest)** — zero work, but Run
  logs are lossy / `TextDeltaBuffer`-fragmented and the Manifest is post-hoc, so
  the monitor would be laggy and unable to show in-flight work.

## Consequences

`main.mts`'s ad-hoc `console.log`s are refactored into a typed event emitter; the
in-flight list and pool gauge derive from the event stream, not the Manifest
(which only gains a row after a Session resolves). Headless output is preserved
by the prose renderer. See CONTEXT.md: Live feed, Cockpit.
