# Handoff: Sandcastle live-feed web dashboard (Option C)

Deferred from the observability planning session. The everyday live feed is being built
as **Option A** (prefixed stdout multiplex). This doc captures **Option C** — a local web
dashboard — so it can be planned deeply later. Read `CONTEXT.md` (Sandcastle observability
glossary) first.

## Goal

Replace/augment the single-pane stdout feed with a browser view that shows the up-to-4
parallel agents side by side (one column per branch), each with live tool calls and a
Plan → Implement → Review → Merge progress indicator. Optimized for watching parallel
Phase 2 without braided interleaving.

## Why it's deferred, not dismissed

The everyday pain ("can't see what the agent is doing") is solved cheaply by Option A.
C is a UX upgrade worth ~100 lines + a second thing to open, only justified once large
parallel batches are routine. The plumbing is being shaped so C is a drop-in later.

## The seam it plugs into

Option B of the code-org decision extracts `.sandcastle/observability.mts` exposing an
`observe(label, manifestCtx)` helper that returns a sandcastle `logging` config with an
`onAgentStreamEvent` handler. Today that handler (a) prints a prefixed line to stdout and
(b) appends to the Manifest. **C adds a third sink in the same handler: push the event to
an SSE/WebSocket server.** No orchestration (`main.mts`) changes required.

## Hard constraints (verified against sandcastle 0.10.0 source)

- `onAgentStreamEvent` **only fires in file mode** (`logging.type === "file"`). The dashboard
  must coexist with file logging; it cannot use sandcastle's terminal UI.
- Sandcastle's interactive terminal UI (`ClackDisplay`) is **single-run only** — its spinners
  collide under concurrency. The dashboard must be hand-built off the event stream; do not
  try to reuse `ClackDisplay`.
- `AgentStreamEvent` shape (the only data available live):
  - `{ type: "toolCall", name, formattedArgs, iteration, timestamp }` — atomic; the primary signal.
  - `{ type: "text", message, iteration, timestamp }` — fragmented by `TextDeltaBuffer`
    (flushes on newline / sentence boundary / ~80 chars / 50ms debounce). Noisy across agents.
  - `{ type: "raw", line, iteration, timestamp }` — verbatim stdout; debug only.
  - **No `thinking` event exists** — reasoning is not available live (it lives only in the Transcript JSONL).
- Callback errors are swallowed by sandcastle (`agentStreamEmitterLayer`, `buildAgentStreamHandler`),
  so an SSE push failing cannot kill a run — but also won't surface errors; log them yourself.

## Suggested design (to flesh out)

- Tiny `node:http` server started in `main.mts` (or lazily in `observability.mts`) on a fixed
  port; single static page + an SSE (`text/event-stream`) endpoint. No framework, no deps.
- Each agent = one column, keyed by its label (`impl #44`, `rev #44`, `planner`, `merger`).
- Per column: current phase, last N `toolCall`s, commit count, elapsed time, token usage
  (from `result.usage` once the Session ends), status (running/done/failed).
- Lifecycle markers (sandbox setup, agent start/stop) come from `main.mts` console points —
  consider routing those through `observe()` too so the dashboard sees them.
- On Session completion, link to the Transcript: surface `runId`/`sessionId` so a column can
  deep-link into `render-transcript.mjs` output (or render JSONL in-browser).
- Verbose toggle (`text`/`raw`) gated the same way as the stdout feed (`SANDCASTLE_VERBOSE`).

## Open questions for the deep-dive

- SSE vs WebSocket (SSE is simpler and sufficient — events are one-directional).
- Port selection in worktrees (repo already derives a per-worktree `PORT`; pick a separate
  observability port to avoid clashing with `pnpm dev`).
- Does the dashboard persist across `runId`s (history view) or reset each Run?
- Should it read the Manifest on load to show prior Runs, making it a transcript browser too?

## References

- Live-feed constraints + event shape: `node_modules/@ai-hero/sandcastle` sourcemaps,
  `src/AgentStreamEmitter.ts`, `src/Display.ts`, `src/TextDeltaBuffer.ts`, `src/run.ts`.
- Session relocation + capture: `src/AgentProvider.ts` (`makePiSessionStorage`, `PiOptions`),
  `src/SessionStore.ts`.
