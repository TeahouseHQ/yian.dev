import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  createInflight,
  createPool,
  createRetryBudget,
  DRAIN_EXIT_CODE,
  escalateBudgetExhausted,
  filterReadyForAgent,
  filterReadyForMerge,
  filterReadyForReview,
  handleImplementerOutcome,
  handleReviewerOutcome,
  implementerSandboxSpec,
  isBudgetExhausted,
  issueFromBranch,
  landingSandboxSpec,
  orchestratorCodeChanged,
  parseOutcome,
  pickImplementers,
  pickPrs,
  POLL_INTERVAL_MS,
  POOL_SIZE,
  requeueResolvedPr,
  RETRY_BUDGET_N,
  resolvePlanEmit,
  shouldQueryBuckets,
  shouldRunPlanner,
  type BucketPr,
  type BudgetTarget,
  type EmittedIssue,
  type ParsedOutcome,
  type PlanCache,
  type ReadyForAgentIssue,
} from "./dispatch.mts";
import {
  agentFreeResult,
  appendManifestLine,
  buildFailedManifestEntry,
  buildManifestEntry,
  generateRunId,
  lifecycle,
  observe,
  resolveFailedSessionFile,
  sessionsDir,
  type RunLike,
} from "./observability.mts";
import { createEvents } from "./events.mts";
import { resolveProfile } from "./model-profiles.mts";

const execFileAsync = promisify(execFile);

// Resolve the active Model profile from SANDCASTLE_PROFILE — never argv (ADR-0016).
// This is the single source of the four model-bearing roles' models, replacing the
// old hardcoded MODELS const. Unset falls back silently to `mixed` (the documented
// default); an unknown name is a LOUD non-zero exit here, before the loop starts,
// printing the valid names — a typo must not quietly run the wrong (expensive)
// models. Env is the transport (not an argv flag) so the profile survives a
// self-restart respawn (ADR-0013) for free via env inheritance; the `--profile`
// flag on `pnpm sandcastle` is translated into this env var by run.mts.
const profileResolution = resolveProfile(process.env.SANDCASTLE_PROFILE);
if (!profileResolution.ok) {
  console.error(profileResolution.error);
  process.exit(1);
}
const activeProfile = profileResolution.profile;

// Sandbox factory — use this everywhere instead of calling docker() directly.
//
// This machine runs ROOTLESS Docker. Under rootless, the container's root maps
// to the host user (uid 1000) that owns the bind-mounted worktree, so root is
// the ONLY user that can write commits into it. Plain docker() defaults --user
// to the host uid (1000), which rootless maps to an unprivileged subuid
// (~100999) that does NOT own the files — every chmod/touch/commit then fails
// with "Operation not permitted" and the agent produces no commits. Passing
// containerUid/containerGid: 0 runs the container as root and fixes this.
// The image's USER must match (root) — see Dockerfile — or sandcastle's
// checkImageUid guard rejects the mismatch.
//
// For ROOTFUL Docker, drop these options (plain docker()) and restore
// `USER ${AGENT_UID}:${AGENT_GID}` in the Dockerfile instead.
const dockerSandbox = () => docker({ containerUid: 0, containerGid: 0 });

// `sessionStorage.hostSessionsDir` MUST be passed to every pi() call or
// capture/resume desync (ADR 0001). One shared absolute path relocates all
// captured session JSONL into the repo under .sandcastle/sessions/. Each Session
// is tagged with its own runId: the Planner's is per-invocation, while an issue's
// Implementer/Reviewer (and its agent-free Landing) share an issue-derived run-issue-<n> (CONTEXT.md: Run).
const piSessions = { sessionStorage: { hostSessionsDir: sessionsDir } };

/**
 * Run an agent and append one Manifest line the moment it resolves — success or
 * failure. A rejected run() still records a best-effort `status: "failed"`
 * entry (error + timing, no transcript-link guessing) before re-throwing, so a
 * mid-Run crash leaves a complete record. The manifest append itself never
 * throws (see appendManifestLine).
 */
async function recordedRun<R extends RunLike>(args: {
  runId: string;
  phase: string;
  issue?: number | null;
  branch?: string | null;
  run: () => Promise<R>;
  /** Extract the Session's structured Outcome from its result for the Manifest
   *  (ADR-0011). Given for the Reviewer (parses its `<outcome>` tag); omitted for
   *  phases that report none (impl/planner) — the entry records null. */
  outcome?: (result: R) => ParsedOutcome | null;
}): Promise<R> {
  const startedAt = new Date();
  try {
    const result = await args.run();
    await appendManifestLine(
      buildManifestEntry({
        runId: args.runId,
        phase: args.phase,
        issue: args.issue,
        branch: args.branch,
        result,
        startedAt,
        endedAt: new Date(),
        outcome: args.outcome?.(result) ?? null,
      })
    );
    return result;
  } catch (error) {
    // Best-effort: link the session JSONL captured before the crash so the
    // failure is viewable in the Session browser / render CLI (issue #94).
    const endedAt = new Date();
    const session = await resolveFailedSessionFile({ startedAt, endedAt });
    await appendManifestLine(
      buildFailedManifestEntry({
        runId: args.runId,
        phase: args.phase,
        issue: args.issue,
        branch: args.branch,
        error,
        session,
        startedAt,
        endedAt,
      })
    );
    throw error;
  }
}

/** Run one `gh` command on the host and return its stdout (rejects on non-zero). */
async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

/**
 * Fetch `origin` on the host once per dispatching Poll tick (ADR-0013). A bare
 * `git fetch origin` updates the remote-tracking refs (`origin/main`, …) ONLY —
 * it never pulls, checks out, or merges into the human's local `main` or working
 * tree, so origin-tracking stays entirely off the human's refs. Returns
 * ok/error so the loop can skip this tick's dispatch on failure rather than
 * fork, validate, and prune against stale refs; the next tick re-fetches.
 */
async function fetchOrigin(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await execFileAsync("git", ["fetch", "origin"], { maxBuffer: 10 * 1024 * 1024 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The current `origin/main` commit SHA on the host (the remote-tracking ref
 * {@link fetchOrigin} refreshes), or `null` when it can't be read. Seeded once at
 * startup and re-read after each fetch: a change means the fetch advanced the ref
 * (ADR-0013, #102). Read-only — like the bare fetch, it never touches local main.
 */
async function originMainSha(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "origin/main"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Detect whether a fetch advanced `origin/main` onto a commit that changed the
 * orchestrator's OWN code — the self-restart drain trigger (ADR-0013, #102). The
 * orchestrator's `.mts`/`.tsx` code is loaded once at process start, so a change
 * to it staled the running process (old code driving new prompts, which wedges
 * the loop). Compares `lastSha` to the freshly-fetched SHA and asks git which
 * paths moved (`git diff --name-only`), then applies the pure
 * {@link orchestratorCodeChanged} classifier. Returns the new SHA (so the caller
 * advances its last-seen marker even for a benign product-only change) and
 * whether it staled us; `null` when the ref is unreadable or unchanged. A first
 * detection with no `lastSha` records the ref without restarting (nothing to
 * diff against).
 */
async function detectOrchestratorUpgrade(
  lastSha: string | null
): Promise<{ sha: string; shortSha: string; codeChanged: boolean } | null> {
  const newSha = await originMainSha();
  if (newSha === null || newSha === lastSha) return null;
  let codeChanged = false;
  if (lastSha !== null) {
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only", lastSha, newSha], {
        maxBuffer: 10 * 1024 * 1024,
      });
      const paths = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      codeChanged = orchestratorCodeChanged(paths);
    } catch {
      // A diff failure must not restart on a guess — treat as no orchestrator
      // change; the next fetch re-detects against the now-advanced marker.
      codeChanged = false;
    }
  }
  return { sha: newSha, shortSha: newSha.slice(0, 7), codeChanged };
}

/**
 * Run a `gh` command, returning `fallback` (and a stderr line) on failure. Used
 * for the per-tick bucket queries so one bad query never kills the loop — the
 * next tick re-queries.
 */
async function ghOr(fallback: string, args: string[]): Promise<string> {
  try {
    return await gh(args);
  } catch (err) {
    events.ghError(args, errorMessage(err));
    return fallback;
  }
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0];
}

/**
 * The ready-for-agent Dispatch bucket: open issues labeled `ready-for-agent`,
 * with their labels so `filterReadyForAgent` can exclude any that ALSO carry
 * `ready-for-human`. (In-flight and open-PR exclusions are applied with that
 * function — they need state the issue list does not carry.)
 */
async function queryReadyForAgent(): Promise<ReadyForAgentIssue[]> {
  const out = await ghOr("[]", [
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    "ready-for-agent",
    "--limit",
    "200",
    "--json",
    "number,title,labels,updatedAt",
  ]);
  const rows = JSON.parse(out || "[]") as {
    number: number;
    title: string;
    labels: { name: string }[];
    updatedAt: string;
  }[];
  return rows.map((r) => ({
    number: r.number,
    title: r.title,
    labels: r.labels.map((l) => l.name),
    updatedAt: r.updatedAt,
  }));
}

/**
 * All open `sandcastle/issue-N` PRs with their draft state and labels — the
 * raw input for both the `ready-for-merge` and `ready-for-review` Dispatch
 * buckets (split by `filterReadyForMerge` / `filterReadyForReview`), AND the
 * source of the open-PR issue set that excludes `ready-for-agent` issues from
 * the implement bucket. One `gh pr list` query feeds all three concerns. Only
 * `sandcastle/issue-N` branches are kept; the branch is parsed back to the
 * issue number so a Reviewer/Landing shares the issue-derived `runId` and
 * In-flight key with the issue's Implementer (one issue ↔ one PR).
 */
async function queryReviewMergePrs(): Promise<BucketPr[]> {
  const out = await ghOr("[]", [
    "pr",
    "list",
    "--state",
    "open",
    "--json",
    "number,headRefName,isDraft,labels",
    "--limit",
    "200",
  ]);
  const rows = JSON.parse(out || "[]") as {
    number: number;
    headRefName: string;
    isDraft: boolean;
    labels: { name: string }[];
  }[];
  const prs: BucketPr[] = [];
  for (const r of rows) {
    const issue = issueFromBranch(r.headRefName);
    if (issue === null) continue; // not one of our sandcastle PRs
    prs.push({
      prNumber: r.number,
      issue,
      branch: r.headRefName,
      isDraft: r.isDraft,
      labels: r.labels.map((l) => l.name),
    });
  }
  return prs;
}

/** The `gh` runner handed to the pure terminal-transition handlers
 *  (`handleImplementerOutcome`, `handleReviewerOutcome`): runs one `gh` command
 *  and resolves on success / rejects on non-zero exit. */
const ghRunner = { run: async (args: string[]) => void (await gh(args)) };

/** The typed orchestrator event stream (ADR-0008): every progress moment
 *  flows through this one emitter as a discriminated union, with a prose
 *  renderer (default, headless output unchanged) and an NDJSON renderer
 *  (`SANDCASTLE_EVENT_FORMAT=ndjson`, for the supervising Cockpit). Replaces
 *  the ad-hoc `console.log`s that used to be scattered through this file. */
const events = createEvents();

// Announce the active Model profile once at startup (ADR-0016), so the headless
// prose feed (and the Cockpit) shows which models each role is running before the
// first Poll tick. The name + resolved role→model map are the durable record of
// what this process was launched on.
events.profileSelected(activeProfile.name, activeProfile.models);

// ── The persistent shared-pool orchestrator (ADR-0006) ──────────────────────
//
// One shared concurrency Pool of POOL_SIZE consumed by the two agent roles
// (Implementer, Reviewer) and the agent-free Landing, one In-flight set keyed by
// issue number, and a Poll tick that never self-exits. Each tick: if the Pool is
// full, skip the gh query entirely; otherwise query all three Dispatch buckets
// and fill `free` slots in strict priority **merge → review → implement** (started
// work lands before new work starts, which prevents PR starvation). The Planner
// runs in its own (Pool-exempt) slot only when actionable `ready-for-agent` issues
// exist AND a slot remains free after merge+review draining. Reviewers/Landings
// each build their own fresh sandbox (impl and review are decoupled across ticks)
// and run the issue-derived `runId`. A no-op Implementer is escalated to
// ready-for-human so it is not re-dispatched. The Reviewer reports an Outcome the
// orchestrator acts on — the review gate + give-up transitions are performed here
// in code (ADR-0011, #96). The merge phase is the deterministic, agent-free
// Landing: the orchestrator merges + validates in a sandbox and runs
// `gh pr merge` itself; a failed Landing spends a merge-phase attempt and
// dispatches the Conflict resolver, which merges origin/main into the branch,
// fixes it green, and routes it back through review — escalating to
// ready-for-human only on Retry-budget exhaustion (ADR-0012, #101).
const pool = createPool(POOL_SIZE);
const inflight = createInflight();

// The Plan cache (ADR-0010): the Planner's last emit list keyed by a
// content-hash of the raw `ready-for-agent` set. In-memory / non-durable (cold
// after restart → one re-plan), living beside the In-flight set. While the key
// is unchanged, the implement stage dispatches from `planCache.emit` with no
// Opus Planner call; `resolvePlanEmit` re-invokes the Planner only on a miss.
let planCache: PlanCache = null;

// The Retry budget (ADR-0011, #98): the in-memory failed-attempt counter keyed by
// issue+phase, living beside the In-flight set and Plan cache (same non-durability
// philosophy). A crashed Session, a Session with no parseable Outcome, or a failed
// Landing is one failed attempt; a successful Session clears the counter. On the
// N=3rd attempt for an issue+phase, `recordFailedAttempt` escalates to
// ready-for-human and clears the counter (a re-labeling human gets a fresh budget).
const budget = createRetryBudget();

/**
 * Record one failed attempt against the Retry budget for `issue`+`phase` and act
 * on it (ADR-0011, #98). Below the threshold: no GitHub state changes — the item
 * stays in its Dispatch bucket for re-dispatch — and an `attempt-failed` event
 * makes the struggling item visible. On the N=3rd attempt: clear the counter
 * (BEFORE escalating, so a human re-labeling the item starts fresh) and escalate
 * to `ready-for-human` via the shape-aware {@link escalateBudgetExhausted}
 * (issue-shaped for implement, PR-shaped for review/land), then emit
 * `budget-exhausted`. A gh failure during escalation is tolerated — it must not
 * crash the orchestrator loop; the next tick re-dispatches and re-attempts.
 *
 * Returns whether it **escalated** (the threshold was hit) so a caller can branch
 * on it — the failed Landing hands off to the Conflict resolver only when it did
 * NOT escalate (below the threshold); on exhaustion the item is already handed to
 * a human (ADR-0012).
 */
async function recordFailedAttempt(
  target: BudgetTarget,
  phase: string,
  issue: number,
  detail?: string
): Promise<boolean> {
  const attempts = budget.fail(issue, phase);
  if (isBudgetExhausted(attempts)) {
    budget.clear(issue, phase);
    try {
      await escalateBudgetExhausted(target, phase, attempts, ghRunner, detail);
    } catch (escErr) {
      events.ghError(["budget-escalate", phase, String(issue)], errorMessage(escErr));
    }
    events.budgetExhausted(issue, phase, attempts);
    return true;
  }
  events.attemptFailed(issue, phase, attempts, RETRY_BUDGET_N);
  return false;
}

/**
 * Dispatch one Implementer for an issue into the shared Pool. Occupies a slot
 * (acquire), marks the issue in-flight, opens a fresh sandbox, runs the
 * Implementer, then on a clean zero-commit run escalates to `ready-for-human`.
 * Whatever happens, the finally disposes the sandbox, removes the issue from
 * the In-flight set, and frees the Pool slot — in that order (await-using
 * disposal runs before the finally), so the slot covers the full lifecycle.
 *
 * A CRASHED Implementer is NOT escalated (only a clean no-op is): a crash may be
 * transient, so the issue stays `ready-for-agent` for a re-dispatch — the
 * accepted at-least-once behaviour (ADR-0006).
 */
async function dispatchImplementer(issue: {
  number: number;
  title: string;
  branch: string;
}): Promise<void> {
  await pool.acquire();
  const issueRunId = generateRunId(issue.number);
  const implLabel = "impl #" + issue.number;
  const implLC = lifecycle(implLabel);
  implLC.start();
  try {
    // Fork the new sandcastle/issue-N branch from origin/main (never HEAD), then
    // install+build. The fork base + hooks are the pure `implementerSandboxSpec`
    // (ADR-0013): basing on origin/main makes the Implementer independent of what
    // the human has checked out in the host worktree. --frozen-lockfile because
    // this repo is pnpm-only, so a plain `npm install` would resolve a competing
    // lockfile (see implementerSandboxSpec / INSTALL_BUILD in dispatch.mts).
    await using sandbox = await sandcastle.createSandbox({
      sandbox: dockerSandbox(),
      ...implementerSandboxSpec(issue.branch),
    });
    implLC.sandbox();

    const result = await recordedRun({
      runId: issueRunId,
      phase: "impl",
      issue: issue.number,
      branch: issue.branch,
      run: () =>
        sandbox.run({
          name: "Implementer #" + issue.number,
          agent: sandcastle.pi(activeProfile.models.implementer, piSessions),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            ISSUE_NUMBER: String(issue.number),
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
          logging: observe(implLabel),
        }),
    });
    implLC.commits(result.commits.length);
    events.sessionResolved({
      role: "implementer",
      issue: issue.number,
      branch: issue.branch,
      status: "ok",
      commits: result.commits.length,
    });
    // A successful Session (the run resolved, crash-free) clears the impl Retry
    // budget for this issue (ADR-0011): a later transient failure starts fresh.
    budget.clear(issue.number, "impl");

    // No-op terminal handling (ADR-0006): zero commits → no draft PR → strip
    // ready-for-agent, add ready-for-human, comment, so it is not re-dispatched.
    const escalated = await handleImplementerOutcome(issue.number, result.commits.length, ghRunner);
    if (escalated) {
      events.noopEscalated(issue.number);
    }
  } catch (err) {
    events.sessionResolved({
      role: "implementer",
      issue: issue.number,
      branch: issue.branch,
      status: "failed",
      commits: 0,
      error: errorMessage(err),
    });
    // A CRASHED Implementer is a failed attempt against the Retry budget (ADR-0011,
    // #98) — not escalated on its own (a crash may be transient, ADR-0006), but
    // bounded so a deterministically-crashing issue no longer re-dispatches forever.
    // Issue-shaped: on exhaustion, strip ready-for-agent + add ready-for-human.
    await recordFailedAttempt(
      { kind: "issue", issue: issue.number },
      "impl",
      issue.number,
      errorMessage(err)
    );
  } finally {
    implLC.done();
    inflight.delete(issue.number);
    pool.release();
  }
}

/**
 * Dispatch one Reviewer for a draft PR into the shared Pool. Occupies a slot
 * (acquire), marks the issue in-flight, opens a **fresh sandbox from the PR
 * branch** (impl and review are decoupled across ticks per ADR-0006, so the
 * Reviewer cannot reuse the Implementer's live sandbox), re-runs install+build,
 * and runs review-prompt.md. The Reviewer commits fixes itself (Model A), posts
 * a prose review-summary comment, and ends its Session with a structured
 * **Outcome** (`<outcome>pass</outcome>` / `<outcome>give-up: …</outcome>`). The
 * orchestrator parses it and performs every dispatch-controlling transition
 * itself (ADR-0011): on `pass` it opens the review gate (adds `reviewed`, flips
 * the PR draft → ready); on `give-up` it escalates to `ready-for-human` (PR left
 * draft). A missing/garbled Outcome triggers no GitHub mutation (a Retry-budget
 * attempt) — it is recorded in the Manifest and surfaced as an event. Whatever
 * happens, the finally disposes the sandbox, removes the issue from the In-flight
 * set, and frees the Pool slot. The runId is issue-derived, shared with impl.
 */
async function dispatchReviewer(pr: {
  prNumber: number;
  issue: number;
  branch: string;
}): Promise<void> {
  await pool.acquire();
  const issueRunId = generateRunId(pr.issue);
  const label = "rev #" + pr.issue;
  const lc = lifecycle(label);
  lc.start();
  try {
    await using sandbox = await sandcastle.createSandbox({
      sandbox: dockerSandbox(),
      branch: pr.branch,
      copyToWorktree: ["node_modules"],
      hooks: {
        sandbox: {
          onSandboxReady: [{ command: "pnpm install --frozen-lockfile && pnpm build" }],
        },
      },
    });
    lc.sandbox();

    const result = await recordedRun({
      runId: issueRunId,
      phase: "rev",
      issue: pr.issue,
      branch: pr.branch,
      // ADR-0011: record the Reviewer's parsed Outcome in the Manifest entry.
      outcome: (r) => parseOutcome(r.stdout),
      run: () =>
        sandbox.run({
          name: "Reviewer #" + pr.issue,
          agent: sandcastle.pi(activeProfile.models.reviewer, piSessions),
          promptFile: "./.sandcastle/review-prompt.md",
          // The prompt re-fetches the full issue via `gh issue view`, so the
          // title is just a header; it is not in the PR-bucket query, so a
          // derived placeholder avoids an extra gh call per Reviewer.
          promptArgs: {
            ISSUE_NUMBER: String(pr.issue),
            ISSUE_TITLE: "Issue #" + pr.issue,
            BRANCH: pr.branch,
          },
          logging: observe(label),
        }),
    });
    events.sessionResolved({
      role: "reviewer",
      issue: pr.issue,
      branch: pr.branch,
      status: "ok",
      commits: result.commits.length,
    });

    // ADR-0011: the agent judged; the orchestrator mutates. Parse the reported
    // Outcome and perform the terminal transition ourselves. A missing/garbled
    // Outcome (parseOutcome → null) triggers NO GitHub mutation — the review is
    // left for re-dispatch and spends a Retry-budget attempt (the else branch, #98).
    const outcome = parseOutcome(result.stdout);
    events.reviewerOutcome(
      pr.issue,
      outcome?.kind ?? "none",
      outcome?.kind === "give-up" ? outcome.reason : null
    );
    if (outcome) {
      // A parsed Outcome (pass or give-up) is a successful Session — clear the rev
      // Retry budget for this issue before performing the terminal transition.
      budget.clear(pr.issue, "rev");
      const transition = await handleReviewerOutcome(outcome, pr, ghRunner);
      events.reviewTransition(pr.issue, transition);
    } else {
      // No parseable Outcome (agent rambled / forgot the tag / hit max iterations):
      // a failed attempt against the Retry budget (ADR-0011, #98). No GitHub state
      // changes below the threshold — the draft PR stays in the ready-for-review
      // bucket for re-dispatch. PR-shaped, gated:false (the PR is a plain draft).
      await recordFailedAttempt(
        { kind: "pr", prNumber: pr.prNumber, gated: false },
        "rev",
        pr.issue,
        "the Session produced no parseable Outcome"
      );
    }
  } catch (err) {
    events.sessionResolved({
      role: "reviewer",
      issue: pr.issue,
      branch: pr.branch,
      status: "failed",
      commits: 0,
      error: errorMessage(err),
    });
    // A CRASHED Reviewer is a failed attempt against the Retry budget (#98). Same
    // PR-shaped, gated:false escalation on exhaustion as the no-Outcome case.
    await recordFailedAttempt(
      { kind: "pr", prNumber: pr.prNumber, gated: false },
      "rev",
      pr.issue,
      errorMessage(err)
    );
  } finally {
    lc.done();
    inflight.delete(pr.issue);
    pool.release();
  }
}

/**
 * Run the agent-free **Landing** for a ready + `reviewed` PR (CONTEXT.md: Landing;
 * ADR-0012). Occupies a Pool slot (acquire) and marks the issue in-flight — the
 * sandbox lifecycle is the cost being limited, not an agent — but runs NO agent,
 * NO prompt, and spends zero tokens. In a fresh ISOLATED worktree forked from
 * `main` (never head mode — see below), it validates the merge deterministically
 * via `onSandboxReady` hooks: `git merge <PR branch>` → `pnpm typecheck && pnpm
 * test`. A textual conflict makes `git merge` exit non-zero and a red suite makes
 * typecheck/test exit non-zero — either rejects `createSandbox`, taking us to the
 * failure path. On the clean path the orchestrator lands the PR server-side with
 * `gh pr merge --merge` (a real merge commit, preserving the impl vs review
 * commits in history), emits `landing-landed`, and records an agent-free Manifest
 * entry under the issue's runId.
 *
 * On failure — conflict, red suite, or the merge command failing — the ready +
 * `reviewed` PR spends one merge-phase ("land") Retry-budget attempt via
 * {@link recordFailedAttempt} (ADR-0011/0012, #98): on the N=3rd attempt the
 * PR-shaped gated escalation strips the `reviewed` gate + reverts to draft and
 * hands the PR to a human (crash-safe: terminal label first). **Below the
 * threshold, the orchestrator dispatches the Conflict resolver** ({@link
 * dispatchResolver}) instead of escalating — it merges `origin/main` into the
 * branch, fixes it green, and routes it back through review (ADR-0012). The issue
 * is kept in-flight across the handoff (`handoff` short-circuits the finally's
 * `inflight.delete`) so no re-Landing races in before the resolver runs; the
 * resolver takes ownership of clearing it. Whatever happens, the finally disposes
 * the sandbox and frees the Pool slot. The runId is issue-derived, shared with
 * impl/rev/resolve.
 */
async function dispatchLanding(pr: {
  prNumber: number;
  issue: number;
  branch: string;
}): Promise<void> {
  await pool.acquire();
  const issueRunId = generateRunId(pr.issue);
  const label = "land #" + pr.issue;
  const lc = lifecycle(label);
  lc.start();
  const startedAt = new Date();
  // Did a failed Landing hand off to the Conflict resolver? Then keep the issue
  // in-flight (the resolver owns removing it) so no re-Landing races in.
  let handoff = false;
  events.landingStarted(pr.prNumber, pr.issue, pr.branch);
  try {
    // Validate in an ISOLATED worktree forked from `origin/main`, NOT head mode. A
    // bind-mount provider (docker) defaults to the "head" strategy, which
    // bind-mounts the host repo directly — so the validation `git merge <PR
    // branch>` would mutate your real local `main` and dirty the host working
    // tree. `landingSandboxSpec` passes an explicit throwaway
    // `sandcastle/merge-<issue>` branch forked from `origin/main` (ADR-0013): the
    // local test-merge happens there against the SAME base the PR lands on
    // server-side (not stale local `main`), and is discarded when the worktree is
    // disposed, while the actual landing stays server-side via `gh pr merge`. So
    // the Landing never reads or mutates the host's live `main` or working tree.
    // (Leftover local `sandcastle/merge-*` refs are cleaned by `pnpm
    // sandcastle:prune`.) The deterministic test-then-merge hooks live in the
    // spec: a textual conflict or a red suite rejects createSandbox and routes us
    // to the failure escalation below.
    await using sandbox = await sandcastle.createSandbox({
      sandbox: dockerSandbox(),
      ...landingSandboxSpec(pr.issue, pr.branch),
    });
    lc.sandbox();

    // Clean merge + green suite → land it server-side. `--merge` (a real merge
    // commit, NOT --squash) preserves the individual RALPH: (Implementer) and
    // RALPH: Review - (Reviewer) commits on main.
    await gh(["pr", "merge", String(pr.prNumber), "--merge"]);

    await appendManifestLine(
      buildManifestEntry({
        runId: issueRunId,
        phase: "land",
        issue: pr.issue,
        branch: pr.branch,
        result: agentFreeResult,
        startedAt,
        endedAt: new Date(),
        outcome: null,
      })
    );
    events.landingLanded(pr.prNumber, pr.issue, pr.branch);
    // A successful Landing clears the land Retry budget for this issue (ADR-0011).
    budget.clear(pr.issue, "land");
  } catch (err) {
    const failure = errorMessage(err);
    // Record the failed Landing as an agent-free Manifest entry (no Transcript).
    await appendManifestLine(
      buildFailedManifestEntry({
        runId: issueRunId,
        phase: "land",
        issue: pr.issue,
        branch: pr.branch,
        error: err,
        session: null,
        startedAt,
        endedAt: new Date(),
      })
    );
    events.landingFailed(pr.prNumber, pr.issue, pr.branch, failure);
    // A failed Landing — textual conflict or red suite — spends one merge-phase
    // ("land") Retry-budget attempt (ADR-0011/0012, #98). On exhaustion the
    // PR-shaped gated escalation (strip the `reviewed` gate + revert to draft)
    // hands the PR to a human. Below the threshold, dispatch the Conflict resolver
    // instead of escalating — keep the issue in-flight across the handoff.
    const escalated = await recordFailedAttempt(
      { kind: "pr", prNumber: pr.prNumber, gated: true },
      "land",
      pr.issue,
      failure
    );
    handoff = !escalated;
  } finally {
    lc.done();
    // On a resolver handoff the issue stays in-flight — dispatchResolver clears it
    // when it resolves. Otherwise (landed, or escalated) remove it here.
    if (!handoff) inflight.delete(pr.issue);
    pool.release();
  }
  if (handoff) {
    events.dispatchResolver(pr.prNumber, pr.issue, pr.branch);
    void dispatchResolver(pr); // fire-and-forget; acquires its own Pool slot.
  }
}

/**
 * Dispatch one Conflict resolver for a PR whose Landing failed (CONTEXT.md:
 * Conflict resolver; ADR-0012). Occupies its own Pool slot (acquire) — the issue
 * is already in-flight from the failed Landing that handed off to it, kept so no
 * re-Landing races in. In a **fresh sandbox checked out on the PR branch** (like
 * the Reviewer, decoupled from the Landing's disposed sandbox) it runs
 * resolve-prompt.md: the agent merges `origin/main` INTO the branch, fixes the
 * conflicts / integration breakage until `pnpm typecheck && pnpm test` are green,
 * pushes, and ends its Session with a structured **Outcome** (ADR-0011). The
 * orchestrator parses it and mutates GitHub state itself:
 *
 * - **pass** → {@link requeueResolvedPr}: strip the `reviewed` gate + revert the
 *   PR to draft so it re-enters the ready-for-review bucket and is re-reviewed
 *   before it can land again. The `land` Retry budget is deliberately NOT cleared
 *   — it is the shared merge-phase counter that bounds the
 *   Landing → resolve → review → Landing loop (a successful *Landing* clears it).
 * - **give-up / no parseable Outcome / crash** → spends another merge-phase
 *   (`land`) Retry-budget attempt via {@link recordFailedAttempt}; on exhaustion
 *   the gated escalation hands the PR to a human. Below the threshold the PR stays
 *   ready + `reviewed`, so the next tick re-Lands it (which re-enters this path).
 *
 * Whatever happens, the finally disposes the sandbox, removes the issue from the
 * In-flight set (ownership handed over by the Landing), and frees the Pool slot.
 * The Manifest/Live-feed phase is `resolve`; the runId is issue-derived, shared
 * with impl/rev/land.
 */
async function dispatchResolver(pr: {
  prNumber: number;
  issue: number;
  branch: string;
}): Promise<void> {
  await pool.acquire();
  const issueRunId = generateRunId(pr.issue);
  const label = "resolve #" + pr.issue;
  const lc = lifecycle(label);
  lc.start();
  try {
    await using sandbox = await sandcastle.createSandbox({
      sandbox: dockerSandbox(),
      branch: pr.branch,
      copyToWorktree: ["node_modules"],
      hooks: {
        sandbox: {
          onSandboxReady: [{ command: "pnpm install --frozen-lockfile && pnpm build" }],
        },
      },
    });
    lc.sandbox();

    const result = await recordedRun({
      runId: issueRunId,
      phase: "resolve",
      issue: pr.issue,
      branch: pr.branch,
      // ADR-0011: record the resolver's parsed Outcome in the Manifest entry.
      outcome: (r) => parseOutcome(r.stdout),
      run: () =>
        sandbox.run({
          name: "Conflict resolver #" + pr.issue,
          agent: sandcastle.pi(activeProfile.models.resolver, piSessions),
          promptFile: "./.sandcastle/resolve-prompt.md",
          promptArgs: {
            ISSUE_NUMBER: String(pr.issue),
            ISSUE_TITLE: "Issue #" + pr.issue,
            BRANCH: pr.branch,
          },
          logging: observe(label),
        }),
    });
    events.sessionResolved({
      role: "resolver",
      issue: pr.issue,
      branch: pr.branch,
      status: "ok",
      commits: result.commits.length,
    });

    // ADR-0012: the agent judged; the orchestrator mutates. On pass, re-queue the
    // resolved branch for review; on give-up / no parseable Outcome, spend a
    // merge-phase (`land`) attempt (the shared counter that bounds the loop).
    const outcome = parseOutcome(result.stdout);
    events.resolverOutcome(
      pr.issue,
      outcome?.kind ?? "none",
      outcome?.kind === "give-up" ? outcome.reason : null
    );
    if (outcome?.kind === "pass") {
      await requeueResolvedPr(pr, ghRunner);
      events.resolverRequeued(pr.issue);
    } else {
      const reason =
        outcome?.kind === "give-up" ? outcome.reason : "the resolver produced no parseable Outcome";
      await recordFailedAttempt(
        { kind: "pr", prNumber: pr.prNumber, gated: true },
        "land",
        pr.issue,
        reason
      );
    }
  } catch (err) {
    events.sessionResolved({
      role: "resolver",
      issue: pr.issue,
      branch: pr.branch,
      status: "failed",
      commits: 0,
      error: errorMessage(err),
    });
    // A CRASHED resolver is a failed merge-phase attempt (#98) — same PR-shaped,
    // gated:true escalation on exhaustion as the give-up / no-Outcome case.
    await recordFailedAttempt(
      { kind: "pr", prNumber: pr.prNumber, gated: true },
      "land",
      pr.issue,
      errorMessage(err)
    );
  } finally {
    lc.done();
    inflight.delete(pr.issue);
    pool.release();
  }
}

/**
 * Run the cross-issue Planner in its own dedicated slot (NOT counted against the
 * Pool) and return its emitted, unblocked issues. The Planner re-queries gh
 * itself (see plan-prompt.md); the orchestrator only invokes it when there is
 * actionable work to analyze. Returns `[]` if the Planner produced no plan.
 */
async function runPlanner(): Promise<EmittedIssue[]> {
  const plannerRunId = generateRunId();
  const planLC = lifecycle("planner");
  planLC.start();
  const plan = await recordedRun({
    runId: plannerRunId,
    phase: "planner",
    run: () =>
      sandcastle.run({
        sandbox: dockerSandbox(),
        name: "Planner",
        agent: sandcastle.pi(activeProfile.models.planner, piSessions),
        promptFile: "./.sandcastle/plan-prompt.md",
        logging: observe("planner"),
      }),
  });
  planLC.done();

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    events.plannerNoPlan();
    return [];
  }
  const { issues } = JSON.parse(planMatch[1]) as {
    issues: { number: number; title: string; branch: string }[];
  };
  return issues;
}

// Self-restart on upgrade (ADR-0013, #102). The orchestrator's own code is loaded
// once here at process start, so a later fetch that advances origin/main onto a
// commit touching that code makes the running process stale. We track the SHA the
// code was loaded from; when a fetch moves it onto our own code, we DRAIN — stop
// dispatching, let in-flight Sessions finish — then exit with DRAIN_EXIT_CODE for
// the supervisor (Cockpit) / headless wrapper to respawn on the new code. Seeded
// here so the first detected change diffs against startup.
let lastMainSha = await originMainSha();
let draining = false;
let drainCommit = "";

for (;;) {
  const free = pool.free();
  events.tick(free, POOL_SIZE, inflight.size());

  if (draining) {
    // Draining: dispatch nothing more. In-flight Sessions (fire-and-forget) keep
    // resolving across ticks; the exit gate at the end of the loop fires the
    // moment the In-flight set empties.
  } else if (!shouldQueryBuckets(free)) {
    events.poolFull();
  } else {
    // ADR-0013: fetch origin once per dispatching tick so new branches fork,
    // Landings validate, and Prune gates against a fresh origin/main. A fetch
    // failure skips THIS tick's dispatch rather than proceeding on stale refs —
    // the next tick re-fetches. (Bare fetch: remote-tracking refs only, never the
    // human's local main or working tree.)
    const fetched = await fetchOrigin();
    // ADR-0013 self-restart: with fresh refs in hand, check whether the fetch
    // advanced origin/main onto a commit touching our OWN code before dispatching
    // anything — so no new work starts on stale code the tick an upgrade lands.
    const upgrade = fetched.ok ? await detectOrchestratorUpgrade(lastMainSha) : null;
    if (upgrade !== null) lastMainSha = upgrade.sha;
    if (!fetched.ok) {
      events.fetchFailed(fetched.error);
    } else if (upgrade?.codeChanged) {
      // Our own code changed upstream — begin the drain. Flipping `draining` stops
      // every future tick from dispatching; the event surfaces it in the Live feed.
      draining = true;
      drainCommit = upgrade.shortSha;
      events.drainStarted(drainCommit, inflight.size());
    } else {
      // One ready-for-agent issue query + one PR query feeds all three buckets:
      // the PR list is split into ready-for-merge / ready-for-review, and its
      // issue set excludes ready-for-agent issues that already have an open PR.
      const [readyForAgent, prs] = await Promise.all([queryReadyForAgent(), queryReviewMergePrs()]);
      const openPrIssues = new Set(prs.map((p) => p.issue));
      const readyForMerge = filterReadyForMerge(prs, inflight);
      const readyForReview = filterReadyForReview(prs, inflight);
      const actionable = filterReadyForAgent(readyForAgent, inflight, openPrIssues);

      events.buckets(
        readyForMerge.length,
        readyForReview.length,
        readyForAgent.length,
        actionable.length
      );

      // Priority drain (ADR-0006): fill `free` slots merge → review → implement,
      // so started work lands before new work starts (prevents PR starvation).
      // `remaining` counts slots still free after each bucket drains its share.
      let remaining = free;

      // 1) ready-for-merge — ready + reviewed PRs → one agent-free Landing per PR.
      const landings = pickPrs(readyForMerge, remaining, inflight);
      for (const pr of landings) {
        inflight.add(pr.issue);
        // The Landing emits its own started/landed/failed events (agent-free, not a
        // dispatch/session-resolved Session) — see dispatchLanding.
        void dispatchLanding(pr); // fire-and-forget; resolves across ticks.
      }
      remaining -= landings.length;

      // 2) ready-for-review — draft sandcastle/issue-N PRs without reviewed.
      const reviewers = pickPrs(readyForReview, remaining, inflight);
      for (const pr of reviewers) {
        inflight.add(pr.issue);
        events.dispatchReviewer(pr.prNumber, pr.issue, pr.branch);
        void dispatchReviewer(pr);
      }
      remaining -= reviewers.length;

      // 3) ready-for-agent — the implement stage runs ONLY when actionable issues
      // exist AND a slot remains after merge+review draining (don't spend a slot
      // on work we can't start). The Plan cache (ADR-0010) skips the Opus Planner
      // while the RAW ready-for-agent set is unchanged: `resolvePlanEmit` keys on
      // `readyForAgent` (the pre-filter query result, NOT `actionable` — else the
      // cache goes stale when a blocker merges out), reuses the cached emit on a
      // hit, and re-invokes the Planner only on a miss. Either way the pure
      // dispatch below runs over the emit, so a capped emit still drains on later
      // ticks (no starvation). `pickImplementers` caps at `remaining`.
      if (shouldRunPlanner(actionable, remaining)) {
        try {
          const resolved = await resolvePlanEmit(readyForAgent, planCache, runPlanner);
          planCache = resolved.cache;
          if (resolved.plannerRan) {
            events.plannerEmitted(resolved.emit.length);
          } else {
            events.planReused(resolved.emit.length);
          }

          // The Planner re-queries gh, so it can emit an issue that just got a PR
          // this tick — drop those before dispatching. (In-flight dedupe + the
          // remaining-slot cap happen in pickImplementers.)
          const dispatchable = resolved.emit.filter((i) => !openPrIssues.has(i.number));
          const toDispatch = pickImplementers(dispatchable, remaining, inflight);

          for (const issue of toDispatch) {
            inflight.add(issue.number);
            events.dispatchImplementer(issue.number, issue.title, issue.branch);
            void dispatchImplementer(issue);
          }
        } catch (err) {
          events.plannerFailed(errorMessage(err));
        }
      } else {
        events.plannerSkipped();
      }
    }
  }

  // ADR-0013 self-restart exit gate: once draining, leave the moment the In-flight
  // set empties — every dispatched Session has run to completion — exiting with the
  // distinct DRAIN_EXIT_CODE the supervisor / headless wrapper recognize to respawn
  // on the new code. Checked here (not only at the top) so a drain that begins with
  // nothing in flight exits this same tick rather than idling a full interval. The
  // restart is benign by design: the empty In-flight set is accurate, the Plan
  // cache re-plans once, and Retry budgets reset (ADR-0006/0010/0011).
  if (draining && inflight.size() === 0) {
    events.drainComplete(drainCommit);
    process.exit(DRAIN_EXIT_CODE);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
