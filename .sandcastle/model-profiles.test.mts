import { describe, expect, it } from "vitest";

import type { ModelCatalog } from "./repo-profile.mts";
import { MODEL_ROLES, parseProfileFlag, profileNames, resolveProfile } from "./model-profiles.mts";

// A fixture catalog, written as known-good literals here (the source of truth is
// this test, NOT the shipped repo-profile.json) so the resolution assertions can
// actually disagree with the code. Model ids now live in the profile, not in
// model-profiles.mts — the resolver only picks among a catalog handed to it.
const CATALOG: ModelCatalog = {
  profiles: {
    cheap: {
      planner: "test/cheap",
      implementer: "test/cheap",
      reviewer: "test/cheap",
      resolver: "test/cheap",
    },
    careful: {
      planner: "test/careful",
      implementer: "test/cheap",
      reviewer: "test/careful",
      resolver: "test/careful",
    },
  },
  default: "careful",
};

describe("resolveProfile — picks the active preset from an injected catalog", () => {
  it("defaults to the catalog's default silently when the value is unset", () => {
    const result = resolveProfile(undefined, CATALOG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("careful");
    expect(result.profile.models).toEqual(CATALOG.profiles.careful);
  });

  it("treats an empty/whitespace value as unset (defaults to the catalog default)", () => {
    const result = resolveProfile("   ", CATALOG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("careful");
  });

  it("resolves a known profile name to its role→model map", () => {
    const result = resolveProfile("cheap", CATALOG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("cheap");
    expect(result.profile.models).toEqual(CATALOG.profiles.cheap);
  });

  it("fails on an unknown name with a message listing the valid names", () => {
    const result = resolveProfile("banana", CATALOG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("banana");
    expect(result.error).toContain("cheap");
    expect(result.error).toContain("careful");
  });

  it("covers every model-bearing role in each catalog profile", () => {
    for (const profile of Object.values(CATALOG.profiles)) {
      for (const role of MODEL_ROLES) {
        expect(profile[role]).toBeTruthy();
      }
    }
  });
});

describe("resolveProfile — defaults to the shipped repo-profile catalog when none is passed", () => {
  it("uses the on-disk profile's default (mixed) when unset", () => {
    const result = resolveProfile(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("mixed");
  });
});

describe("profileNames", () => {
  it("lists the catalog's profile names", () => {
    expect(profileNames(CATALOG)).toEqual(["cheap", "careful"]);
  });

  it("defaults to the shipped repo-profile catalog names", () => {
    expect(profileNames()).toEqual(["glm", "mixed"]);
  });
});

describe("parseProfileFlag", () => {
  it("reads --profile <name>", () => {
    expect(parseProfileFlag(["--profile", "glm"])).toBe("glm");
  });

  it("reads --profile=<name>", () => {
    expect(parseProfileFlag(["--profile=mixed"])).toBe("mixed");
  });

  it("returns null when no --profile flag is present", () => {
    expect(parseProfileFlag(["--other", "x"])).toBeNull();
  });

  it("returns null when --profile is the last arg with no value", () => {
    expect(parseProfileFlag(["--profile"])).toBeNull();
  });
});
