import { describe, it, expect } from "vitest";

import {
  readPreference,
  nextTheme,
  themeInitScript,
  READER_PATH_PREFIX,
  THEME_STORAGE_KEY,
  LIGHT_THEME_CLASS,
} from "./theme";

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

describe("themeInitScript (FOUC blocker, issue #60)", () => {
  /**
   * Execute the generated script against the minimal DOM surface it touches,
   * stubbed on globalThis, and report whether `theme-light` was added to
   * <html>. No jsdom needed: the script only reads `location.pathname`,
   * `localStorage.getItem`, and `document.documentElement.classList.add`.
   */
  function runScript(opts: { pathname: string; stored: string | null; storageThrows?: boolean }): {
    added: boolean;
    threw: boolean;
  } {
    const added: string[] = [];
    let threw = false;
    const g = globalThis as Record<string, unknown>;
    const prev = {
      location: g.location,
      localStorage: g.localStorage,
      document: g.document,
    };
    g.location = { pathname: opts.pathname };
    g.localStorage = {
      getItem: () => {
        if (opts.storageThrows) throw new Error("blocked");
        return opts.stored;
      },
    };
    g.document = {
      documentElement: { classList: { add: (c: string) => added.push(c) } },
    };
    try {
      // The script is a self-contained IIFE; running it via the Function
      // constructor mirrors the browser executing the raw inline <script>.
      // eslint-disable-next-line no-new-func
      new Function(themeInitScript())();
    } catch (e) {
      threw = true;
    } finally {
      g.location = prev.location;
      g.localStorage = prev.localStorage;
      g.document = prev.document;
    }
    return { added: added.includes(LIGHT_THEME_CLASS), threw };
  }

  it("is built from the shared constants (single source of truth)", () => {
    const script = themeInitScript();
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain(LIGHT_THEME_CLASS);
    expect(script).toContain(READER_PATH_PREFIX);
    // Reads the live pathname to decide whether to act.
    expect(script).toContain("location.pathname");
  });

  it("adds theme-light on a post path when the stored preference is light", () => {
    const { added, threw } = runScript({
      pathname: "/posts/hello-world",
      stored: "light",
    });
    expect(added).toBe(true);
    expect(threw).toBe(false);
  });

  it("leaves <html> dark on a post path when the preference is dark", () => {
    const { added } = runScript({ pathname: "/posts/hello-world", stored: "dark" });
    expect(added).toBe(false);
  });

  it("leaves <html> dark for a first-time visitor (no stored value)", () => {
    const { added } = runScript({ pathname: "/posts/hello-world", stored: null });
    expect(added).toBe(false);
  });

  it("is gated on the /posts/ prefix so non-post pages stay dark", () => {
    // Even with a saved light preference, /home must not flip before paint —
    // the toggle lives only on post pages.
    const { added } = runScript({ pathname: "/home", stored: "light" });
    expect(added).toBe(false);
  });

  it("does not match the bare /posts prefix without a trailing slug", () => {
    // `/posts` (no slash) is not a reader route; the gate is `/posts/`.
    const { added } = runScript({ pathname: "/posts", stored: "light" });
    expect(added).toBe(false);
  });

  it("degrades to dark (and never throws) when localStorage is blocked", () => {
    // Private mode / disabled storage: the catch swallows so the page still
    // renders (dark) instead of breaking first paint.
    const { added, threw } = runScript({
      pathname: "/posts/hello-world",
      stored: null,
      storageThrows: true,
    });
    expect(added).toBe(false);
    expect(threw).toBe(false);
  });

  it("is an immediately-invoked function that pollutes no globals", () => {
    const script = themeInitScript();
    expect(script.startsWith("(function")).toBe(true);
    expect(script).toMatch(/\}\)\(\);?\s*$/);
  });
});
