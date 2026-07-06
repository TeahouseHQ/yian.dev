# Orchestrator-owned terminal transitions: agents report Outcomes, code mutates GitHub state, a Retry budget bounds failures

The Reviewer and Merger give-up paths — and the merge itself — are executed
today by the LLM running `gh` commands from prompt instructions
(review-prompt.md GIVE-UP PATH / REVIEW GATE, merge-prompt.md TEST-THEN-MERGE /
GIVE-UP PATH). Only the prompt _wording_ is tested (prompts.test.mts); the
runtime transitions are not. This ADR moves **every dispatch-controlling GitHub
state transition into orchestrator code**: agents end their Session with a
structured **Outcome** (pass, or give-up with a reason), and the orchestrator
performs the label flips, draft flips, escalation comments, and `gh pr merge`
itself, in tested, crash-safe order. A new in-memory **Retry budget** (N=3 per
issue+phase) bounds the previously-unbounded "crashing item re-dispatches
forever" hole.

## Why

Two failure shapes motivated this:

1. **The crash window lives inside a prompt.** A Merger that gives up must run
   `--remove-label reviewed` → `gh pr ready --undo` → `--add-label
ready-for-human` as three separate commands. An agent that crashes (or
   stops, or hits max iterations) between the first and the third leaves the PR
   ready+unlabeled — outside **every** Dispatch bucket, silently stalled, which
   is exactly the state the `ready-for-human` design exists to prevent. The one
   terminal path that already lives in code, `handleImplementerOutcome`, shows
   the contrast: it is unit-tested and deliberately ordered (terminal label
   added **before** the bucket label is removed) so no crash point loses the
   item.
2. **A deterministic failure loops forever.** A crashed Implementer is
   deliberately not escalated (ADR-0006: a crash may be transient), so an issue
   whose sandbox/install/build fails _deterministically_ re-dispatches — and
   burns a full sandbox lifecycle — every eligible Poll tick, unbounded.

The Implementer's terminal path could move into code because its signal is
observable (zero commits). The Reviewer's pass-vs-give-up is a _semantic
judgment_ the orchestrator cannot infer — hence the Outcome contract: the agent
judges, the code mutates.

## Decision

### The Outcome contract

Each Reviewer / Conflict resolver (ADR-0012) Session ends with a structured
verdict in its final output, parsed the same way the Planner's `<plan>` block
already is:

```
<outcome>pass</outcome>
<outcome>give-up: <one-line reason></outcome>
```

The orchestrator acts on the parsed Outcome:

- **Reviewer pass** → orchestrator adds `reviewed` (creating the label if
  needed) and flips the PR draft → ready. The agent still posts its
  review-summary comment itself (prose, not dispatch-controlling).
- **Reviewer give-up** → orchestrator posts the reason as a PR comment and adds
  `ready-for-human`; the PR stays draft.
- **Merge phase** → this decision went one step further in the same session:
  once the Merger is reduced to validate-and-report, every remaining step
  (`git merge`, typecheck, test, `gh pr merge --merge`) is a deterministic
  command with an exit code — no semantic judgment, therefore **no agent and
  no Outcome at all**. The merge phase becomes the fully scripted **Landing**,
  and its failure path dispatches the **Conflict resolver**, whose Session
  _is_ governed by this Outcome contract. See ADR-0012. The crash-safe
  ordering rule (terminal label applied **before** bucket state is removed,
  the `handleImplementerOutcome` ordering) applies to every PR-shaped
  transition the orchestrator performs.

Prompts shrink to work + verdict; their `gh`-mutation sections are deleted.

### The Retry budget

A Session that **crashes** or resolves **without a parseable Outcome** (agent
rambled, forgot the tag, hit max iterations) is one failed attempt — no GitHub
state changes; the item stays in its bucket for re-dispatch. After **N=3**
failed attempts for the same issue+phase, the orchestrator escalates to
`ready-for-human` with a comment citing the attempts. One rule covers crashes,
garbled tags, and timeouts.

The counter is **in-memory**, keyed by issue+phase, living beside the In-flight
set and Plan cache (ADR-0006/0010's non-durability philosophy). Escalating
clears the counter, so a human who rescues an issue by re-adding
`ready-for-agent` gets a fresh budget. A restart forgets counts — worst case N
extra attempts, benign under at-least-once dispatch.

## Considered options

- **Reconciler instead of Outcomes** — prompts keep mutating; the orchestrator
  verifies invariants each tick (ready PR without `reviewed`, non-draft in no
  bucket, …) and repairs violations. _Rejected as the primary mechanism_: it
  repairs by inference, not intent — it can see state is inconsistent but not
  which transition was meant. Remains available later as defense-in-depth on
  top of Outcomes.
- **Move only labels/drafts, leave `gh pr merge` to the agent.** _Rejected._
  The merge is the largest state transition in the system; once the Merger is
  reduced to validate-and-report there is no reason to leave the landing step
  to prompt compliance. (The same logic then eliminated the Merger agent
  entirely — validate-and-report is itself deterministic — see ADR-0012.)
- **Garbled Outcome = immediate give-up.** _Rejected._ One formatting lapse by
  the model would send perfectly automatable work to a human; folding it into
  the Retry budget keeps the strict contract without the hair trigger.
- **Manifest-derived retry counts** (durable, no new state). _Rejected._ Stale
  history bites: a rescued issue would re-escalate on its first new failure
  because old failed entries still count, and fixing that ("attempts since the
  last human intervention") drags in GitHub timeline archaeology.
- **GitHub-visible counters** (comment or `sandcastle-attempt-N` label).
  _Rejected._ Durable and human-visible, but an API write per failure and a
  polluted label namespace for a counter whose loss is benign.
- **Durable In-flight store** (revisiting ADR-0006's known limitation while in
  the area). _Rejected — and reclassified as wrong, not merely unnecessary._
  Sessions are driven by the orchestrator process; when it dies they die with
  it, so after a restart an **empty** In-flight set is the _accurate_ state.
  Persisting the old set would block re-dispatch of work no agent is doing.
  ADR-0006's "no durable in-flight store for now" is thereby a correct design,
  not a deferred cost.

## Consequences

- The `ready-for-human` invariant ("never loops forever, never silently
  stalls") stops depending on LLM prompt compliance; every transition becomes
  unit-testable pure logic plus one thin `gh` runner, like
  `handleImplementerOutcome` today.
- The Retry budget finally bounds the deterministic-crash loop, at the cost of
  one new in-memory structure and new orchestrator events (attempt-failed,
  budget-exhausted) for the Live feed.
- Prompt tests change character: prompts.test.mts stops pinning `gh` command
  wording in GIVE-UP PATH sections and instead pins the Outcome-tag contract.
- The Manifest entry gains the parsed Outcome, so the Session browser can show
  pass/give-up/no-outcome at a glance.
- A crash window remains between "agent finished" and "orchestrator mutated" —
  but it shrinks from _inside a multi-command prompt_ to a few lines of code,
  and the ordering rule (terminal label first) makes every interleaving
  recoverable.
- ADR-0006 is revised in two places: the Reviewer/Merger give-up paths no
  longer "live in the prompts," and crashed dispatches are no longer retried
  unboundedly. Everything else (Pool, priority drain, at-least-once) stands.
