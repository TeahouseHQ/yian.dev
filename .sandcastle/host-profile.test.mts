import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOST_PROFILE_PATH,
  dockerSandboxOptions,
  generateModelsJson,
  HOST_PROFILE_SCHEMA_VERSION,
  loadHostProfile,
  resolveHostProfile,
  type HostProfile,
} from "./host-profile.mts";

/** Resolve the shared minimal profile once, for the accessor describes below. */
function profile(overrides: Record<string, unknown> = {}): HostProfile {
  const r = resolveHostProfile(rawHostProfile(overrides));
  if (!r.ok) throw new Error(r.error);
  return r.profile;
}

/**
 * Host profile (CONTEXT.md: Host profile; ADR-0014, #109) — the per-MACHINE config
 * (`~/.teahouse/host-profile.json`) holding facts about the box, not any repo: the
 * LiteLLM base URL, the API-key env-var name, and the rootless-Docker flag. These
 * tests pin the fail-loud schema-version gate and the shape validation, mirroring
 * the Repo profile's (#108) fail-loud posture.
 *
 * A minimal well-formed raw host profile, built HERE (not read from the shipped
 * JSON) so the validation assertions have an independent source of truth. Every
 * field is required; the schema version matches the engine's supported version.
 */
function rawHostProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: HOST_PROFILE_SCHEMA_VERSION,
    liteLlmBaseUrl: "http://100.86.127.113:4000/v1",
    apiKeyEnvVar: "LITELLM_API_KEY",
    rootlessDocker: true,
    ...overrides,
  };
}

describe("resolveHostProfile — schema-version gate (ADR-0014 fail-loud)", () => {
  it("accepts a profile whose schemaVersion matches the engine's supported version", () => {
    const result = resolveHostProfile(rawHostProfile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.schemaVersion).toBe(HOST_PROFILE_SCHEMA_VERSION);
  });

  it("aborts on an incompatible schema version with an error naming both versions", () => {
    const incompatible = HOST_PROFILE_SCHEMA_VERSION + 1;
    const result = resolveHostProfile(rawHostProfile({ schemaVersion: incompatible }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(incompatible));
    expect(result.error).toContain(String(HOST_PROFILE_SCHEMA_VERSION));
  });

  it("aborts when schemaVersion is missing entirely", () => {
    const { schemaVersion, ...withoutVersion } = rawHostProfile();
    void schemaVersion;
    const result = resolveHostProfile(withoutVersion);
    expect(result.ok).toBe(false);
  });
});

describe("resolveHostProfile — shape validation", () => {
  it("carries every machine fact once resolved", () => {
    const result = resolveHostProfile(rawHostProfile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p: HostProfile = result.profile;
    expect(p.liteLlmBaseUrl).toBe("http://100.86.127.113:4000/v1");
    expect(p.apiKeyEnvVar).toBe("LITELLM_API_KEY");
    expect(p.rootlessDocker).toBe(true);
  });

  it("rejects a profile missing the LiteLLM base URL", () => {
    const { liteLlmBaseUrl, ...withoutUrl } = rawHostProfile();
    void liteLlmBaseUrl;
    const result = resolveHostProfile(withoutUrl);
    expect(result.ok).toBe(false);
  });

  it("rejects a profile missing the API-key env-var name", () => {
    const { apiKeyEnvVar, ...withoutKey } = rawHostProfile();
    void apiKeyEnvVar;
    expect(resolveHostProfile(withoutKey).ok).toBe(false);
  });

  it("rejects a non-boolean rootless-Docker flag (a truthy string is not a boolean)", () => {
    const result = resolveHostProfile(rawHostProfile({ rootlessDocker: "true" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(resolveHostProfile(null).ok).toBe(false);
    expect(resolveHostProfile("nope").ok).toBe(false);
  });
});

describe("generateModelsJson — the pi provider config produced from the Host profile", () => {
  it("keys the provider `litellm` (matching the `litellm/…` model ids the Repo profile uses)", () => {
    const json = generateModelsJson(profile());
    expect(Object.keys(json.providers)).toEqual(["litellm"]);
    expect(json.providers.litellm.api).toBe("openai-completions");
  });

  it("sources the base URL from the profile — editing it changes the generated config", () => {
    // The acceptance criterion: change the LiteLLM URL in the Host profile and the
    // next dispatch resolves through the new URL, no image rebuild. Prove it flows
    // from the profile, not a baked constant.
    const changed = "http://10.0.0.9:4000/v1";
    expect(generateModelsJson(profile()).providers.litellm.baseUrl).toBe(
      "http://100.86.127.113:4000/v1"
    );
    expect(generateModelsJson(profile({ liteLlmBaseUrl: changed })).providers.litellm.baseUrl).toBe(
      changed
    );
  });

  it("sets apiKey to the env-var NAME (pi resolves the secret from container env), not a secret", () => {
    const json = generateModelsJson(profile({ apiKeyEnvVar: "CUSTOM_KEY" }));
    expect(json.providers.litellm.apiKey).toBe("CUSTOM_KEY");
  });

  it("declares the glm models the Repo profile references, with their known specs", () => {
    // Specs are the independent source of truth: the values carried by the old
    // baked models.json (ADR-0002/0016), ported into the engine constant. glm-5.1
    // stays declared-but-unused (reserved for a future profile; ADR-0016).
    const models = generateModelsJson(profile()).providers.litellm.models;
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));
    expect(Object.keys(byId).sort()).toEqual(["glm-5.1", "glm-5.2"]);
    expect(byId["glm-5.2"].contextWindow).toBe(1000000);
    expect(byId["glm-5.2"].compat.thinkingFormat).toBe("zai");
    expect(byId["glm-5.1"].contextWindow).toBe(200000);
    expect(byId["glm-5.1"].compat.thinkingFormat).toBe("reasoning_effort");
  });
});

describe("dockerSandboxOptions — the rootless flag drives container uid/gid", () => {
  it("runs the container as root (uid/gid 0) under rootless Docker", () => {
    // Rootless: the container's root maps to the host user that owns the
    // bind-mounted worktree, so root is the only user that can write commits into
    // it (ADR-0002). Replaces the hardcoded `containerUid: 0` in main.mts.
    expect(dockerSandboxOptions(profile({ rootlessDocker: true }))).toEqual({
      containerUid: 0,
      containerGid: 0,
    });
  });

  it("omits the uid/gid overrides under rootful Docker (docker() defaults to host uid)", () => {
    expect(dockerSandboxOptions(profile({ rootlessDocker: false }))).toEqual({});
  });
});

describe("loadHostProfile — read + validate the on-disk machine profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "host-profile-test-"));

  function fixture(name: string, contents: string): string {
    const path = join(dir, name);
    writeFileSync(path, contents);
    return path;
  }

  it("defaults to ~/.teahouse/host-profile.json — the machine, not the repo", () => {
    // The profile lives on the box, outside any repo (ADR-0014). Assert the default
    // location independently: under the user's home, in .teahouse/.
    expect(DEFAULT_HOST_PROFILE_PATH).toBe(join(homedir(), ".teahouse", "host-profile.json"));
  });

  it("loads and validates a well-formed profile from an injected path", () => {
    const path = fixture("good.json", JSON.stringify(rawHostProfile()));
    const p: HostProfile = loadHostProfile(path);
    expect(p.liteLlmBaseUrl).toBe("http://100.86.127.113:4000/v1");
    expect(p.rootlessDocker).toBe(true);
  });

  it("throws loudly on a parse error (corrupt JSON)", () => {
    const path = fixture("corrupt.json", "{ not valid json ");
    expect(() => loadHostProfile(path)).toThrow();
  });

  it("throws loudly on a schema-version mismatch", () => {
    const path = fixture(
      "old.json",
      JSON.stringify(rawHostProfile({ schemaVersion: HOST_PROFILE_SCHEMA_VERSION + 1 }))
    );
    expect(() => loadHostProfile(path)).toThrow(String(HOST_PROFILE_SCHEMA_VERSION));
  });

  it("throws loudly when the file is missing entirely (fail-loud at startup)", () => {
    expect(() => loadHostProfile(join(dir, "does-not-exist.json"))).toThrow();
  });

  it("the shipped host-profile.example.json is a valid, loadable template", () => {
    // The committed example must always parse and validate against the current
    // schema so a new machine can copy it verbatim and only edit the URL.
    const example = new URL("./host-profile.example.json", import.meta.url);
    const p = loadHostProfile(example);
    expect(p.schemaVersion).toBe(HOST_PROFILE_SCHEMA_VERSION);
    expect(p.apiKeyEnvVar).toBe("LITELLM_API_KEY");
  });
});
