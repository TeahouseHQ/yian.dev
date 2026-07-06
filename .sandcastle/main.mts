import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  createInflight,
  createPool,
  filterReadyForAgent,
  filterReadyForMerge,
  filterReadyForReview,
  handleImplementerOutcome,
  handleLandingFailure,
  handleReviewerOutcome,
  implementerSandboxSpec,
  issueFromBranch,
  landingSandboxSpec,
  parseOutcome,
  pickImplementers,
  pickPrs,
  POLL_INTERVAL_MS,
  POOL_SIZE,
  resolvePlanEmit,
  shouldQueryBuckets,
  shouldRunPlanner,
  type BucketPr,
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

const execFileAsync = promisify(execFile);

// The merge phase (Landing) is agent-free and spends zero tokens (ADR-0012), so
// it has no model entry — only the three agent roles do.
const MODELS = {
  PLANNING: "claude-opus-4-8",
  IMPLEMENTATION: "litellm/glm-5.1",
  REVIEW: "claude-opus-4-8",
};

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
// `gh pr merge` itself, escalating a failed Landing to ready-for-human (ADR-0012).
const pool = createPool(POOL_SIZE);
const inflight = createInflight();

// The Plan cache (ADR-0010): the Planner's last emit list keyed by a
// content-hash of the raw `ready-for-agent` set. In-memory / non-durable (cold
// after restart → one re-plan), living beside the In-flight set. While the key
// is unchanged, the implement stage dispatches from `planCache.emit` with no
// Opus Planner call; `resolvePlanEmit` re-invokes the Planner only on a miss.
let planCache: PlanCache = null;

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
          agent: sandcastle.pi(MODELS.IMPLEMENTATION, piSessions),
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
          agent: sandcastle.pi(MODELS.REVIEW, piSessions),
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
    // left for re-dispatch (a Retry-budget attempt in a follow-up issue).
    const outcome = parseOutcome(result.stdout);
    events.reviewerOutcome(
      pr.issue,
      outcome?.kind ?? "none",
      outcome?.kind === "give-up" ? outcome.reason : null
    );
    if (outcome) {
      const transition = await handleReviewerOutcome(outcome, pr, ghRunner);
      events.reviewTransition(pr.issue, transition);
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
 * `reviewed` PR is escalated to `ready-for-human` via {@link handleLandingFailure}
 * (the crash-safe PR-shaped transition runner: terminal label first, then strip
 * `reviewed`/ready, then comment the failure output). A follow-up replaces this
 * escalation with the Conflict resolver dispatch, and the Retry budget makes
 * failed Landings spend attempts (ADR-0012). Whatever happens, the finally
 * disposes the sandbox, removes the issue from the In-flight set, and frees the
 * Pool slot. The runId is issue-derived, shared with impl/rev.
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
    // Escalate the ready + reviewed PR to a human (crash-safe transition runner).
    // Best-effort: a gh failure here must not crash the orchestrator loop.
    try {
      await handleLandingFailure({ prNumber: pr.prNumber }, failure, ghRunner);
    } catch (escErr) {
      events.ghError(["landing-escalate", String(pr.prNumber)], errorMessage(escErr));
    }
    events.landingFailed(pr.prNumber, pr.issue, pr.branch, failure);
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
        agent: sandcastle.pi(MODELS.PLANNING, piSessions),
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

for (;;) {
  const free = pool.free();
  events.tick(free, POOL_SIZE, inflight.size());

  if (!shouldQueryBuckets(free)) {
    events.poolFull();
  } else {
    // ADR-0013: fetch origin once per dispatching tick so new branches fork,
    // Landings validate, and Prune gates against a fresh origin/main. A fetch
    // failure skips THIS tick's dispatch rather than proceeding on stale refs —
    // the next tick re-fetches. (Bare fetch: remote-tracking refs only, never the
    // human's local main or working tree.)
    const fetched = await fetchOrigin();
    if (!fetched.ok) {
      events.fetchFailed(fetched.error);
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

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
