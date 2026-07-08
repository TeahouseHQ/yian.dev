import { describe, expect, it } from "vitest";

import {
  MODEL_PROFILES,
  MODEL_ROLES,
  parseProfileFlag,
  resolveProfile,
} from "./model-profiles.mts";

// The expected role→model maps are written as known-good literals (the source of
// truth is ADR-0016 / the issue), NOT derived from MODEL_PROFILES itself — so the
// assertion can actually disagree with the const.

describe("MODEL_PROFILES", () => {
  it("runs all four roles on glm-5.2 for the glm profile", () => {
    expect(MODEL_PROFILES.glm).toEqual({
      planner: "litellm/glm-5.2",
      implementer: "litellm/glm-5.2",
      reviewer: "litellm/glm-5.2",
      resolver: "litellm/glm-5.2",
    });
  });

  it("runs only the Implementer on glm-5.2 for the mixed profile, the rest on Opus 4.8", () => {
    expect(MODEL_PROFILES.mixed).toEqual({
      planner: "claude-opus-4-8",
      implementer: "litellm/glm-5.2",
      reviewer: "claude-opus-4-8",
      resolver: "claude-opus-4-8",
    });
  });

  it("covers every model-bearing role in each profile", () => {
    for (const profile of Object.values(MODEL_PROFILES)) {
      for (const role of MODEL_ROLES) {
        expect(profile[role]).toBeTruthy();
      }
    }
  });
});

describe("resolveProfile", () => {
  it("defaults to mixed silently when the value is unset", () => {
    const result = resolveProfile(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("mixed");
    expect(result.profile.models).toEqual(MODEL_PROFILES.mixed);
  });

  it("treats an empty/whitespace value as unset (defaults to mixed)", () => {
    const result = resolveProfile("   ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("mixed");
  });

  it("resolves a known profile name to its role→model map", () => {
    const result = resolveProfile("glm");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("glm");
    expect(result.profile.models).toEqual(MODEL_PROFILES.glm);
  });

  it("fails on an unknown name with a message listing the valid names", () => {
    const result = resolveProfile("banana");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("banana");
    expect(result.error).toContain("glm");
    expect(result.error).toContain("mixed");
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
