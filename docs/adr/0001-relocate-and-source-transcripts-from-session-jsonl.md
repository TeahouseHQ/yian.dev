# Source Transcripts from captured session JSONL, relocated to `.sandcastle/sessions/`

For the Sandcastle observability work we treat each agent's **Transcript** (the auditable
record) as the captured pi **session JSONL** — the richest artifact, carrying thinking,
tool calls with inputs, tool results, and per-message token usage — rather than
reconstructing it from the live `onAgentStreamEvent` stream, which is lossy (only
`text`/`toolCall`/`raw`, with `text` fragmented by `TextDeltaBuffer` and no `thinking`).
This decouples the lossy **Live feed** from the lossless Transcript: they have different
fidelity needs and now use different mechanisms.

We relocate captured sessions out of pi's default `~/.pi/agent/sessions/` into the repo at
`.sandcastle/sessions/` (gitignored) by passing `sessionStorage.hostSessionsDir` to every
`pi()` call, so Sandcastle's auditable output isn't mixed with the developer's other local
pi sessions and stays co-located with the workflow that produced it.

## Consequences

- The same `hostSessionsDir` must be passed to **every** `pi()` call (Planner, Implementer,
  Reviewer, Merger) or capture/resume/fork desync. Files land under
  `.sandcastle/sessions/--<encoded-cwd>--/` — the encoded-cwd subdir is required for pi's
  `--session <id>` resolution and cannot be flattened.
- **Trade-off accepted:** relocated sessions no longer live where a plain `pi --session <id>`
  from a normal shell looks, so that native resume path is lost; resume happens via Sandcastle
  (which knows `hostSessionsDir`) or by reading the files directly.
- Transcript filenames remain `timestamp_sessionId` — not labeled by phase/issue — so a
  separate append-only **Manifest** (`.sandcastle/sessions/manifest.jsonl`) provides the
  human-meaningful lookup. The Manifest format itself is easily reversible and not covered here.
