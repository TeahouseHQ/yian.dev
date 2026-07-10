/**
 * Model profiles — the RESOLUTION logic that picks one active role→model preset
 * from a catalog (CONTEXT.md: Model profile; ADR-0016). The catalog DATA — the
 * named presets and the default — no longer lives here as a hardcoded const: per
 * ADR-0014 (#108) the per-role models are a field of the **Repo profile**
 * (`repo-profile.json`), the one place model-id literals are allowed. This module
 * owns only the selection: given a catalog and the `SANDCASTLE_PROFILE` value, it
 * resolves the active preset (or fails loudly on an unknown name).
 *
 * The role vocabulary ({@link MODEL_ROLES}, {@link RoleModels}) is re-exported from
 * `repo-profile.mts` so `events.mts` and callers keep a single import surface.
 */
import {
  loadRepoProfile,
  MODEL_ROLES,
  type ModelCatalog,
  type ModelRole,
  type RoleModels,
} from "./repo-profile.mts";

export { MODEL_ROLES };
export type { ModelRole, RoleModels, ModelCatalog };

/** A profile name — now a plain string, validated at runtime against a catalog's
 *  keys (the names are data in `repo-profile.json`, not a compile-time union). */
export type ProfileName = string;

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

/** The shipped catalog, loaded once from the Repo profile. Used as the default for
 *  the resolution helpers so `main.mts` and the Cockpit need not thread it through
 *  every call; a caller may still pass an explicit catalog (tests, alternate repo). */
const SHIPPED_CATALOG: ModelCatalog = loadRepoProfile().models;

/** Every valid profile name in a catalog, for the "unknown name" error message and
 *  the Cockpit picker. Defaults to the shipped catalog. */
export function profileNames(catalog: ModelCatalog = SHIPPED_CATALOG): ProfileName[] {
  return Object.keys(catalog.profiles);
}

/**
 * Resolve the active Model profile from the `SANDCASTLE_PROFILE` env value against
 * a catalog (ADR-0016). Unset (or empty/whitespace, effectively unset) falls back
 * silently to the catalog's declared default. An unknown name is NOT a silent
 * fall-through — it returns `ok: false` with a message listing the valid names, so
 * a typo cannot quietly run the wrong (expensive) models. Pure + value-injected so
 * the selection is unit-testable without env or filesystem; defaults to the shipped
 * catalog for production callers.
 */
export function resolveProfile(
  value: string | undefined,
  catalog: ModelCatalog = SHIPPED_CATALOG
): ProfileResolution {
  const name = value?.trim();
  if (!name) return { ok: true, profile: profile(catalog, catalog.default) };
  if (!hasProfile(catalog, name)) {
    return {
      ok: false,
      error: `Unknown SANDCASTLE_PROFILE "${name}". Valid profiles: ${profileNames(catalog).join(", ")}.`,
    };
  }
  return { ok: true, profile: profile(catalog, name) };
}

/** Build the {@link ModelProfile} for a known name in a catalog. */
function profile(catalog: ModelCatalog, name: ProfileName): ModelProfile {
  return { name, models: catalog.profiles[name] };
}

/** Narrowing guard: is `name` a declared profile in this catalog? */
function hasProfile(catalog: ModelCatalog, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(catalog.profiles, name);
}

/**
 * Pull the `--profile <name>` value out of a wrapper's argv (the human-facing
 * surface, ADR-0016). Supports both `--profile glm` and `--profile=glm`. Returns
 * `null` when the flag is absent or has no value — the wrapper then leaves
 * `SANDCASTLE_PROFILE` untouched so an unset flag defaults to the catalog default
 * (and any externally-exported env value still flows through). Validation of the
 * NAME is `main.mts`'s job via {@link resolveProfile}, not the wrapper's — the
 * wrapper only transports.
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
