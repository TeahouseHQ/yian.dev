# yian.dev

A personal portfolio/blog site. This glossary currently covers the **Sandcastle observability** subsystem — the AFK agentic workflow (`.sandcastle/`) and how its work is made visible and auditable.

## Language

### Sandcastle observability

**Transcript**:
The durable, full-fidelity record of a single agent's work, sourced from the captured session JSONL (every thinking block, tool call with inputs, tool result, and token usage). The auditable source of truth.
_Avoid_: log, session log.

**Live feed**:
The real-time, glanceable view of what agents are doing right now, derived from `onAgentStreamEvent`. Lossy by design; optimized for "is it stuck / what is it touching."
_Avoid_: stream log, console output.

**Run log**:
Sandcastle's existing human-readable Display output under `.sandcastle/logs/*.log`. Lossy and `TextDeltaBuffer`-fragmented. Distinct from a Transcript; left as-is.
_Avoid_: transcript.

**Session**:
A single pi agent invocation, identified by a session id, whose Transcript is captured as one JSONL file. One per agent run (Planner, Implementer, Reviewer, Merger).

**Run**:
One outer iteration of the orchestrator loop (Plan → parallel Implement/Review → Merge), identified by a `runId`. All Sessions produced in that iteration share the `runId`. Distinct from sandcastle's `run()` API call, which is one agent invocation.
_Avoid_: iteration (when referring to the identified unit).

**Manifest**:
The append-only index of Sessions (`.sandcastle/sessions/manifest.jsonl`), one line per Session, carrying the human-meaningful metadata the raw Transcript filename lacks (run, phase, issue, branch, status, commits, usage). The lookup table that makes Transcripts findable and a Run auditable.
_Avoid_: index, log.
