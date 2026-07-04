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
  issueFromBranch,
  pickImplementers,
  pickPrs,
  POLL_INTERVAL_MS,
  POOL_SIZE,
  shouldQueryBuckets,
  shouldRunPlanner,
  type BucketPr,
  type ReadyForAgentIssue,
} from "./dispatch.mts";
import {
  appendManifestLine,
  buildFailedManifestEntry,
  buildManifestEntry,
  generateRunId,
  lifecycle,
  observe,
  sessionsDir,
  type RunLike,
} from "./observability.mts";
import { createEvents } from "./events.mts";

const execFileAsync = promisify(execFile);

const MODELS = {
  PLANNING: "claude-opus-4-8",
  IMPLEMENTATION: "litellm/glm-5.1",
  REVIEW: "claude-opus-4-8",
  MERGE: "claude-opus-4-8",
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
// Implementer/Reviewer/Merger share an issue-derived run-issue-<n> (CONTEXT.md: Run).
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
      })
    );
    return result;
  } catch (error) {
    await appendManifestLine(
      buildFailedManifestEntry({
        runId: args.runId,
        phase: args.phase,
        issue: args.issue,
        branch: args.branch,
        error,
        startedAt,
        endedAt: new Date(),
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
    "number,title,labels",
  ]);
  const rows = JSON.parse(out || "[]") as {
    number: number;
    title: string;
    labels: { name: string }[];
  }[];
  return rows.map((r) => ({
    number: r.number,
    title: r.title,
    labels: r.labels.map((l) => l.name),
  }));
}

/**
 * All open `sandcastle/issue-N` PRs with their draft state and labels — the
 * raw input for both the `ready-for-merge` and `ready-for-review` Dispatch
 * buckets (split by `filterReadyForMerge` / `filterReadyForReview`), AND the
 * source of the open-PR issue set that excludes `ready-for-agent` issues from
 * the implement bucket. One `gh pr list` query feeds all three concerns. Only
 * `sandcastle/issue-N` branches are kept; the branch is parsed back to the
 * issue number so a Reviewer/Merger shares the issue-derived `runId` and
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

/** The escalation `gh` runner handed to `handleImplementerOutcome`. */
const escalateGh = { run: async (args: string[]) => void (await gh(args)) };

/** The typed orchestrator event stream (ADR-0008): every progress moment
 *  flows through this one emitter as a discriminated union, with a prose
 *  renderer (default, headless output unchanged) and an NDJSON renderer
 *  (`SANDCASTLE_EVENT_FORMAT=ndjson`, for the supervising Cockpit). Replaces
 *  the ad-hoc `console.log`s that used to be scattered through this file. */
const events = createEvents();

// ── The persistent shared-pool orchestrator (ADR-0006) ──────────────────────
//
// One shared concurrency Pool of POOL_SIZE consumed by all three roles
// (Implementer, Reviewer, Merger), one In-flight set keyed by issue number, and
// a Poll tick that never self-exits. Each tick: if the Pool is full, skip the
// gh query entirely; otherwise query all three Dispatch buckets and fill `free`
// slots in strict priority **merge → review → implement** (started work lands
// before new work starts, which prevents PR starvation). The Planner runs in its
// own (Pool-exempt) slot only when actionable `ready-for-agent` issues exist AND
// a slot remains free after merge+review draining. Reviewers/Mergers each build
// their own fresh sandbox (impl and review are decoupled across ticks) and run
// the issue-derived `runId`. A no-op Implementer is escalated to ready-for-human
// so it is not re-dispatched; Reviewer/Merger give-up paths live in the prompts (#65).
const pool = createPool(POOL_SIZE);
const inflight = createInflight();

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
    await using sandbox = await sandcastle.createSandbox({
      sandbox: dockerSandbox(),
      branch: issue.branch,
      copyToWorktree: ["node_modules"],
      hooks: {
        sandbox: {
          // pnpm with a frozen lockfile: this repo is pnpm-only (pnpm-lock.yaml,
          // no package-lock.json), so `npm install` would generate a competing
          // lockfile and resolve deps differently. --frozen-lockfile keeps sandbox
          // installs reproducible and fast against the committed pnpm-lock.yaml.
          onSandboxReady: [{ command: "pnpm install --frozen-lockfile && pnpm build" }],
        },
      },
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
    const escalated = await handleImplementerOutcome(
      issue.number,
      result.commits.length,
      escalateGh
    );
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
 * and runs review-prompt.md. The Reviewer commits fixes itself (Model A) and,
 * when the change passes, opens the REVIEW GATE (adds `reviewed`, flips the PR
 * draft → ready) so the Merger can land it; its give-up path escalates to
 * `ready-for-human` inside the prompt (#65). Whatever happens, the finally
 * disposes the sandbox, removes the issue from the In-flight set, and frees the
 * Pool slot. The runId is issue-derived, shared with the issue's impl/merger.
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
 * Dispatch one Merger for a ready + `reviewed` PR into the shared Pool
 * (ADR-0006: Per-PR Mergers, not a batch Merger). Occupies a slot (acquire),
 * marks the issue in-flight, and runs merge-prompt.md in a **fresh sandbox**
 * (top-level `sandcastle.run` with an explicit `branch` strategy, so it works in
 * an ISOLATED throwaway worktree forked from main instead of head mode — the
 * Merger must never mutate the host's live `main`, see below) that re-runs
 * install+build. The Merger does test-then-merge
 * (`git merge <branch>` → `pnpm typecheck && pnpm test` → `gh pr merge --merge`);
 * its give-up path reverts the PR to draft + `ready-for-human` inside the prompt
 * (#65). Whatever happens, the finally removes the issue from the In-flight set
 * and frees the Pool slot. The runId is issue-derived, shared with impl/rev.
 */
async function dispatchMerger(pr: {
  prNumber: number;
  issue: number;
  branch: string;
}): Promise<void> {
  await pool.acquire();
  const issueRunId = generateRunId(pr.issue);
  const label = "merger #" + pr.issue;
  const lc = lifecycle(label);
  lc.start();
  try {
    const result = await recordedRun({
      runId: issueRunId,
      phase: "merger",
      issue: pr.issue,
      branch: pr.branch,
      run: () =>
        sandcastle.run({
          sandbox: dockerSandbox(),
          // Run the Merger in an ISOLATED worktree, NOT head mode. A bind-mount
          // provider (docker) defaults to the "head" strategy, which bind-mounts
          // the host repo directly — so the Merger's validation `git merge
          // <branch>` (merge-prompt.md step 1) would mutate your real local
          // `main`, fast-forwarding it and leaving it diverged from the
          // server-side `gh pr merge --merge` commit. The "branch" strategy checks
          // out a throwaway branch forked from main in a separate worktree: the
          // local test-merge happens there and is discarded when the worktree is
          // torn down, while the actual landing stays server-side via
          // `gh pr merge`. (Leftover local `sandcastle/merge-*` refs are cleaned
          // by `pnpm sandcastle:prune`.)
          branchStrategy: {
            type: "branch",
            branch: `sandcastle/merge-${pr.issue}`,
            baseBranch: "main",
          },
          copyToWorktree: ["node_modules"],
          hooks: {
            sandbox: {
              onSandboxReady: [{ command: "pnpm install --frozen-lockfile && pnpm build" }],
            },
          },
          name: "Merger #" + pr.issue,
          maxIterations: 10,
          agent: sandcastle.pi(MODELS.MERGE, piSessions),
          promptFile: "./.sandcastle/merge-prompt.md",
          promptArgs: {
            BRANCHES: `- ${pr.branch}`,
            ISSUES: `- #${pr.issue}: Issue #${pr.issue}`,
          },
          logging: observe(label),
        }),
    });
    events.sessionResolved({
      role: "merger",
      issue: pr.issue,
      branch: pr.branch,
      status: "ok",
      commits: result.commits.length,
    });
  } catch (err) {
    events.sessionResolved({
      role: "merger",
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
 * Run the cross-issue Planner in its own dedicated slot (NOT counted against the
 * Pool) and return its emitted, unblocked issues. The Planner re-queries gh
 * itself (see plan-prompt.md); the orchestrator only invokes it when there is
 * actionable work to analyze. Returns `[]` if the Planner produced no plan.
 */
async function runPlanner(): Promise<{ number: number; title: string; branch: string }[]> {
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

    // 1) ready-for-merge — ready + reviewed PRs → one Merger per PR.
    const mergers = pickPrs(readyForMerge, remaining, inflight);
    for (const pr of mergers) {
      inflight.add(pr.issue);
      events.dispatchMerger(pr.prNumber, pr.issue, pr.branch);
      void dispatchMerger(pr); // fire-and-forget; resolves across ticks.
    }
    remaining -= mergers.length;

    // 2) ready-for-review — draft sandcastle/issue-N PRs without reviewed.
    const reviewers = pickPrs(readyForReview, remaining, inflight);
    for (const pr of reviewers) {
      inflight.add(pr.issue);
      events.dispatchReviewer(pr.prNumber, pr.issue, pr.branch);
      void dispatchReviewer(pr);
    }
    remaining -= reviewers.length;

    // 3) ready-for-agent — the Planner runs in its own Pool-exempt slot ONLY
    // when actionable issues exist AND a slot remains after merge+review
    // draining (don't spend Opus on a plan we can't dispatch). It re-plans
    // every eligible tick (no caching); pickImplementers caps at `remaining`.
    if (shouldRunPlanner(actionable, remaining)) {
      try {
        const emitted = await runPlanner();
        events.plannerEmitted(emitted.length);

        // The Planner re-queries gh, so it can emit an issue that just got a PR
        // this tick — drop those before dispatching. (In-flight dedupe + the
        // remaining-slot cap happen in pickImplementers.)
        const dispatchable = emitted.filter((i) => !openPrIssues.has(i.number));
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

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
