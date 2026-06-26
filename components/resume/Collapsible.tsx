"use client";

import { useId, useState, type ReactNode } from "react";

interface Props {
  /** Anchor id for deep-linking (e.g. a specific job). */
  id?: string;
  /** Always-visible header content (company | title). */
  summary: ReactNode;
  /** Optional right-aligned metadata (e.g. date range). */
  meta?: ReactNode;
  /** Collapsible body. */
  children: ReactNode;
  /** Start expanded. Defaults to true so content is visible on first paint + print. */
  defaultOpen?: boolean;
}

/**
 * Accessible expand/collapse wrapper used for resume job entries. The toggle
 * button is hidden in print and the body is force-shown via print CSS in
 * styles/index.css, so a collapsed entry still prints in full.
 */
export function Collapsible({ id, summary, meta, children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div id={id} className="resume-entry">
      <div className="flex flex-col md:flex-row md:justify-between md:items-baseline gap-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            className="collapsible-toggle no-print text-black/40 hover:text-black print:hidden"
            aria-expanded={open}
            aria-controls={contentId}
            aria-label={open ? "Collapse details" : "Expand details"}
            onClick={() => setOpen((prev) => !prev)}
          >
            <i
              className={open ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-right"}
              aria-hidden="true"
            />
          </button>
          <div>{summary}</div>
        </div>
        {meta != null && <div className="text-sm text-black/60 md:text-right">{meta}</div>}
      </div>
      <div id={contentId} className={`collapsible-content mt-1 ${open ? "" : "hidden"}`}>
        {children}
      </div>
    </div>
  );
}
