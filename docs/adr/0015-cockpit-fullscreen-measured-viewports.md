# Cockpit runs fullscreen (alternate screen) with measured, per-panel viewport scrolling

The Cockpit rendered into the **normal** terminal buffer via Ink's default
`render`, growing downward from wherever the cursor sat. Panels bounded their
height with hand-tuned constants (`termRows - 10`, `termRows - 6`) and several
did not bound at all (the Maintenance prune buckets, the Live in-flight list),
so whenever content was taller than the terminal the **real terminal scrolled**
and the operator lost the top of the frame. This ADR makes the Cockpit own a
full-height canvas and clip every long panel to a measured **Viewport** that
scrolls internally.

## Decision

1. **Alternate screen buffer.** On mount, in a TTY, the Cockpit enters the
   alternate screen buffer (`ESC[?1049h`) — the blank full-height canvas that
   `vim`/`less`/`htop` use — and restores it (`ESC[?1049l`) on exit. Restore is
   wired to normal quit **and** to `SIGINT`/`SIGTERM`/uncaught-throw teardown, so
   a crash never strands the operator in the alt buffer; on clean exit their
   shell scrollback returns intact. The supervised orchestrator's stdout is
   **piped** (parsed into the Live feed), never written to the terminal, so the
   child does not fight the alt screen.

2. **Measured height model.** The root `Box` is pinned to `stdout.rows`; each
   scroll region is a `flexGrow` box whose real height is read with Ink's
   `measureElement`, and its content is sliced to that height. This deletes every
   magic constant and self-corrects on terminal resize (Ink re-renders →
   re-measure → clamp offsets/cursor).

3. **Each long panel scrolls inside its Viewport.**
   - **Maintenance** — the 5–6 prune buckets flatten into **one** pager-scrolled
     Viewport (↑/↓ · PgUp/PgDn · g/G), offset-only, no per-row cursor (apply is
     all-or-nothing, so there is nothing to select).
   - **Live event log** — keeps auto-tail but gains scrollback with **Follow
     mode**: a paused indicator while scrolled up, live events do not yank the
     view down, `G`/End re-engages the tail.
   - **In-flight list** — shows every Pool slot at natural height (≤ 10); the
     event log `flexGrow`s into the remainder, so the operator always sees
     everything currently running.

4. **Logic in the pure core.** The offset-clamp + Follow-mode transitions are one
   pure, unit-tested reducer in `cockpit-core.mts`, shared by both live scrollers.
   The `.tsx` shell only wires refs, `measureElement`, and the alt-screen escape
   writes (untested, per `CODING_STANDARDS.md`).

## Considered options

- **Clear the main buffer once (`ESC[2J`), stay in the normal buffer.**
  _Rejected._ Leaves the Cockpit's final frame in scrollback on quit, does not
  restore the operator's prior terminal contents, and risks artifacts on resize.
- **Keep the arithmetic height (`termRows - constant`), just centralized.**
  _Rejected._ Still hand-tuned; re-breaks every time a border/header/footer
  changes — which is exactly the bug that let the panels overflow.
- **Truncate each panel with a "+N more" note instead of scrolling.** _Rejected._
  Hides items the operator can never reach inside the Cockpit, contradicting the
  goal of scrolling within the panel.
- **Per-panel offset math inline in the components.** _Rejected._ Duplicates the
  clamp/follow logic across two live panels and leaves it in the untested shell,
  against the pure-core/shell seam in `CODING_STANDARDS.md`.

## Consequences

- Non-TTY runs (piped stdout) skip the alt screen and fall back to sane default
  heights, so the Cockpit still degrades cleanly when not attached to a terminal.
- The footer help line gains the per-tab scroll keys.
- The Session browser's tree, already Viewport-scrolled via a `termRows - 6`
  constant, migrates onto the same measured model.
