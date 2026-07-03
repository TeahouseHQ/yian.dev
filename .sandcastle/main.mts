import { execFile } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { promisify } from "node:util";
import {
  createInflight,
  createPool,
  filterReadyForAgent,
  handleImplementerOutcome,
  pickImplementers,
  POLL_INTERVAL_MS,
  POOL_SIZE,
  shouldQueryBuckets,
  shouldRunPlanner,
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
    console.error(`  ⚠ gh ${args.join(" ")} failed: ${errorMessage(err)}`);
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
 * Issue numbers that already have an open `sandcastle/issue-N` PR — the
 * ready-for-agent bucket excludes these (an Implementer already opened a draft).
 * The branch name is the deterministic link back to the issue number.
 */
async function queryOpenPrIssues(): Promise<Set<number>> {
  const out = await ghOr("[]", [
    "pr",
    "list",
    "--state",
    "open",
    "--json",
    "number,headRefName",
    "--limit",
    "200",
  ]);
  const rows = JSON.parse(out || "[]") as { number: number; headRefName: string }[];
  const open = new Set<number>();
  for (const r of rows) {
    const m = r.headRefName.match(/^sandcastle\/issue-(\d+)$/);
    if (m) open.add(Number(m[1]));
  }
  return open;
}

/** The escalation `gh` runner handed to `handleImplementerOutcome`. */
const escalateGh = { run: async (args: string[]) => void (await gh(args)) };

// ── The persistent shared-pool orchestrator (ADR-0006) ──────────────────────
//
// One shared concurrency Pool of POOL_SIZE (only Implementers consume it in this
// slice; review/merge join it in the follow-up), one In-flight set keyed by
// issue number, and a Poll tick that never self-exits. Each tick: if the Pool is
// full, skip the gh query entirely; otherwise query the ready-for-agent bucket,
// run the Planner in its own (Pool-exempt) slot only when there is actionable
// work AND a free slot, and dispatch up to `free` Implementers (each opening a
// draft PR). A no-op Implementer is escalated to ready-for-human so it is not
// re-dispatched. This slice leaves draft PRs un-reviewed/un-merged on purpose —
// the review+merge slice wires those buckets next.
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

    // No-op terminal handling (ADR-0006): zero commits → no draft PR → strip
    // ready-for-agent, add ready-for-human, comment, so it is not re-dispatched.
    const escalated = await handleImplementerOutcome(
      issue.number,
      result.commits.length,
      escalateGh
    );
    if (escalated) {
      console.log(`  ⚠ #${issue.number} produced no commits — escalated to ready-for-human.`);
    }
  } catch (err) {
    console.error(`  ✗ #${issue.number} (${issue.branch}) failed: ${errorMessage(err)}`);
  } finally {
    implLC.done();
    inflight.delete(issue.number);
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
    console.error("Planner did not produce a <plan> tag.");
    return [];
  }
  const { issues } = JSON.parse(planMatch[1]) as {
    issues: { number: number; title: string; branch: string }[];
  };
  return issues;
}

for (;;) {
  const free = pool.free();
  console.log(`\n=== Poll tick — ${free}/${POOL_SIZE} Pool slots free, ${inflight.size()} in-flight ===\n`);

  if (!shouldQueryBuckets(free)) {
    console.log("Pool full — skipping gh query this tick.");
  } else {
    const [readyForAgent, openPrIssues] = await Promise.all([
      queryReadyForAgent(),
      queryOpenPrIssues(),
    ]);
    const actionable = filterReadyForAgent(readyForAgent, inflight, openPrIssues);

    console.log(
      `ready-for-agent bucket: ${readyForAgent.length} labeled, ${actionable.length} actionable ` +
        `(${readyForAgent.length - actionable.length} excluded by open-PR / ready-for-human / in-flight).`
    );

    if (shouldRunPlanner(actionable, free)) {
      try {
        const emitted = await runPlanner();
        console.log(`Planner emitted ${emitted.length} unblocked issue(s).`);

        // The Planner re-queries gh, so it can emit an issue that just got a PR
        // this tick — drop those before dispatching. (In-flight dedupe + the
        // free-slot cap happen in pickImplementers.)
        const dispatchable = emitted.filter((i) => !openPrIssues.has(i.number));
        const toDispatch = pickImplementers(dispatchable, free, inflight);

        for (const issue of toDispatch) {
          inflight.add(issue.number);
          console.log(`  → dispatching Implementer for #${issue.number}: ${issue.title} → ${issue.branch}`);
          // Fire-and-forget: the Session runs across ticks and removes itself
          // from the In-flight set + frees its Pool slot on resolution.
          void dispatchImplementer(issue);
        }
      } catch (err) {
        console.error(`Planner failed: ${errorMessage(err)}`);
      }
    } else {
      console.log("Nothing actionable or no free slot — skipping Planner this tick.");
    }
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
