import { afterEach, describe, expect, it, vi } from "vitest";

import { GISCUS_ORIGIN, buildGiscusScriptAttributes, resolveGiscusConfig } from "./giscus";

const CONFIG = {
  repo: "TeahouseHQ/yian.dev",
  repoId: "R_kgDOabc",
  category: "Comments",
  categoryId: "DIC_kwDOxyz",
};

describe("resolveGiscusConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps explicit repo/category overrides and both opaque ids", () => {
    const config = resolveGiscusConfig({
      repo: "TeahouseHQ/other",
      repoId: "R_kgDOabc",
      category: "General",
      categoryId: "DIC_kwDOxyz",
    });

    expect(config).toEqual({
      repo: "TeahouseHQ/other",
      repoId: "R_kgDOabc",
      category: "General",
      categoryId: "DIC_kwDOxyz",
    });
  });

  it("falls back to this repo and the Comments category when unset", () => {
    const config = resolveGiscusConfig({
      repoId: "R_kgDOabc",
      categoryId: "DIC_kwDOxyz",
    });

    expect(config).toEqual({
      repo: "TeahouseHQ/yian.dev",
      repoId: "R_kgDOabc",
      category: "Comments",
      categoryId: "DIC_kwDOxyz",
    });
  });

  it("is null when the repo id is missing", () => {
    expect(resolveGiscusConfig({ categoryId: "DIC_kwDOxyz" })).toBeNull();
  });

  it("is null when the category id is missing", () => {
    expect(resolveGiscusConfig({ repoId: "R_kgDOabc" })).toBeNull();
  });

  it("treats empty-string ids (unset NEXT_PUBLIC vars) as missing", () => {
    expect(resolveGiscusConfig({ repoId: "", categoryId: "DIC_kwDOxyz" })).toBeNull();
  });
});

describe("buildGiscusScriptAttributes", () => {
  it("targets the giscus client script on its documented origin", () => {
    const attrs = buildGiscusScriptAttributes(CONFIG, "post-uuid", "dark");

    expect(attrs.src).toBe(`${GISCUS_ORIGIN}/client.js`);
  });

  it("pins the discussion to the post via specific mapping on its stable id", () => {
    const attrs = buildGiscusScriptAttributes(CONFIG, "1697fde7-53c0", "dark");

    expect(attrs["data-mapping"]).toBe("specific");
    expect(attrs["data-term"]).toBe("1697fde7-53c0");
  });

  it("passes the resolved config through as data attributes", () => {
    const attrs = buildGiscusScriptAttributes(CONFIG, "t", "dark");

    expect(attrs["data-repo"]).toBe("TeahouseHQ/yian.dev");
    expect(attrs["data-repo-id"]).toBe("R_kgDOabc");
    expect(attrs["data-category"]).toBe("Comments");
    expect(attrs["data-category-id"]).toBe("DIC_kwDOxyz");
  });

  it("applies the reader theme and the widget behaviour choices", () => {
    expect(buildGiscusScriptAttributes(CONFIG, "t", "light")["data-theme"]).toBe("light");
    expect(buildGiscusScriptAttributes(CONFIG, "t", "dark")["data-theme"]).toBe("dark");

    const attrs = buildGiscusScriptAttributes(CONFIG, "t", "dark");
    expect(attrs["data-reactions-enabled"]).toBe("1");
    expect(attrs["data-emit-metadata"]).toBe("0");
    expect(attrs["data-loading"]).toBe("lazy");
    expect(attrs.crossorigin).toBe("anonymous");
  });
});

describe("resolveGiscusConfig from process.env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads statically inlined NEXT_PUBLIC_GISCUS_* variables", () => {
    vi.stubEnv("NEXT_PUBLIC_GISCUS_REPO_ID", "R_env");
    vi.stubEnv("NEXT_PUBLIC_GISCUS_CATEGORY_ID", "DIC_env");

    // Mirrors the exact call site in CommentsBox: each NEXT_PUBLIC var must
    // be a static `process.env.X` member expression so Next.js inlines it
    // into the client bundle (dynamic `process.env[name]` access is not
    // replaced at build time).
    const config = resolveGiscusConfig({
      repo: process.env.NEXT_PUBLIC_GISCUS_REPO,
      repoId: process.env.NEXT_PUBLIC_GISCUS_REPO_ID,
      category: process.env.NEXT_PUBLIC_GISCUS_CATEGORY,
      categoryId: process.env.NEXT_PUBLIC_GISCUS_CATEGORY_ID,
    });

    expect(config).toEqual({
      repo: "TeahouseHQ/yian.dev",
      repoId: "R_env",
      category: "Comments",
      categoryId: "DIC_env",
    });
  });
});
