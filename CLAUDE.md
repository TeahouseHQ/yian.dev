# CLAUDE.md

Personal portfolio/blog site for yian.dev, built with Next.js 15 (App Router), TypeScript, and Tailwind CSS 3. Features a blog with Markdown posts, embedded game demos (Unity/Godot), and interactive browser games.

## Architecture

### Routing (App Router)

- `/home` — Blog listing (home page redirects here)
- `/posts/[slug]` — Blog post pages, statically generated via `generateStaticParams()`
- `/playnow` — Number-matching puzzle game (React + Context API)
- `/play/[engineType]/[handle]` — Embedded Unity/Godot game player
- `/shogun` — Turn-based game prototype with state machine architecture
- `/resume` — Resume page with print-optimized layout and PDF download
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

Tailwind CSS and CSS modules used for markdown content styling (`markdown-styles.module.css`).

## Deployment

Deployed to Vercel.

### Releasing a New Resume PDF

The `generate-resume-pdf.yml` GitHub Actions workflow generates a PDF from the `/resume` page using Playwright and attaches it to a GitHub Release.

**To release:**

1. Create and publish a new GitHub Release (e.g. tag `v1.0.3`)
2. The workflow triggers automatically on `release: published`, builds the site, generates the PDF, and uploads `resume.pdf` as a release asset

**To generate a PDF without releasing** (e.g. for preview), run the workflow manually via `workflow_dispatch`. The PDF is uploaded as a GitHub Actions artifact instead.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues (teahouseHQ/yian.dev) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles map 1:1 to default label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
