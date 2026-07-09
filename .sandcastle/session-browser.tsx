/**
 * Sandcastle session browser — standalone entry point (issues #72–#74, #82).
 *
 * The browser UI lives in the reusable {@link SessionBrowser} component
 * (`SessionBrowser.tsx`), mounted here for the standalone `sandcastle:browse`
 * command and, unchanged, in the Cockpit's Sessions tab (`cockpit.tsx`). This
 * file is only the standalone shell: parse the window args, do the initial
 * synchronous manifest read (so the first paint has no loading flash), and
 * render the component full-screen. See ADR-0007 for the Ink/tsx setup and the
 * `.sandcastle/package.json` `{"type":"module"}` ESM marker.
 *
 * Run via `pnpm sandcastle:browse` (i.e. `tsx .sandcastle/session-browser.tsx`).
 */
import React from "react";
import { Box, render } from "ink";

import { parseWindowArgs } from "./render-transcript.mjs";
import { loadManifest, SessionBrowser, windowLabelOf } from "./SessionBrowser.jsx";

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
  // flash); the browser's `r` key re-reads from the same source on demand.
  const { entries: initialEntries, message: initialMessage } = await loadManifest();

  // Pin the canvas to the terminal height (ADR-0015) so the tree's measured
  // viewport is a real bounded height rather than its natural content height —
  // the standalone mount must bound the tree exactly as the Cockpit's content
  // area does when it embeds the same component.
  const rows = process.stdout.rows;
  const instance = render(
    <Box flexDirection="column" height={rows} overflow="hidden">
      <SessionBrowser
        initialEntries={initialEntries}
        initialMessage={initialMessage}
        windowOpts={windowOpts}
        windowLabel={windowLabel}
      />
    </Box>
  );
  await instance.waitUntilExit();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
