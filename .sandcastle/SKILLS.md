# Agent Skills (vendored)

The skills under [`skills/`](./skills/) are **vendored** capabilities for the containerized
Pi agent, baked into the image's global dir `/home/agent/.pi/agent/skills/` by the
`COPY skills …` line in [`Dockerfile`](./Dockerfile). See **ADR-0017** for why they are
baked-and-vendored rather than committed to the repo's project-level `.agents/skills/` or
fetched with `npx skills add` at build time.

Every skill is **model-invocation-only**: the headless agent selects it by its `description`,
so a skill must have a sharp `description` and must **not** set `disable-model-invocation`.

> **This file lives outside `skills/` on purpose.** Pi treats loose root `.md` files in its
> global skills dir as skill candidates, so a README _inside_ `skills/` would be baked into
> `~/.pi/agent/skills/` and mis-discovered as a broken, description-less skill.

## Installed skills

Version tracking is by **upstream git commit**, pinned at vendor time. `SKILL.md` frontmatter
carries no version field, and git history tracks only our local edits — so this table is the
record of _where each skill came from and at what revision_.

| Skill | Source (GitHub)     | Upstream path             | Pinned commit  | Vendored   |
| ----- | ------------------- | ------------------------- | -------------- | ---------- |
| `tdd` | `mattpocock/skills` | `skills/engineering/tdd/` | `d574778f94cf` | 2026-07-09 |

## Adding a new skill

1. **Fetch once, locally** (never at build time) into a scratch dir:
   ```bash
   npx skills add <owner/repo> --skill=<name> -a claude-code --copy -y
   ```
   The `--skill` filter is unreliable — it may copy the whole set. Just take the one dir you want.
2. **Move it in:**
   ```bash
   mv <scratch>/.claude/skills/<name> .sandcastle/skills/<name>
   ```
3. **Check the `SKILL.md` frontmatter:**
   - `name`: 1–64 chars, lowercase `a-z`/`0-9`/single hyphens (no leading/trailing/consecutive).
   - `description`: present and sharp — it is the **only** thing that makes a headless agent
     reach for the skill.
   - Remove `disable-model-invocation` if present (a headless agent never types `/skill:name`).
4. **Record it in the table above.** Get the pinned commit:
   ```bash
   gh api repos/<owner/repo>/commits/main --jq '.sha[0:12]'
   ```
5. **No Dockerfile change needed** — `COPY skills /home/agent/.pi/agent/skills` already picks up
   any new subdirectory.
6. **Rebuild + verify (one-time):**
   ```bash
   pnpm sandcastle:shell
   # inside the container:
   ls -la "$HOME/.pi/agent/skills/<name>"   # proves the bake
   pi                                        # confirm pi discovers/loads it
   ```

## Updating or re-pinning a skill

Re-run the fetch, diff the new `SKILL.md` against the vendored one, copy over if wanted, and
bump the **Pinned commit** + **Vendored** date in the table. There is no automated `update` —
we deliberately do not keep the CLI's `skills-lock.json` (it pins by content-hash, not commit,
and cannot track our hand-moved layout).
