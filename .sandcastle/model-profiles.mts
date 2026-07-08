/**
 * Model profiles — named presets of the role→model map (CONTEXT.md: Model
 * profile; ADR-0016). Replaces the hardcoded `MODELS` const that used to live in
 * `main.mts`: the four model-bearing roles (Planner, Implementer, Reviewer,
 * Conflict resolver — the agent-free Landing has none) resolve their model
 * through the active profile instead of a scattered literal.
 *
 * Kept as a typed const (mirroring how `POOL_SIZE`/`ORCHESTRATOR_SPAWN` are typed
 * consts, not JSON) so both `main.mts` and — later — the Cockpit import ONE source
 * of truth and every role is covered at compile time. This is the concrete shape
 * the Repo profile's "per-role models" field will deserialize into after the
 * Teahouse extraction (ADR-0014/0016). `glm-5.1` stays declared in `models.json`
 * but is referenced by no profile — reserved for a future one.
 */

/** The four model-bearing roles. The agent-free Landing (ADR-0012) is NOT here —
 *  it runs no agent and spends zero tokens, so it has no model. The single role
 *  vocabulary every profile key and the `profile-selected` renderer speak. */
export const MODEL_ROLES = ["planner", "implementer", "reviewer", "resolver"] as const;

/** One model-bearing role. */
export type ModelRole = (typeof MODEL_ROLES)[number];

/** A fully-covered role→model map: every role resolves to a model id. */
export type RoleModels = Record<ModelRole, string>;

/**
 * The shipped Model profiles (ADR-0016). Two to start:
 * - `glm` — all four roles on the cheap `litellm/glm-5.2`.
 * - `mixed` — the default: Implementer on `litellm/glm-5.2`, the other three
 *   (Planner, Reviewer, Conflict resolver — the careful, high-stakes roles) on
 *   `claude-opus-4-8`.
 *
 * `satisfies` pins every profile to a complete `RoleModels` (a missing role is a
 * compile error) while keeping the literal key type for {@link ProfileName}.
 */
export const MODEL_PROFILES = {
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
} satisfies Record<string, RoleModels>;

/** A valid profile name — a key of {@link MODEL_PROFILES}. */
export type ProfileName = keyof typeof MODEL_PROFILES;

/** The documented default, used when `SANDCASTLE_PROFILE` is unset (ADR-0016). */
export const DEFAULT_PROFILE: ProfileName = "mixed";

/** The active Model profile: its name plus the resolved role→model map. */
export interface ModelProfile {
  readonly name: ProfileName;
  readonly models: RoleModels;
}

/** The outcome of resolving a profile name: the profile, or a loud error string
 *  the shell prints before a non-zero exit (ADR-0016). */
export type ProfileResolution =
  | { readonly ok: true; readonly profile: ModelProfile }
  | { readonly ok: false; readonly error: string };

/** Every valid profile name, for the "unknown name" error message and future
 *  Cockpit picker. */
export function profileNames(): ProfileName[] {
  return Object.keys(MODEL_PROFILES) as ProfileName[];
}

/**
 * Resolve the active Model profile from the `SANDCASTLE_PROFILE` env value
 * (ADR-0016). Unset (or empty/whitespace, which is effectively unset) falls back
 * silently to the documented default {@link DEFAULT_PROFILE}. An unknown name is
 * NOT a silent fall-through to the default — it returns `ok: false` with a message
 * listing the valid names, so a typo cannot quietly run the wrong (expensive)
 * models. Pure + value-injected so the selection is unit-testable without env.
 */
export function resolveProfile(value: string | undefined): ProfileResolution {
  const name = value?.trim();
  if (!name) return { ok: true, profile: profile(DEFAULT_PROFILE) };
  if (!isProfileName(name)) {
    return {
      ok: false,
      error: `Unknown SANDCASTLE_PROFILE "${name}". Valid profiles: ${profileNames().join(", ")}.`,
    };
  }
  return { ok: true, profile: profile(name) };
}

/** Build the {@link ModelProfile} for a known name. */
function profile(name: ProfileName): ModelProfile {
  return { name, models: MODEL_PROFILES[name] };
}

/** Narrowing guard: is `name` a declared profile? */
function isProfileName(name: string): name is ProfileName {
  return Object.prototype.hasOwnProperty.call(MODEL_PROFILES, name);
}

/**
 * Pull the `--profile <name>` value out of a wrapper's argv (the human-facing
 * surface, ADR-0016). Supports both `--profile glm` and `--profile=glm`. Returns
 * `null` when the flag is absent or has no value — the wrapper then leaves
 * `SANDCASTLE_PROFILE` untouched so an unset flag defaults to `mixed` (and any
 * externally-exported env value still flows through). Validation of the NAME is
 * `main.mts`'s job via {@link resolveProfile}, not the wrapper's — the wrapper
 * only transports.
 */
export function parseProfileFlag(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") {
      const value = argv[i + 1];
      return value && !value.startsWith("-") ? value : null;
    }
    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);
      return value || null;
    }
  }
  return null;
}
