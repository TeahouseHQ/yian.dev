/**
 * Host profile (CONTEXT.md: Host profile; ADR-0014, #109) — the per-MACHINE config
 * file (`~/.teahouse/host-profile.json`) holding facts about the BOX, not any repo:
 * the LiteLLM base URL, the name of the API-key environment variable, and the
 * rootless-Docker flag. These are the machine-specific bits ADR-0014 pulls out of
 * the repo and the built image — the LiteLLM Tailscale IP that used to be baked into
 * `models.json` into the image, and the `containerUid: 0` rootless workaround that
 * used to be hardcoded in `main.mts`.
 *
 * This is the machine analogue of the Repo profile (`repo-profile.mts`, #108): a
 * runtime-loaded JSON of DATA, plus this ENGINE-side loader that knows the schema
 * version it supports and fails LOUDLY at startup on a mismatch — never silently
 * reinterpreting an old profile. From it the engine (1) generates the pi provider
 * config (`models.json`) and mounts it into each sandbox at RUNTIME rather than
 * baking a machine IP into images, and (2) derives the container uid/gid sandbox
 * options. After the Teahouse extraction this module ships in the engine package;
 * the JSON stays on the machine at `~/.teahouse/`.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The typed Host profile — the three per-machine facts ADR-0014 enumerates, carried
 * once, plus the schema version that gates compatibility.
 */
export interface HostProfile {
  readonly schemaVersion: number;
  /** The LiteLLM proxy base URL the pi provider points at, e.g.
   *  `http://100.86.127.113:4000/v1` (this machine's Tailscale IP; ADR-0002). The
   *  fact that used to be baked into `models.json` into the image. */
  readonly liteLlmBaseUrl: string;
  /** The NAME of the env var pi resolves the LiteLLM api key from at request time
   *  (e.g. `LITELLM_API_KEY`) — a name, never the secret itself. */
  readonly apiKeyEnvVar: string;
  /** Whether this machine runs rootless Docker. Drives the container uid/gid sandbox
   *  options (rootless → run as root so the bind-mounted worktree is writable;
   *  ADR-0002), replacing the hardcoded `containerUid: 0`. */
  readonly rootlessDocker: boolean;
}

/** The engine's supported host-profile schema version. A loaded profile declaring
 *  any OTHER version is a loud startup failure (ADR-0014) — never reinterpreted.
 *  Bump this in lockstep with a breaking change to {@link HostProfile}. */
export const HOST_PROFILE_SCHEMA_VERSION = 1;

/** The outcome of validating a raw host profile: the typed profile, or a loud error
 *  string the caller prints before a non-zero exit (the ADR-0014 fail-loud posture,
 *  mirroring `resolveRepoProfile`). */
export type HostProfileResolution =
  | { readonly ok: true; readonly profile: HostProfile }
  | { readonly ok: false; readonly error: string };

/** Default location of the machine profile: `~/.teahouse/host-profile.json`. It
 *  lives on the BOX, outside any repo (ADR-0014) — so a repo checkout never carries
 *  machine facts and the same profile serves every repo orchestrated from this box. */
export const DEFAULT_HOST_PROFILE_PATH = join(homedir(), ".teahouse", "host-profile.json");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a raw (parsed-JSON) host profile against the engine's schema (ADR-0014).
 * Pure + value-injected so it is unit-testable without touching the filesystem.
 *
 * The schema-version gate is checked FIRST and hardest: a profile whose
 * `schemaVersion` is absent or does not equal {@link HOST_PROFILE_SCHEMA_VERSION}
 * fails loudly with a message naming both versions — an old profile is never
 * silently reinterpreted.
 */
export function resolveHostProfile(raw: unknown): HostProfileResolution {
  if (!isObject(raw)) {
    return { ok: false, error: "Host profile must be a JSON object." };
  }

  if (raw.schemaVersion !== HOST_PROFILE_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `Host profile schemaVersion ${JSON.stringify(raw.schemaVersion)} is incompatible ` +
        `with this engine (supports ${HOST_PROFILE_SCHEMA_VERSION}). ` +
        `Update the engine or the profile — the profile is never reinterpreted.`,
    };
  }

  const errors: string[] = [];
  if (typeof raw.liteLlmBaseUrl !== "string") errors.push("liteLlmBaseUrl (string)");
  if (typeof raw.apiKeyEnvVar !== "string") errors.push("apiKeyEnvVar (string)");
  if (typeof raw.rootlessDocker !== "boolean") errors.push("rootlessDocker (boolean)");

  if (errors.length > 0) {
    return {
      ok: false,
      error: `Host profile is missing or malformed fields: ${errors.join("; ")}.`,
    };
  }

  // Every field validated above — the cast is sound.
  return { ok: true, profile: raw as unknown as HostProfile };
}

/**
 * Read, parse, and validate the on-disk Host profile (default
 * {@link DEFAULT_HOST_PROFILE_PATH}). A parse error, a missing file, or a schema
 * mismatch throws with the loud message — callers at startup let it abort the
 * process (ADR-0014). `path` is injectable for tests.
 */
export function loadHostProfile(path: URL | string = DEFAULT_HOST_PROFILE_PATH): HostProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to read/parse Host profile at ${String(path)}: ${(err as Error).message}. ` +
        `Create it (see .sandcastle/host-profile.example.json) — it holds this ` +
        `machine's LiteLLM URL, api-key env-var name, and rootless-Docker flag.`
    );
  }
  const resolution = resolveHostProfile(raw);
  if (!resolution.ok) throw new Error(resolution.error);
  return resolution.profile;
}

/**
 * A pi model definition — the spec for one model the LiteLLM provider serves. These
 * describe the MODELS (context window, thinking format, cost), not the machine, so
 * they are an engine constant rather than a Host-profile field: the same glm-5.2
 * spec holds regardless of which box's proxy serves it, and the Repo profile already
 * references these ids (`litellm/glm-5.2`; ADR-0016). Only the base URL and api-key
 * env-var NAME vary per machine — those come from the Host profile.
 */
export interface ModelDefinition {
  readonly id: string;
  readonly reasoning: boolean;
  readonly compat: { readonly thinkingFormat: string };
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
}

/**
 * The LiteLLM models this engine knows how to drive. Specs ported verbatim from the
 * old baked `models.json` (ADR-0002/0016): glm-5.2 (the workhorse, 1M context, `zai`
 * thinking) and glm-5.1 (declared-but-unused, reserved for a future profile). Cost is
 * zero — the proxy is unmetered on the trusted Tailscale network (ADR-0002).
 */
const LITELLM_MODELS: readonly ModelDefinition[] = [
  {
    id: "glm-5.1",
    reasoning: true,
    compat: { thinkingFormat: "reasoning_effort" },
    contextWindow: 200000,
    maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "glm-5.2",
    reasoning: true,
    compat: { thinkingFormat: "zai" },
    contextWindow: 1000000,
    maxTokens: 65536,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

/** The pi provider config (`models.json`) shape: a single `litellm` provider. */
export interface ModelsJson {
  readonly providers: {
    readonly litellm: {
      readonly baseUrl: string;
      readonly api: "openai-completions";
      readonly apiKey: string;
      readonly models: readonly ModelDefinition[];
    };
  };
}

/**
 * Generate the pi provider config (`models.json`) from the Host profile (ADR-0014,
 * #109). The two per-machine facts — `liteLlmBaseUrl` and the api-key env-var NAME —
 * are injected into the static provider template (provider key `litellm`, the
 * `openai-completions` api, the engine's {@link LITELLM_MODELS}). The caller writes
 * this to a host file and bind-mounts it into each sandbox at RUNTIME, so a machine's
 * LiteLLM URL never gets baked into an image — editing it takes effect on the next
 * dispatch with no rebuild. `apiKey` is the env-var NAME; pi resolves the secret from
 * the container env at request time (ADR-0002).
 */
/** The `docker()` uid/gid options a sandbox factory spreads in, derived from the
 *  Host profile's rootless flag (ADR-0002/0014). Under rootless Docker the container
 *  must run as root (uid/gid 0) so the bind-mounted worktree is writable — the
 *  image's USER must match or sandcastle's `checkImageUid` guard rejects it. Under
 *  rootful Docker no override is needed: `docker()` defaults `--user` to the host
 *  uid. Replaces the hardcoded `containerUid: 0` in `main.mts`/`shell.mts`. */
export function dockerSandboxOptions(
  profile: HostProfile
): { containerUid: number; containerGid: number } | Record<string, never> {
  return profile.rootlessDocker ? { containerUid: 0, containerGid: 0 } : {};
}

export function generateModelsJson(profile: HostProfile): ModelsJson {
  return {
    providers: {
      litellm: {
        baseUrl: profile.liteLlmBaseUrl,
        api: "openai-completions",
        apiKey: profile.apiKeyEnvVar,
        models: LITELLM_MODELS,
      },
    },
  };
}
