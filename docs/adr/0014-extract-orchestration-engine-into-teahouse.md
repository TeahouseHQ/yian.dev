# Extract the orchestration harness into Teahouse, an npm package consumed per-repo

The `.sandcastle/` setup is, by inventory, ~95% generic engine and ~5%
configuration smeared into the engine's files. The generic bulk: the
orchestrator loop (`main.mts`), all of `dispatch.mts` (Pool, In-flight set,
Dispatch buckets, Plan cache), `events.mts`, `observability.mts`
(Manifest, Transcripts), the Cockpit, Session browser, Prune,
`render-transcript`, and most of the four prompts — plus the label and
branch conventions, which are already repo-agnostic (`gh` infers the repo
from cwd; prompts bootstrap labels with `gh label create … || true`). The
repo-specific residue is a handful of strings: the install/build hook
(`pnpm install --frozen-lockfile && pnpm build`, three call sites), the
verify commands (`pnpm typecheck && pnpm test`, baked into three prompts),
the pnpm/node pins in the Dockerfile, the base branch, per-role model
choices, and `CODING_STANDARDS.md`. A third tier is **machine**-specific
state mis-filed as repo files: the LiteLLM Tailscale IP baked into
`models.json` baked into the image, the rootless-Docker
`containerUid: 0` workaround, and `LITELLM_API_KEY`.

This ADR extracts the engine into **Teahouse** — its own repo under
TeahouseHQ, published as an npm package — and defines the two config
surfaces (a per-repo **Repo profile**, a per-machine **Host profile**)
that replace the smearing. After extraction, "sandcastle" reverts to
meaning only the `@ai-hero/sandcastle` sandbox library underneath.

## Scope: personal repos, one machine

The driving scenario is 2–5 personal repos orchestrated from one box with
the same LiteLLM/Tailscale setup — not a shareable product. This bounds
the design: no multi-tenancy, no public-packaging polish, and the Host
profile can assume a single machine until that stops being true.

## Topology: one orchestrator process per repo

Each repo runs its own orchestrator process (the current single-repo loop,
unchanged in shape). A multi-repo daemon with one machine-level Pool was
considered and rejected for now: it re-keys every bucket query, In-flight
entry, Plan cache, and Manifest by repo — a large rewrite bought to solve
a load problem that config discipline solves at this scale.

The Pool exists to protect the **machine** (concurrent Docker sandbox
lifecycles), so N processes each defaulting to 10 would quietly multiply
real load N×. Therefore: **pool size becomes a Repo-profile field with a
small default (3–4)**, and keeping the cross-repo sum sane is the
operator's discipline. A shared machine-level budget becomes an ADR only
if two-busy-repos actually hurts.

## Sequencing: extract after the ADR-0011/0012/0013 backlog lands

Issues #96–#102 (Outcome contract, deterministic Landing, Conflict
resolver, Retry budget, origin-tracking, self-restart) rewrite the
engine's core. Extraction waits until they land **in this repo**, where
the pipeline's feedback loop is proven — we extract the stabilized engine,
not a moving target, and none of the pending issues need re-targeting at a
new home.

## Distribution: own repo, npm package, manual version bumps

Teahouse lives in its own repo and is consumed as a package; yian.dev
becomes its first consumer, holding only configuration. Engine upgrades
reach consumer repos by **manual dependency bumps** — no auto-bump
machinery, no self-updating orchestrator. Chosen deliberately: with a
handful of personal repos, controlling _when_ a repo takes a new engine
beats propagation speed, and a bad release never hits every repo at once.

Two consequences are accepted with eyes open:

- **Version lag is the steady state.** Repos will run old engine versions
  by design. Therefore the Repo-profile **config schema is a compatibility
  surface**: the engine versions its schema and fails loudly on a
  mismatch at startup — never silently reinterprets an old profile.
- **ADR-0013 self-restart survives intact.** The orchestrator watches
  origin/main of the _consumer_ repo; a manual bump commit (package.json +
  lockfile) is exactly the code-change signal the drain-and-restart
  mechanism already reacts to. No new upgrade path is needed.

## Config model: canonical prompts + typed Repo profile

The engine owns the four prompts as templates. Repos cannot shadow a
prompt file wholesale — a forked prompt silently misses engine prompt
fixes (the give-up-path hardening history is the cautionary tale). A
typed per-repo config (the **Repo profile**) supplies everything that
varies:

- install/build hook (`onSandboxReady` command)
- verify commands (typecheck/test — injected into prompts and used by the
  Landing)
- base branch
- per-role models
- pool size
- branch prefix (default `teahouse/`, replacing the literal `sandcastle/`
  in `issueFromBranch` and the Planner's branch-name format)
- path to a repo-owned `CODING_STANDARDS.md`, injected into the review
  prompt

## Host profile: machine facts leave the repo and the image

A per-machine config (e.g. `~/.teahouse/`) holds the LiteLLM base URL,
the API-key env-var name, and the rootless-Docker flag (which drives the
`containerUid: 0` sandbox option). `models.json` is **generated/mounted
into the container at runtime, not baked at build** — changing the
LiteLLM host stops meaning "rebuild every repo's image", and repo
Dockerfiles stop encoding laptop facts.

## Images: contract base + optional per-repo overlay

The engine ships a base image satisfying the sandbox contract — git, gh,
pi, the uid/HOME/worktree-mount subtleties this repo already fought to
get right. A repo may add a small overlay Dockerfile `FROM` that base for
stack extras (yian.dev's overlay: corepack + the pnpm pin). Chosen over
Node-only-v1 to draw the stack-agnostic seam now; chosen over fully
repo-owned Dockerfiles so no repo re-owns the 70 lines of subtle image
logic.

## Observability: per-repo, aggregation deferred

Each repo keeps its own Manifest, transcript dir, and Cockpit — the audit
trail stays with the code it audits. Watching N repos means N Cockpit
instances; a cross-repo Cockpit (which would turn ADR-0008's
supervise-one-child model into a multi-process supervisor) becomes an ADR
only if juggling terminals actually hurts.

## Naming and docs migration

- **Teahouse** is the engine (repo, package, glossary term). The org is
  referred to as **TeahouseHQ** in prose to keep the two distinct.
  "Sandcastle" reverts to meaning the `@ai-hero/sandcastle` sandbox
  library only.
- At extraction, the engine vocabulary in this repo's `CONTEXT.md` (Pool,
  Run, Landing, Outcome, …) and the engine ADRs (0001, 0003, 0004,
  0006–0014) **migrate to the Teahouse repo**, numbering preserved, with
  stubs here marked "migrated". yian.dev's `CONTEXT.md` keeps only
  consumer-side terms. Docs live with the code they govern, per the
  domain-docs convention.
- `.sandcastle/` in consumer repos becomes the Repo-profile home (renamed
  `.teahouse/`); existing `sandcastle/*` branches finish their lifecycle
  before migration (extraction happens after the backlog lands, so the
  board should be quiet).

## What a consumer repo contains after extraction

The adoption checklist — everything else is the package:

1. the Repo profile (typed config file)
2. `CODING_STANDARDS.md`
3. optional overlay Dockerfile
4. npm scripts delegating to the Teahouse CLI (orchestrate, cockpit,
   browse, prune)
5. the triage labels (bootstrapped by the engine on first run, as today)

## Consequences

- Engine bugs get fixed once, in one repo, with the engine dogfooding its
  own orchestrator on itself.
- A repo on an old engine version is a supported state; schema-version
  mismatch is a loud startup failure, not drift.
- The three-tier split (engine / Repo profile / Host profile) is the
  test for every future addition: a new knob must declare which tier it
  belongs to before it lands.
- Rejected alternatives recorded for posterity: multi-repo daemon
  (rewrite disproportionate to scale), template stamping (divergence as
  steady state), auto-bump PRs (machinery disproportionate to N=2–5),
  wholesale prompt overrides (silently forks prompt fixes), baking
  models.json into images (N rebuilds per host change).
