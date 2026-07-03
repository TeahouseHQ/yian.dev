import { describe, it, expect } from "vitest";

import { readPreference, nextTheme, THEME_STORAGE_KEY, LIGHT_THEME_CLASS } from "./theme";

describe("reader theme preference", () => {
  describe("readPreference", () => {
    it('returns "light" only for the literal stored value "light"', () => {
      expect(readPreference("light")).toBe("light");
    });

    it('defaults to "dark" when nothing is stored (first-time visitor)', () => {
      expect(readPreference(null)).toBe("dark");
    });

    it('treats an explicit "dark" value as dark', () => {
      expect(readPreference("dark")).toBe("dark");
    });

    it("falls back to dark for any unrecognized value (ignores prefers-color-scheme)", () => {
      // Any garbage / future value is not a valid preference, so it must not
      // silently enable the light theme.
      expect(readPreference("auto")).toBe("dark");
      expect(readPreference("")).toBe("dark");
      expect(readPreference("LIGHT")).toBe("dark"); // case-sensitive
    });
  });

  describe("nextTheme", () => {
    it("flips dark -> light", () => {
      expect(nextTheme("dark")).toBe("light");
    });

    it("flips light -> dark", () => {
      expect(nextTheme("light")).toBe("dark");
    });
  });

  it("exposes stable wiring constants", () => {
    // Pin the localStorage key + html class so the component, the CSS block,
    // and the tests share one source of truth.
    expect(THEME_STORAGE_KEY).toBe("reader-theme");
    expect(LIGHT_THEME_CLASS).toBe("theme-light");
  });
});
