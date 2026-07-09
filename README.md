# yian.dev

This is the existing [blog-starter](https://github.com/vercel/next.js/tree/canary/examples/blog-starter) plus TypeScript.

The blog posts are stored in `/_posts` as Markdown files with front matter support. Adding a new Markdown file in there will create a new blog post.

## Getting Started

### Prerequisites

- **Node.js** 20.18.1 (see `.nvmrc`)
- **pnpm** (package manager)

### Install

```bash
git clone https://github.com/<your-username>/yian.dev.git
cd yian.dev
pnpm install
```

### Development

```bash
pnpm dev          # Dev server on http://localhost:3030
```

The port can be overridden with the `PORT` environment variable (default: `3030`).

### Other Commands

| Command           | Description                  |
| ----------------- | ---------------------------- |
| `pnpm build`      | Production build (+ sitemap) |
| `pnpm start`      | Start production server      |
| `pnpm lint`       | Run ESLint                   |
| `pnpm typecheck`  | TypeScript type checking     |
| `pnpm format`     | Format code with Prettier    |
| `pnpm test`       | Run tests (Vitest)           |
| `pnpm test:watch` | Run tests in watch mode      |

### Sandcastle Debug Shell

`pnpm sandcastle:shell` builds the Sandcastle image and drops you into an interactive root `bash` shell inside a real sandbox — the same `createSandbox` environment the AFK agents run under (fresh `origin/main` worktree at `/home/agent/workspace`, `.sandcastle/.env` injected, baked-in `models.json`). Use it to test and debug the container environment by hand. Type `exit` to tear the sandbox down.

```bash
pnpm sandcastle:shell                                    # fresh origin/main, no build (fast)
pnpm sandcastle:shell -- --build                         # run install + build first
pnpm sandcastle:shell -- --branch sandcastle/issue-123   # reproduce a specific sandbox
```

Requires a running Docker daemon. Install/build hooks are skipped by default so a broken build can't lock you out of the shell — run `pnpm install`/`pnpm build` yourself inside it, or pass `--build`.

## Workflows

Two CI/CD workflows run in this repo:

### 1. Generate Resume PDF (`generate-resume-pdf.yml`)

Generates a PDF of the `/resume` page using Playwright and attaches it to a GitHub Release.

| Item           | Detail                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Triggers**   | `release` (published), `workflow_dispatch` (manual)                                                                        |
| **Steps**      | Checkout → install deps → install Playwright chromium → `pnpm build` → start production server → `playwright pdf` → upload |
| **On release** | PDF uploaded to the release via `softprops/action-gh-release`                                                              |
| **On manual**  | PDF uploaded as a GitHub Actions artifact                                                                                  |
