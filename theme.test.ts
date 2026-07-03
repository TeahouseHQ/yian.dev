import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Prefactor #58: indirect the semantic theme colours through CSS custom
 * properties so the palette can be swapped at runtime (groundwork for the
 * blog reader light theme, ADR-0005) with NO visible change.
 *
 * These tests pin the two things that make the refactor visually inert:
 *  1. Every semantic Tailwind colour resolves from a CSS custom property
 *     defined in `:root` (criterion 1).
 *  2. The channel triplet behind each variable is the exact RGB of the
 *     original dark hex, so every `bg-background`/`text-foreground` (and
 *     opacity-modified) class renders identically (criterion 2).
 *
 * The palette also keeps the `<alpha-value>` placeholder so Tailwind can
 * still emit opacity-modified utilities (e.g. `border-foreground/30`,
 * `bg-foreground/10`, `text-foreground/30`) that the site relies on; a
 * plain `var(--x)` indirection would silently DROP those classes.
 */
const require = createRequire(import.meta.url);
const tailwindConfig = require("./tailwind.config.js") as {
  theme: { colors: Record<string, unknown> };
};

const indexCss = readFileSync(path.resolve(__dirname, "styles/index.css"), "utf8");

/**
 * The dark "Tomorrow" palette as it lived *before* the refactor. Kept here as
 * the parity source-of-truth: each variable's channels must equal these.
 */
const ORIGINAL_HEX: Record<string, string> = {
  background: "#1d1f21",
  foreground: "#c5c8c6",
  selection: "#f0c674",
  line: "#282a2e",
  comment: "#969896",
  red: "#cc6666",
  orange: "#de935f",
  yellow: "#f0c674",
  green: "#b5bd68",
  aqua: "#8abeb7",
  blue: "#81a2be",
  purple: "#b294bb",
};

/** `#rrggbb` -> "r g b" space-separated channels (matches Tailwind var style). */
function hexToChannels(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Parse the first `<selector> { ... }` block of a CSS file into name -> raw
 * value. Strip block comments so a trailing hex annotation can't glue two
 * declarations together when splitting on `;`. Used for both `:root` (the
 * dark default) and `.theme-light` (the light overrides).
 */
function parseBlockDeclarations(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "\\s*{([^}]*)}"));
  if (!match) return {};
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const decls: Record<string, string> = {};
  for (const line of body.split(";")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name.startsWith("--")) decls[name] = value;
  }
  return decls;
}

describe("#58 semantic colours are indirected through CSS variables", () => {
  const semanticColours = Object.keys(ORIGINAL_HEX);

  describe("tailwind.config.js", () => {
    it.each(semanticColours)("%s resolves from a CSS custom property", (name) => {
      const value = tailwindConfig.theme.colors[name];
      expect(typeof value).toBe("string");
      // Must reference the `--color-<name>` custom property...
      expect(value).toContain(`var(--color-${name})`);
      // ...and keep the alpha placeholder so opacity modifiers keep working.
      expect(value).toContain("<alpha-value>");
    });

    it("leaves the non-semantic palette untouched", () => {
      // transparent / currentColor are bare keywords; black/white/gray stay
      // on Tailwind's built-in scales.
      expect(tailwindConfig.theme.colors.transparent).toBe("transparent");
      expect(tailwindConfig.theme.colors.currentColor).toBe("currentColor");
      expect(tailwindConfig.theme.colors.black).toBeDefined();
      expect(tailwindConfig.theme.colors.white).toBeDefined();
      expect(tailwindConfig.theme.colors.gray).toBeDefined();
    });
  });

  describe("styles/index.css :root", () => {
    const root = parseBlockDeclarations(indexCss, ":root");

    it.each(semanticColours)("defines --color-%s matching the original dark hex", (name) => {
      const variable = `--color-${name}`;
      expect(root[variable], `expected ${variable} in :root`).toBeDefined();
      // Channels must equal the original hex's RGB (visual parity).
      expect(root[variable]).toBe(hexToChannels(ORIGINAL_HEX[name]));
    });
  });
});

describe("#59 light theme overrides the CSS variables under .theme-light", () => {
  const semanticColours = Object.keys(ORIGINAL_HEX);
  const root = parseBlockDeclarations(indexCss, ":root");
  const light = parseBlockDeclarations(indexCss, ".theme-light");

  it("defines a .theme-light block", () => {
    expect(Object.keys(light).length).toBeGreaterThan(0);
  });

  it.each(semanticColours)(
    "overrides --color-%s under .theme-light with a value that differs from the dark default",
    (name) => {
      const variable = `--color-${name}`;
      expect(light[variable], `expected ${variable} in .theme-light`).toBeDefined();
      // The override must actually change the value, otherwise the light
      // theme would be visually identical to dark for this colour.
      expect(light[variable], `${variable} must differ from :root`).not.toBe(root[variable]);
    }
  );
});
