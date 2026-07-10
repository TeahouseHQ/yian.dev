# Agent Skills baked into the image, vendored not fetched

The containerized Pi agent gains **Skills** by vendoring each skill's directory under `.sandcastle/skills/` and `COPY`ing it into the image's global skills dir `/home/agent/.pi/agent/skills/` (next to `models.json`). Skills are model-invocation-only — the headless agent selects them by their `description`, so no `disable-model-invocation` — and all roles share the one baked set, self-gated by description. The first skill is `tdd`, vendored once via `npx skills add mattpocock/skills --skill=tdd --copy`.

## Considered options

- **Commit skills to the repo's project-level `.agents/skills/`** — the bind-mounted worktree would carry them in for free, no image change, versioned with code. Rejected: Pi loads project skills only after a project is _trusted_, and Sandcastle runs Pi headless with no human to grant trust. The image-global dir loads unconditionally — the only path we can prove fires headless.
- **`npx skills add` at Docker build time.** Rejected: the CLI installs upstream `main` (unpinned) over the network, making builds non-deterministic and offline-hostile. Vendoring + `COPY` mirrors how `models.json` is already baked — pinned, offline, and PR-reviewable (which Pi's docs explicitly ask for, since a skill can instruct the model to run arbitrary actions).
- **Hard per-role skill scoping** (Implementer-only, etc.). Rejected as premature: one image ⇒ one global dir ⇒ every role sees every skill, and description-gating self-selects. A hard wall would mean abandoning image-global for that skill (project-level or per-role `--skill` flags) — kept as a future escape hatch.

## Consequences

- Changing a skill needs an image rebuild — cheap, since `pnpm sandcastle` already runs `sandcastle docker build-image` before every run.
- Every role pays the context cost of every skill's `description` on each run; keep the baked set lean and its descriptions sharp (the description is the only thing gating invocation).
- Baking suits Skills because, unlike `models.json` (host-specific → Host profile, mounted at runtime), Skills are host-uniform workflow capabilities — an Overlay-image "stack extra," repo-owned, not a base-image or Host-profile concern.
- Verified once via `sandcastle:shell` (Pi enumerates its discovered skills); no unit test.
- Provenance is tracked by hand in `.sandcastle/SKILLS.md` (source repo + upstream path + pinned commit per skill) plus the add-a-skill runbook. We deliberately do not keep the `skills` CLI's `skills-lock.json` — it pins by content-hash rather than commit and cannot track our hand-moved `.sandcastle/skills/` layout.
