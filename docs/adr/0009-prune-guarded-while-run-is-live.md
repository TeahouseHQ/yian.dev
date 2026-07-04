# Prune is blocked while a run is live in the Cockpit

The Cockpit's Maintenance tab refuses to apply Prune while the orchestrator child
process is running (Start active), on top of Prune's existing safety
(dry-run-by-default, merged-only, skip-dirty). Stop the run first.

## Context

Consolidation newly lets a run and a prune coexist in one Cockpit session, where
they race over the same `sandcastle/*` worktrees and branches — the orchestrator
is actively creating worktrees/branches and landing merges while Prune would be
deleting them. Standalone `prune`'s safety assumes nothing is concurrently
mutating that state; inside the Cockpit that assumption no longer holds.

## Consequences

The Maintenance tab reads the orchestrator's live status and disables (or
hard-warns on) apply while it is running; the dry-run preview remains available
at all times. A future dev tempted to drop the guard as redundant with Prune's
own safety should not — the guard exists precisely for the concurrent-mutation
case Prune alone does not defend against.
