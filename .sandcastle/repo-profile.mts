/**
 * Repo profile (CONTEXT.md: Repo profile; ADR-0014, #108) — the single typed,
 * schema-versioned config file that is this repo's ENTIRE behavioural surface
 * toward the orchestration engine. Every repo fact the engine used to hardcode —
 * the install/build hook, the verify commands, the base branch, the branch prefix,
 * the pool size, the per-role model catalog, and the coding-standards path — is
 * read from here instead. Editing `repo-profile.json` changes what the orchestrator
 * actually does on the next dispatch, with no engine file touched.
 *
 * This is the pre-extraction in-repo slice of ADR-0014: the profile DATA lives in a
 * runtime-loaded `repo-profile.json` (the consumer-owned config), while this module
 * is the ENGINE-side loader — it knows the schema version it supports and fails
 * loudly at startup on a mismatch, never silently reinterpreting an old profile.
 * After the Teahouse extraction this module ships in the engine package and the
 * JSON stays with the consumer repo; the boundary is already drawn here.
 */
import { readFileSync } from "node:fs";

/**
 * The four model-bearing roles (Planner, Implementer, Reviewer, Conflict resolver —
 * the agent-free Landing has none; ADR-0012/0016). The single role vocabulary every
 * model catalog is keyed by. Lives here, the foundational config layer, and is
 * re-exported by `model-profiles.mts` so `events.mts` and the resolver keep their
 * imports. Kept independent of the profile so role coverage is a compile-time fact.
 */
export const MODEL_ROLES = ["planner", "implementer", "reviewer", "resolver"] as const;

/** One model-bearing role. */
export type ModelRole = (typeof MODEL_ROLES)[number];

/** A fully-covered role→model map: every role resolves to a model id. */
export type RoleModels = Record<ModelRole, string>;

/**
 * The per-role model catalog the Repo profile owns (ADR-0014/0016): the named
 * {@link RoleModels} presets plus which one is the default. The runtime picks the
 * ACTIVE preset from `SANDCASTLE_PROFILE`; the profile owns the catalog + default.
 */
export interface ModelCatalog {
  readonly profiles: Record<string, RoleModels>;
  readonly default: string;
}

/** The typecheck + test commands the engine injects into prompts and runs in the
 *  Landing — the repo's definition of "green". */
export interface VerifyCommands {
  readonly typecheck: string;
  readonly test: string;
}

/**
 * The typed Repo profile — every repo fact, carried once. Mirrors the ADR-0014
 * field list: install/build hook, verify commands, base branch, per-role models,
 * pool size, branch prefix, coding-standards path, and the schema version that
 * gates compatibility.
 */
export interface RepoProfile {
  readonly schemaVersion: number;
  readonly installBuild: string;
  readonly verify: VerifyCommands;
  readonly baseBranch: string;
  readonly branchPrefix: string;
  readonly poolSize: number;
  readonly codingStandardsPath: string;
  readonly models: ModelCatalog;
}

/** The engine's supported profile schema version. A loaded profile declaring any
 *  OTHER version is a loud startup failure (ADR-0014) — never reinterpreted. Bump
 *  this in lockstep with a breaking change to {@link RepoProfile}. */
export const REPO_PROFILE_SCHEMA_VERSION = 1;

/** The outcome of validating a raw profile: the typed profile, or a loud error
 *  string the caller prints before a non-zero exit (the ADR-0014 fail-loud posture,
 *  mirroring `resolveProfile` in model-profiles.mts). */
export type RepoProfileResolution =
  | { readonly ok: true; readonly profile: RepoProfile }
  | { readonly ok: false; readonly error: string };

/** Default location of the shipped profile — resolved off this module's URL so the
 *  loader works regardless of the process's cwd. */
const DEFAULT_PROFILE_PATH = new URL("./repo-profile.json", import.meta.url);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRoleModels(value: unknown): value is RoleModels {
  return isObject(value) && MODEL_ROLES.every((role) => typeof value[role] === "string");
}

/**
 * Validate a raw (parsed-JSON) profile against the engine's schema (ADR-0014).
 * Pure + value-injected so it is unit-testable without touching the filesystem.
 *
 * The schema-version gate is checked FIRST and hardest: a profile whose
 * `schemaVersion` is absent or does not equal {@link REPO_PROFILE_SCHEMA_VERSION}
 * fails loudly with a message naming both versions — an old profile is never
 * silently reinterpreted. Then every required repo fact is shape-checked, and the
 * model catalog's `default` must name one of its own profiles.
 */
export function resolveRepoProfile(raw: unknown): RepoProfileResolution {
  if (!isObject(raw)) {
    return { ok: false, error: "Repo profile must be a JSON object." };
  }

  if (raw.schemaVersion !== REPO_PROFILE_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `Repo profile schemaVersion ${JSON.stringify(raw.schemaVersion)} is incompatible ` +
        `with this engine (supports ${REPO_PROFILE_SCHEMA_VERSION}). ` +
        `Update the engine or the profile — the profile is never reinterpreted.`,
    };
  }

  const errors: string[] = [];
  if (typeof raw.installBuild !== "string") errors.push("installBuild (string)");
  if (
    !isObject(raw.verify) ||
    typeof raw.verify.typecheck !== "string" ||
    typeof raw.verify.test !== "string"
  ) {
    errors.push("verify.{typecheck,test} (strings)");
  }
  if (typeof raw.baseBranch !== "string") errors.push("baseBranch (string)");
  if (typeof raw.branchPrefix !== "string") errors.push("branchPrefix (string)");
  if (typeof raw.poolSize !== "number") errors.push("poolSize (number)");
  if (typeof raw.codingStandardsPath !== "string") errors.push("codingStandardsPath (string)");

  const models = raw.models;
  if (!isObject(models)) {
    errors.push("models (object with profiles + default)");
  } else {
    const profiles = models.profiles;
    const dflt = models.default;
    if (!isObject(profiles)) {
      errors.push("models.profiles (object)");
    } else if (typeof dflt !== "string") {
      errors.push("models.default (string)");
    } else {
      const names = Object.keys(profiles);
      if (!names.every((name) => isRoleModels(profiles[name]))) {
        errors.push("models.profiles.* (every role→model map must cover all four roles)");
      }
      if (!names.includes(dflt)) {
        errors.push(
          `models.default "${dflt}" is not one of the declared profiles [${names.join(", ")}]`
        );
      }
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: `Repo profile is missing or malformed fields: ${errors.join("; ")}.`,
    };
  }

  // Every field validated above — the cast is sound.
  return { ok: true, profile: raw as unknown as RepoProfile };
}

/**
 * Read, parse, and validate the on-disk Repo profile (default `repo-profile.json`).
 * A parse error or a schema mismatch throws with the loud message — callers at
 * startup let it abort the process (ADR-0014). `path` is injectable for tests.
 */
export function loadRepoProfile(path: URL | string = DEFAULT_PROFILE_PATH): RepoProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to read/parse Repo profile at ${String(path)}: ${(err as Error).message}`
    );
  }
  const resolution = resolveRepoProfile(raw);
  if (!resolution.ok) throw new Error(resolution.error);
  return resolution.profile;
}

/** The repo's definition of "green" as one shell command — `typecheck && test`.
 *  Injected into prompts and run by the Landing, replacing the hardcoded
 *  `pnpm typecheck && pnpm test` literal. */
export function verifyCommand(profile: RepoProfile): string {
  return `${profile.verify.typecheck} && ${profile.verify.test}`;
}

/** The fork base — the remote-tracking ref sandboxes fork from (ADR-0013): never
 *  local `HEAD`/`main`, always `origin/<baseBranch>`. */
export function forkBase(profile: RepoProfile): string {
  return `origin/${profile.baseBranch}`;
}

/** The deterministic Implementer branch for an issue, `<prefix>issue-<n>`. */
export function issueBranch(profile: RepoProfile, issue: number): string {
  return `${profile.branchPrefix}issue-${issue}`;
}

/** The throwaway Landing worktree branch for an issue, `<prefix>merge-<n>`. */
export function mergeBranch(profile: RepoProfile, issue: number): string {
  return `${profile.branchPrefix}merge-${issue}`;
}
