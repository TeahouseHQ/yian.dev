import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { lifecycle, observe } from "./observability.mts";

const MAX_ITERATIONS = 10;
const MAX_PARALLEL = 3;

const DEFAULT_MODEL = "litellm/glm-5.1";
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

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // Phase 1: Plan — orchestrator agent analyzes issues and picks parallelizable work
  const planLC = lifecycle("planner");
  planLC.start();
  const plan = await sandcastle.run({
    sandbox: dockerSandbox(),
    name: "Planner",
    agent: sandcastle.pi(MODELS.PLANNING),
    promptFile: "./.sandcastle/plan-prompt.md",
    logging: observe("planner"),
  });
  planLC.done();

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    throw new Error("Orchestrator did not produce a <plan> tag.\n\n" + plan.stdout);
  }

  const { issues } = JSON.parse(planMatch[1]) as {
    issues: { number: number; title: string; branch: string }[];
  };

  if (issues.length === 0) {
    console.log("No issues to work on. Exiting.");
    break;
  }

  console.log(`Planning complete. ${issues.length} issue(s) to work in parallel:`);
  for (const issue of issues) {
    console.log(`  #${issue.number}: ${issue.title} → ${issue.branch}`);
  }

  // Phase 2: Execute + Review — implement then review each branch, max 4 in parallel
  let running = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    running < MAX_PARALLEL
      ? (running++, Promise.resolve())
      : new Promise<void>((resolve) => queue.push(resolve));
  const release = () => {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  };

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      await acquire();
      try {
        const implLabel = "impl #" + issue.number;
        const implLC = lifecycle(implLabel);
        implLC.start();

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

        const result = await sandbox.run({
          name: "Implementer #" + issue.number,
          agent: sandcastle.pi(MODELS.IMPLEMENTATION),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            ISSUE_NUMBER: String(issue.number),
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
          logging: observe(implLabel),
        });
        implLC.commits(result.commits.length);
        implLC.done();

        if (result.commits.length > 0) {
          const revLabel = "rev #" + issue.number;
          const revLC = lifecycle(revLabel);
          revLC.start();
          const review = await sandbox.run({
            name: "Reviewer #" + issue.number,
            agent: sandcastle.pi(MODELS.REVIEW),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              ISSUE_NUMBER: String(issue.number),
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            },
            logging: observe(revLabel),
          });
          revLC.commits(review.commits.length);
          revLC.done();
        }

        return result;
      } finally {
        release();
      }
    })
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(`  ✗ #${issues[i].number} (${issues[i].branch}) failed: ${outcome.reason}`);
    }
  }

  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i] }))
    .filter(
      (
        entry
      ): entry is {
        outcome: PromiseFulfilledResult<Awaited<ReturnType<typeof sandcastle.run>>>;
        issue: (typeof issues)[number];
      } => entry.outcome.status === "fulfilled" && entry.outcome.value.commits.length > 0
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(`\nExecution complete. ${completedBranches.length} branch(es) with commits:`);
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // Phase 3: Merge — one agent merges all branches together
  const mergeLC = lifecycle("merger");
  mergeLC.start();
  await sandcastle.run({
    sandbox: dockerSandbox(),
    name: "Merger",
    maxIterations: 10,
    agent: sandcastle.pi(MODELS.MERGE),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues.map((i) => `- #${i.number}: ${i.title}`).join("\n"),
    },
    logging: observe("merger"),
  });
  mergeLC.done();

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
