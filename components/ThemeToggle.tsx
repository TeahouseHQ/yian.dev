"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";

import {
  LIGHT_THEME_CLASS,
  THEME_STORAGE_KEY,
  nextTheme,
  readPreference,
  type ReaderTheme,
} from "#/lib/theme";

interface ButtonProps {
  theme: ReaderTheme;
  onToggle: () => void;
}

/** Sun icon — shown in dark mode (the action is "switch to light"). */
function SunIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** Moon icon — shown in light mode (the action is "switch to dark"). */
function MoonIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const META: Record<ReaderTheme, { Icon: ComponentType; label: string }> = {
  dark: { Icon: SunIcon, label: "Switch to light theme" },
  light: { Icon: MoonIcon, label: "Switch to dark theme" },
};

/**
 * Pure presentational toggle. Kept stateless so both reader states (dark /
 * light) are server-renderable and unit-testable without a DOM; the client
 * wrapper below owns the preference + side effects.
 */
export function ThemeToggleButton({ theme, onToggle }: ButtonProps): React.JSX.Element {
  const { Icon, label } = META[theme];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={theme === "light"}
      title={label}
      className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-foreground/30 bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-selection"
    >
      <Icon />
    </button>
  );
}

/**
 * Blog reader theme toggle (ADR-0005, issue #59). Rendered only on post pages
 * (`/posts/[slug]`), where it mounts a fixed sun/moon button.
 *
 * The preference is a single global light/dark choice persisted in
 * `localStorage` (`THEME_STORAGE_KEY`), dark by default; the OS
 * `prefers-color-scheme` is deliberately ignored. On mount the stored
 * preference is read and `theme-light` is added to `<html>` when it is
 * "light"; on unmount that class is removed, so navigating away from a post
 * (to `/home` etc.) restores the dark default while navigating between posts
 * keeps the chosen theme (the component stays mounted across post→post
 * client navigation, so the class is never torn down).
 *
 * The initial state is always "dark" so the server render and first client
 * paint agree (no stored value exists during SSR) — the stored preference is
 * applied in the effect, which runs only on the client, avoiding a hydration
 * mismatch.
 */
export default function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<ReaderTheme>("dark");

  useEffect(() => {
    const stored = readPreference(localStorage.getItem(THEME_STORAGE_KEY));
    setTheme(stored);
    document.documentElement.classList.toggle(LIGHT_THEME_CLASS, stored === "light");
    return () => {
      // Leaving the reader drops the override so non-post pages stay dark.
      document.documentElement.classList.remove(LIGHT_THEME_CLASS);
    };
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const updated = nextTheme(prev);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, updated);
      } catch {
        // Private mode / disabled storage: keep the in-memory toggle working
        // even though the choice won't persist across reloads.
      }
      document.documentElement.classList.toggle(LIGHT_THEME_CLASS, updated === "light");
      return updated;
    });
  }, []);

  return <ThemeToggleButton theme={theme} onToggle={toggle} />;
}
