# Model profiles: named role→model presets, selected by env, switched in the Cockpit

The four model-bearing roles (Planner, Implementer, Reviewer, Conflict
resolver — the agent-free Landing has none) previously read their models
from a single hardcoded `MODELS` const in `main.mts`. This ADR replaces
that with a **Model profile**: a named preset of the role→model map,
chosen at startup and switchable live in the Cockpit. Two ship to start:
`glm` (all four roles on `litellm/glm-5.2`) and `mixed` (the default:
Implementer on `litellm/glm-5.2`, the other three on `claude-opus-4-8`).
`glm-5.1` stays declared in `models.json` but unused — reserved for a
future profile.

A Model profile is the concrete shape the Repo profile's "per-role
models" field (ADR-0014) will deserialize into after extraction; the
Repo profile owns the _catalog_ of profiles + the default, the runtime
picks the _active_ one. Defined as a typed `model-profiles.mts` const
(matching how `MODELS`/`POOL_SIZE`/`ORCHESTRATOR_SPAWN` are already
typed consts, not JSON), so both `main.mts` and the Cockpit import one
source of truth and every role is covered at compile time.

## Selection surface: `--profile` flag, `SANDCASTLE_PROFILE` transport

The human types `--profile <name>` on `pnpm sandcastle` /
`pnpm sandcastle:cockpit`; each wrapper translates it into a
`SANDCASTLE_PROFILE` env var on the orchestrator child. `main.mts` only
ever reads the env var — never argv.

Env, not a flag threaded through argv, because the orchestrator is
respawned by two supervisors (`run.mts` headless, `cockpit.tsx`
supervised) on **self-restart** (ADR-0013), a respawn the user did not
trigger. Env is inherited by the child for free, so the active profile
survives a drain-restart with zero new wiring — `run.mts` already
inherits parent env, and the Cockpit already spreads `...process.env`
into its spawn. This mirrors the existing `SANDCASTLE_EVENT_FORMAT` env
knob exactly. A flag would force both supervisors to capture and re-pass
the profile on every respawn.

## Validation: loud on unknown, silent default when unset

Owned by `main.mts`, before the loop starts. Unset → silent fallback to
`mixed` (the documented default). Unknown (`--profile banana`) → **loud
non-zero exit** printing the valid names, never a silent fall-through to
a default — a typo must not quietly run the wrong (expensive) models.
This is the ADR-0014 fail-loud-at-startup posture applied to profiles.
The Cockpit can only ever emit names from its own picker, so an invalid
value is reachable only from a hand-typed flag.

## Cockpit switching: `selected` vs `running`, apply on Start

The Cockpit holds two pieces of state: **`running`** (what the live
child was spawned with) and **`selected`** (what the next _manual_ Start
will use). `p` cycles `selected` on the Live tab. A switch changes only
`selected`; it takes effect on the next Stop→Start (both single
keystrokes). The header shows `running: X`, and `selected: Y (Start to
apply)` only when the two differ.

Crucially, an **automatic** self-restart (code upgrade, ADR-0013)
respawns with **`running`, never `selected`** — a code-freshness restart
must not smuggle in a model switch the user selected but never Started.
This keeps the headless and supervised restart paths identical (the
ADR-0013 invariant): both preserve the profile the draining child had.

### Rejected switch designs

- **Drain-on-demand switch** (selecting a new profile drains the live
  child and respawns it): elegant, but invents a _parent→child_ drain
  trigger that doesn't exist — today's drain is self-detected inside the
  child from an upstream code change. A new signalling mechanism for a
  marginal gain over "Stop then Start."
- **Hard kill switch** (Stop + immediate Start on the new profile):
  abandons in-flight Sessions mid-flight — wasted tokens and orphaned
  draft PRs the next tick re-picks up under at-least-once dispatch.

## Observability

- A `profile-selected` event (name + resolved role→model map) is emitted
  once at startup, feeding both the headless prose renderer and the
  Cockpit — one source for both surfaces.
- The Cockpit header surfaces `running`/`selected` as above.
- The Manifest entry gains a per-Session **resolved model** field: the
  durable audit trail records what each issue's Session actually ran on,
  making cost/quality attribution a `runId` lookup. The profile name is
  reconstructable; the model is the fact that matters.
