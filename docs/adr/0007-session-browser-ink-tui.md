# Session browser is an Ink TUI, separate from the zero-dep render CLI

We browse recent Runs/Sessions from the Manifest via an interactive Ink (React)
TUI run under `tsx`, rather than extending `render-transcript.mjs`. That CLI is
deliberately dependency-free plain ESM so it runs under bare `node` with no
loader — a constraint a TUI can't meet. The two split by job:
`render-transcript.mjs` stays the zero-dep, scriptable, one-shot path; the
Session browser is the interactive layer and _imports_ the CLI's pure core
(`readManifest`, `filterEntries`, `resolveTranscriptFile`, `parseTranscript`,
`renderTranscript`) so query/render logic isn't duplicated.

## Considered Options

- **Ink (chosen)** — React 19 + `tsx` are already in the repo, so components,
  hooks, and keyboard/focus/scroll primitives are the codebase's native idiom.
  Cost: the first dependency-heavy tool in `.sandcastle/`.
- **Hand-rolled `node:readline` + raw ANSI** — preserves the zero-dep norm but
  reimplements scrolling, focus, and layout by hand for a genuinely interactive
  two-pane browser.
- **blessed / neo-blessed / terminal-kit** — purpose-built but older, non-React,
  and a stylistic mismatch with the codebase.

## Consequences

The Session browser is post-hoc and local-only (reads a manifest whose
transcripts are expected on the same machine), read-once with manual reload, and
is the audit companion to the real-time Live feed — not a replacement for it. A
future reader inclined to "fix" the browser back to zero-dep should not: the
zero-dep constraint is owned by `render-transcript.mjs`, deliberately not by this
tool.
