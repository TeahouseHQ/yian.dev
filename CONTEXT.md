# yian.dev

A personal portfolio/blog site. This glossary covers the **Sandcastle observability** subsystem — the AFK agentic workflow (`.sandcastle/`) and how its work is made visible and auditable — and **Blog reader theming**, the light/dark switching on post pages.

## Language

### Sandcastle observability

**Transcript**:
The durable, full-fidelity record of a single agent's work, sourced from the captured session JSONL (every thinking block, tool call with inputs, tool result, and token usage). The auditable source of truth.
_Avoid_: log, session log.

**Live feed**:
The real-time, glanceable view of what agents are doing right now, derived from `onAgentStreamEvent`. Lossy by design; optimized for "is it stuck / what is it touching."
_Avoid_: stream log, console output.

**Run log**:
Sandcastle's existing human-readable Display output under `.sandcastle/logs/*.log`. Lossy and `TextDeltaBuffer`-fragmented. Distinct from a Transcript; left as-is. Disposable — deleted by Prune.
_Avoid_: transcript.

**Prune**:
The `pnpm sandcastle:prune` maintenance command (`.sandcastle/prune.mts`) that reclaims throwaway state after Runs: deletes Run logs, removes merged worktrees, and deletes local `sandcastle/*` branches merged into `main`. Dry-run by default; `--force` to apply. Never touches Transcripts or the Manifest — the audit trail is out of scope by design (ADR-0004).
_Avoid_: clean, gc.

**Session**:
A single pi agent invocation, identified by a session id, whose Transcript is captured as one JSONL file. One per agent run (Planner, Implementer, Reviewer, Merger).

**Run**:
One outer iteration of the orchestrator loop (Plan → parallel Implement/Review → Merge), identified by a `runId`. All Sessions produced in that iteration share the `runId`. Distinct from sandcastle's `run()` API call, which is one agent invocation.
_Avoid_: iteration (when referring to the identified unit).

**Manifest**:
The append-only index of Sessions (`.sandcastle/sessions/manifest.jsonl`), one line per Session, carrying the human-meaningful metadata the raw Transcript filename lacks (run, phase, issue, branch, status, commits, usage). The lookup table that makes Transcripts findable and a Run auditable.
_Avoid_: index, log.

**Pull request (PR)**:
The per-issue review surface on GitHub that makes the Implementer→Reviewer interaction visible and auditable. One PR per issue branch; opened as a draft by the Implementer and reviewed in place by the Reviewer, who marks it ready when it passes. A first-class part of the audit surface alongside the Transcript and Manifest.
_Avoid_: MR, change request.

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
