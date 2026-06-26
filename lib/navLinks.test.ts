import { describe, expect, it } from "vitest";

import { NAV_LINKS, isActivePath } from "./navLinks";

describe("NAV_LINKS", () => {
  it("exposes a link for every key page from the redesign brief", () => {
    const hrefs = NAV_LINKS.map((l) => l.href);
    expect(hrefs).toEqual(["/home", "/about", "/projects", "/play", "/resume"]);
    for (const link of NAV_LINKS) {
      expect(typeof link.label).toBe("string");
      expect(link.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isActivePath", () => {
  it("treats the blog index (Home) as active on root, /home, and any blog post", () => {
    expect(isActivePath("/", "/home")).toBe(true);
    expect(isActivePath("/home", "/home")).toBe(true);
    expect(isActivePath("/posts/my-first-post", "/home")).toBe(true);
  });

  it("does not flag Home active on unrelated routes", () => {
    expect(isActivePath("/about", "/home")).toBe(false);
    expect(isActivePath("/projects", "/home")).toBe(false);
    expect(isActivePath("/play", "/home")).toBe(false);
  });

  it("matches a top-level section exactly", () => {
    expect(isActivePath("/about", "/about")).toBe(true);
    expect(isActivePath("/projects", "/projects")).toBe(true);
    expect(isActivePath("/resume", "/resume")).toBe(true);
  });

  it("matches nested routes under a section (e.g. /play/unity/foo -> Play)", () => {
    expect(isActivePath("/play", "/play")).toBe(true);
    expect(isActivePath("/play/unity/cube-runner", "/play")).toBe(true);
  });

  it("respects segment boundaries (prefix match does not bleed across sections)", () => {
    expect(isActivePath("/players", "/play")).toBe(false);
    expect(isActivePath("/about-me", "/about")).toBe(false);
    expect(isActivePath("/resume-print", "/resume")).toBe(false);
  });

  it("is insensitive to a trailing slash on the current path", () => {
    expect(isActivePath("/about/", "/about")).toBe(true);
    expect(isActivePath("/play/unity/foo/", "/play")).toBe(true);
  });
});
