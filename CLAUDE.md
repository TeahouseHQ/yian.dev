# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio/blog site for yian.dev, built with Next.js 15 (App Router), TypeScript, and Tailwind CSS 3. Features a blog with Markdown posts, embedded game demos (Unity/Godot), and interactive browser games.

## Commands

```bash
pnpm dev          # Dev server on port 3030
pnpm build        # Production build
pnpm lint         # ESLint (next lint)
pnpm typecheck    # TypeScript type checking (tsc)
pnpm format       # Prettier formatting
```

Node version: 20.18.1 (see .nvmrc). No test framework is configured.

## Architecture

### Routing (App Router)

- `/home` — Blog listing (home page redirects here)
- `/posts/[slug]` — Blog post pages, statically generated via `generateStaticParams()`
- `/playnow` — Number-matching puzzle game (React + Context API)
- `/play/[engineType]/[handle]` — Embedded Unity/Godot game player
- `/shogun` — Turn-based game prototype with state machine architecture
- `/about`, `/projects` — Placeholder pages

### Content

- **Blog posts** live in `/_posts/` as Markdown with YAML front matter (parsed by `gray-matter`). Fields include `isDraft` (hidden in production) and `commentsEnabled` (Disqus).
- **Markdown pipeline:** `remark-parse` → `remark-rehype` → `rehype-highlight` → `rehype-stringify` (in `lib/markdownToHtml.ts`)
- **Game catalog** is hardcoded in `lib/gameCatalog.ts` with metadata for Unity WebGL and Godot HTML5 builds.

### Key Directories

- `/app` — Pages and layouts (App Router)
- `/components` — React components (posts, games, navigation, UI)
- `/lib` — Utilities, API helpers, game logic, context providers
- `/@types` — Custom TypeScript type definitions
- `/styles` — Global CSS and CSS modules

### Path Aliases (tsconfig)

- `#/*` → project root (e.g., `#/lib/api`)
- `types/*` → `@types/*`

### Styling

Tailwind CSS with a custom dark color palette inspired by Firewatch. CSS modules used for markdown content styling (`markdown-styles.module.css`). Custom animations: `tick`, `blink`, `reveal-tile`, `explode`.

### Game Architecture

- **PlayNow game:** React Context API (`GameContext`) for state, seeded RNG (Mulberry32), dynamic import with SSR disabled
- **Shogun game:** Abstract state machine pattern (`lib/shogun/util/stateMachine.ts`), unit-based turn system with attack queues
- **Embedded games:** COOP/COEP headers configured in `next.config.js` for SharedArrayBuffer (required by Godot WASM)

## Git Worktree (Parallel Development)

This repo supports parallel agentic workflows via git worktrees. Each worktree can run its own dev server without port conflicts.

**Prerequisites:** [direnv](https://direnv.net/) for automatic environment loading.

### Quick Setup for New Worktree

```bash
# Create worktree
git worktree add ../yian-dev-feature feature-branch
cd ../yian-dev-feature

# Set up environment (auto-derives unique port from path)
cp .envrc.template .envrc
direnv allow

# Install deps (worktrees need their own node_modules)
pnpm install

# Run dev server (uses PORT from .envrc, shown on cd)
pnpm dev
```

### How It Works

- **direnv** auto-loads `.envrc` on `cd` — no manual sourcing
- `PORT` env var controls dev server port (default: 3030)
- Port derived from path hash (3030-3999) — unique per worktree
- Each worktree needs its own `node_modules` (not shared)
- `.envrc` is gitignored — per-worktree, copy from `.envrc.template`

### Testing Isolation

```bash
./scripts/test-worktree-isolation.sh
```

## Deployment

Deployed to Vercel. Google Analytics (GA4) loads only in production. `IS_LOCAL_DEV` flag in `lib/constants.ts` controls dev-only behavior like showing draft posts.

### Releasing a New Resume PDF

The `generate-resume-pdf.yml` GitHub Actions workflow generates a PDF from the `/resume` page using Playwright and attaches it to a GitHub Release.

**To release:**

1. Create and publish a new GitHub Release (e.g. tag `v1.0.3`)
2. The workflow triggers automatically on `release: published`, builds the site, generates the PDF, and uploads `resume.pdf` as a release asset
3. The `/resume` page links to `https://github.com/yianL/yian.dev/releases/latest/download/resume.pdf` — it always points to the latest release

**To generate a PDF without releasing** (e.g. for preview), run the workflow manually via `workflow_dispatch`. The PDF is uploaded as a GitHub Actions artifact instead.

## Git Hooks

Pre-commit and pre-push hooks are version-controlled in `scripts/` and auto-linked via the `prepare` npm script (runs on `pnpm install`):

- **pre-commit** (`scripts/pre-commit`): runs `pnpm format` and auto-stages formatting changes
- **pre-push** (`scripts/pre-push`): runs `pnpm build` and blocks push on failure
