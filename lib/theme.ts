/**
 * Blog reader theme preference (ADR-0005). A single global light/dark choice
 * persisted in `localStorage`, applied to every Blog reader and dark by
 * default. The {@link ThemeToggle} client component reads the preference on
 * mount and adds {@link LIGHT_THEME_CLASS} to `<html>` when it is "light";
 * its cleanup removes the class on unmount, so post pages pick up the theme
 * (including across client-side navigation between posts) while every other
 * page stays dark.
 *
 * The light palette itself is a set of CSS-variable overrides under
 * `.theme-light` in `styles/index.css`; the dark "Tomorrow" values remain the
 * `:root` default. Code blocks stay dark in both modes because highlight.js
 * pins its own colours via the atom-one-dark stylesheet.
 *
 * The OS `prefers-color-scheme` is deliberately ignored — the choice is the
 * reader's, not the OS's.
 *
 * The decision helpers below are kept pure (no `localStorage`/`document`
 * access) so they can be unit-tested in a node environment; the only side
 * effects live in the component.
 */

/** localStorage key holding the reader theme preference ("light" | "dark"). */
export const THEME_STORAGE_KEY = "reader-theme";

/** Class toggled on `<html>` to activate the light palette overrides. */
export const LIGHT_THEME_CLASS = "theme-light";

export type ReaderTheme = "light" | "dark";

/**
 * Resolve a stored value into a theme. Returns "light" only for the literal
 * value "light"; anything else (including `null`, i.e. a first-time visitor)
 * resolves to "dark". Unrecognized values never silently enable light mode,
 * and `prefers-color-scheme` is intentionally not consulted.
 */
export function readPreference(stored: string | null): ReaderTheme {
  return stored === "light" ? "light" : "dark";
}

/** Return the opposite theme, for a toggle action. */
export function nextTheme(current: ReaderTheme): ReaderTheme {
  return current === "light" ? "dark" : "light";
}
