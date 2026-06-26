"use client";

import { useEffect } from "react";

/**
 * Scrolls the resume to the section named by the URL hash
 * (e.g. `/resume#experience`) on initial load and whenever the hash changes.
 * Rendered once near the top of ResumeLayout; emits no DOM.
 */
export function ResumeHashScroll() {
  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      const target = document.getElementById(hash);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return null;
}
