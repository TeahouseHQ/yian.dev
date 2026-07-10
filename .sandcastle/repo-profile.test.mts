import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  forkBase,
  issueBranch,
  loadRepoProfile,
  mergeBranch,
  REPO_PROFILE_SCHEMA_VERSION,
  resolveRepoProfile,
  verifyCommand,
  type RepoProfile,
} from "./repo-profile.mts";

/**
 * Repo profile (ADR-0014, #108) — the single typed, schema-versioned config file
 * that is yian.dev's entire behavioural surface toward the orchestration engine.
 * These tests pin the fail-loud schema-version gate, the shape validation, and the
 * derived accessors the engine reads instead of hardcoded repo-fact literals.
 *
 * A minimal well-formed raw profile, built here (NOT read from the shipped JSON)
 * so the validation assertions have an independent source of truth. Every field is
 * required; the schema version matches the engine's supported version.
 */
function rawProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: REPO_PROFILE_SCHEMA_VERSION,
    installBuild: "pnpm install --frozen-lockfile && pnpm build",
    verify: { typecheck: "pnpm typecheck", test: "pnpm test" },
    baseBranch: "main",
    branchPrefix: "teahouse/",
    poolSize: 4,
    codingStandardsPath: "@.sandcastle/CODING_STANDARDS.md",
    models: {
      profiles: {
        glm: {
          planner: "litellm/glm-5.2",
          implementer: "litellm/glm-5.2",
          reviewer: "litellm/glm-5.2",
          resolver: "litellm/glm-5.2",
        },
        mixed: {
          planner: "claude-opus-4-8",
          implementer: "litellm/glm-5.2",
          reviewer: "claude-opus-4-8",
          resolver: "claude-opus-4-8",
        },
      },
      default: "mixed",
    },
    ...overrides,
  };
}

describe("resolveRepoProfile — schema-version gate (ADR-0014 fail-loud)", () => {
  it("accepts a profile whose schemaVersion matches the engine's supported version", () => {
    const result = resolveRepoProfile(rawProfile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.schemaVersion).toBe(REPO_PROFILE_SCHEMA_VERSION);
  });

  it("aborts on an incompatible schema version with an error naming both versions", () => {
    const incompatible = REPO_PROFILE_SCHEMA_VERSION + 1;
    const result = resolveRepoProfile(rawProfile({ schemaVersion: incompatible }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(incompatible));
    expect(result.error).toContain(String(REPO_PROFILE_SCHEMA_VERSION));
  });

  it("aborts when schemaVersion is missing entirely", () => {
    const { schemaVersion, ...withoutVersion } = rawProfile();
    void schemaVersion;
    const result = resolveRepoProfile(withoutVersion);
    expect(result.ok).toBe(false);
  });
});

describe("resolveRepoProfile — shape validation", () => {
  it("carries every repo fact once resolved", () => {
    const result = resolveRepoProfile(rawProfile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p: RepoProfile = result.profile;
    expect(p.installBuild).toBe("pnpm install --frozen-lockfile && pnpm build");
    expect(p.verify).toEqual({ typecheck: "pnpm typecheck", test: "pnpm test" });
    expect(p.baseBranch).toBe("main");
    expect(p.branchPrefix).toBe("teahouse/");
    expect(p.poolSize).toBe(4);
    expect(p.codingStandardsPath).toBe("@.sandcastle/CODING_STANDARDS.md");
    expect(p.models.default).toBe("mixed");
    expect(Object.keys(p.models.profiles)).toEqual(["glm", "mixed"]);
  });

  it("rejects a profile missing a required repo fact", () => {
    const { poolSize, ...withoutPool } = rawProfile();
    void poolSize;
    const result = resolveRepoProfile(withoutPool);
    expect(result.ok).toBe(false);
  });

  it("rejects a models catalog whose default is not one of its profiles", () => {
    const raw = rawProfile();
    (raw.models as { default: string }).default = "banana";
    const result = resolveRepoProfile(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("banana");
  });

  it("rejects a non-object input", () => {
    expect(resolveRepoProfile(null).ok).toBe(false);
    expect(resolveRepoProfile("nope").ok).toBe(false);
  });
});

describe("derived accessors — the engine reads these, not literals", () => {
  const profile = (() => {
    const r = resolveRepoProfile(rawProfile());
    if (!r.ok) throw new Error(r.error);
    return r.profile;
  })();

  it("verifyCommand joins typecheck and test into one shell command", () => {
    expect(verifyCommand(profile)).toBe("pnpm typecheck && pnpm test");
  });

  it("forkBase prefixes the base branch with origin/ (never local HEAD)", () => {
    expect(forkBase(profile)).toBe("origin/main");
  });

  it("issueBranch and mergeBranch apply the profile's branch prefix", () => {
    expect(issueBranch(profile, 42)).toBe("teahouse/issue-42");
    expect(mergeBranch(profile, 42)).toBe("teahouse/merge-42");
  });
});

describe("loadRepoProfile — the shipped yian.dev profile", () => {
  it("loads and validates the on-disk repo-profile.json", () => {
    const profile = loadRepoProfile();
    expect(profile.schemaVersion).toBe(REPO_PROFILE_SCHEMA_VERSION);
    expect(profile.branchPrefix).toBe("teahouse/");
  });

  it("defaults the pool size small (3–4) per ADR-0014", () => {
    const profile = loadRepoProfile();
    expect(profile.poolSize).toBeGreaterThanOrEqual(3);
    expect(profile.poolSize).toBeLessThanOrEqual(4);
  });

  it("the shipped JSON declares no model id the catalog does not use (ids live only here)", () => {
    // The profile JSON is the ONE place repo-fact literals (pnpm, model ids) are
    // allowed. Assert the loaded catalog is the source, independent of engine code.
    const profile = loadRepoProfile();
    const ids = Object.values(profile.models.profiles).flatMap((m) => Object.values(m));
    expect(ids).toContain("claude-opus-4-8");
    expect(ids).toContain("litellm/glm-5.2");
  });

  it("the raw JSON file parses (no trailing-comma / comment corruption)", () => {
    const path = new URL("./repo-profile.json", import.meta.url);
    expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
  });
});
