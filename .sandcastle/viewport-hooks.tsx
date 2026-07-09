/**
 * Shared viewport-panel hooks (ADR-0015) — the React/Ink shell wiring behind
 * every internally-scrolling Cockpit panel: the Live event log's Follow mode,
 * the Maintenance prune pager, and the Sessions transcript pager. Each panel
 * reduces to "measure → reduce → slice": `useMeasuredHeight` returns a ref to
 * attach to the scrollable Box plus its measured row count, and `useViewport`
 * owns the follow/offset state and wires the shared scroll chord onto it.
 *
 * Extracted here (from `cockpit.tsx`) so `cockpit.tsx` and `SessionBrowser.tsx`
 * drive their viewports through the SAME code path — the three panels can never
 * drift apart on scroll behaviour again. Shell only (untested per
 * `CODING_STANDARDS.md`); the transitions themselves live in the pure,
 * unit-tested `reduceViewport` / `viewportScrollFromKey` in `cockpit-core.mts`.
 * Imported via the `.jsx` specifier convention so tsc resolves the `.tsx`.
 */
import React, { useEffect, useRef, useState } from "react";
import { measureElement, useInput, useStdin, type DOMElement } from "ink";

import { reduceViewport, viewportScrollFromKey, type ViewportState } from "./cockpit-core.mjs";

/** Measure a Box's height each commit (Ink re-renders on resize) and bail on an
 *  unchanged measurement so it converges without a render loop. Returns the ref
 *  to attach to the measured Box and the (clamped, ≥1) height. */
export function useMeasuredHeight(
  fallback: number
): readonly [React.RefObject<DOMElement | null>, number] {
  const ref = useRef<DOMElement>(null);
  const [height, setHeight] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const h = Math.max(1, measureElement(node).height);
    setHeight((prev) => (prev === h ? prev : h));
  });
  return [ref, Math.max(1, height)] as const;
}

/** Own a panel's viewport state: a `content` reconcile on every lines/height
 *  change re-tails a following view but holds a paused offset, and the shared
 *  scroll chord (`viewportScrollFromKey`) wires ↑/↓ · PgUp/PgDn · g/G — returning
 *  null for every other key so it never collides with a panel's own controls
 *  (the issue's no-collision AC). `initial` seeds the viewport: the Live log
 *  follows the tail, the Maintenance/transcript pagers start at the top. */
export function useViewport(lines: number, height: number, initial: ViewportState): ViewportState {
  const { isRawModeSupported } = useStdin();
  const inputActive = isRawModeSupported === true;
  const [viewport, setViewport] = useState<ViewportState>(initial);
  useEffect(() => {
    setViewport((v) => {
      const next = reduceViewport(v, { kind: "content", lines, height });
      return next.offset === v.offset && next.follow === v.follow ? v : next;
    });
  }, [lines, height]);
  useInput(
    (input, key) => {
      const step = viewportScrollFromKey(input, key);
      if (step === null) return;
      setViewport((v) => reduceViewport(v, { kind: "scroll", step, lines, height }));
    },
    { isActive: inputActive }
  );
  return viewport;
}
