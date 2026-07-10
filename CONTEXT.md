# yian.dev

A personal portfolio/blog site. This glossary covers the site's own consumer-side
vocabulary: **Blog reader theming** (the light/dark switching on post pages) and this
repo's role as a **Teahouse consumer**.

The AFK agentic workflow that operates on this repo is the [Teahouse](https://github.com/TeahouseHQ/teahouse)
orchestration engine, consumed as a package (ADR-0014). The engine's vocabulary — Transcript,
Run, Pool, Dispatch bucket, Poll tick, Plan cache, Outcome, Landing, Conflict resolver,
Cockpit, Session browser, Repo profile, Host profile, Overlay image, Skill, … — lives in the
**Teahouse repo's `CONTEXT.md`**, not here. Its ADRs live in that repo's `docs/adr/`; the
engine ADRs that used to live here are now one-line stubs pointing there (ADR-0014).

## Language

### Blog reader theming

**Blog reader**:
A single blog-post page at `/posts/[slug]` — the whole page frame (nav, post header, article body, comments, footer), not just the article markdown. The only surface that can be light; every other page (`/home`, `/playnow`, …) is permanently dark.
_Avoid_: post viewer, article view.

**Reader theme**:
The active colour scheme of a Blog reader: `dark` (the site-wide default) or `light`. Applied by toggling a `theme-light` class on `<html>`; the absence of the class means dark.
_Avoid_: mode, colour mode, skin.

**Theme preference**:
The reader's persisted, global choice of Reader theme, stored in `localStorage` under a single key. Applies to all Blog readers and survives reloads and future visits. Dark by default (a first-time visitor's OS `prefers-color-scheme` is ignored). Does not affect any non-post page.
_Avoid_: setting, mode preference.

**Theme toggle**:
The fixed top-corner sun/moon `<button>` rendered only on Blog readers. Flips the Theme preference and re-applies the Reader theme live. On mount it applies the preference; on unmount it reverts to dark, keeping non-post pages dark during client-side navigation.
_Avoid_: switcher, dark mode button.

### Teahouse consumer

**Repo profile (this repo's choices)**:
yian.dev's behavioural surface toward the engine, at `.teahouse/repo-profile.json` (schema
version 1). Install/build is `pnpm install --frozen-lockfile && pnpm build`; verify runs
`pnpm typecheck` + `pnpm test`; base branch `main`; branch prefix `teahouse/`; Pool size 4;
coding standards at `.teahouse/CODING_STANDARDS.md`. Two Model profiles ship — `glm` (all roles
on glm-5.2) and the default `mixed` (Implementer on glm-5.2, the rest on Opus 4.8). The term
definitions for Repo profile, Model profile, Pool, etc. live in the Teahouse repo's `CONTEXT.md`.

**Overlay image (this repo's)**:
yian.dev's thin `.sandcastle/Dockerfile`, `FROM` the Teahouse base image, adding only the
stack extras this repo needs (corepack + a pnpm pin). The base image owns the sandbox contract;
this overlay owns nothing but the pnpm version (ADR-0014, and the engine's Overlay image term).
