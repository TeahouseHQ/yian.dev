import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadRepoProfile, verifyCommand } from "./repo-profile.mts";

/**
 * Prompt-contract tests. They read the prompt source directly (no agent run
 * required), the same way theme.test pins CSS/colour wiring.
 *
 * Two layers now:
 *  - **Outcome contract** (ADR-0011/0012): the Reviewer / Conflict resolver report
 *    a structured `<outcome>` and run no dispatch-controlling `gh`.
 *  - **Repo-profile parameterisation** (ADR-0014, #108): the verify commands, the
 *    coding-standards path, the base branch, and the branch prefix are NO LONGER
 *    literals baked into the prompt bodies — they arrive as `{{…}}` template params
 *    (the same mechanism as ISSUE_NUMBER/BRANCH), rendered from the Repo profile at
 *    dispatch. So no prompt may contain a raw `pnpm` command or a `sandcastle/`
 *    branch prefix (the "engine grep for pnpm comes up empty outside the profile"
 *    acceptance criterion), and a prompt rendered with the shipped profile must
 *    contain that profile's actual verify command / standards path / base branch.
 */
const url = (name: string) => new URL(`./${name}`, import.meta.url);
const read = (name: string) => readFileSync(url(name), "utf8");

const implementPrompt = read("implement-prompt.md");
const reviewPrompt = read("review-prompt.md");
const resolvePrompt = read("resolve-prompt.md");
const planPrompt = read("plan-prompt.md");

const profile = loadRepoProfile();

/** Substitute `{{VAR}}` placeholders the way the sandcastle prompt loader does, so
 *  a test can assert on the RENDERED prompt an agent actually receives. */
function render(source: string, args: Record<string, string>): string {
  return source.replace(/\{\{(\w+)\}\}/g, (whole, key) => args[key] ?? whole);
}

/** The repo-fact args main.mts injects, sourced from the profile. */
const repoArgs = {
  VERIFY_COMMAND: verifyCommand(profile),
  STANDARDS_PATH: profile.codingStandardsPath,
  BASE_BRANCH: profile.baseBranch,
  BRANCH_PREFIX: profile.branchPrefix,
};

describe("no prompt embeds a repo-fact literal (ADR-0014, #108)", () => {
  const prompts = {
    "implement-prompt.md": implementPrompt,
    "review-prompt.md": reviewPrompt,
    "resolve-prompt.md": resolvePrompt,
    "plan-prompt.md": planPrompt,
  };

  for (const [name, body] of Object.entries(prompts)) {
    it(`${name} contains no literal pnpm command (verify commands are templated)`, () => {
      expect(body).not.toMatch(/pnpm/);
    });

    it(`${name} contains no literal sandcastle/ branch prefix (the prefix is templated)`, () => {
      expect(body).not.toMatch(/sandcastle\//);
    });
  }
});

describe("implement-prompt.md — profile-parameterised (#108)", () => {
  it("receives the verify command and base branch as template params", () => {
    expect(implementPrompt).toMatch(/\{\{VERIFY_COMMAND\}\}/);
    expect(implementPrompt).toMatch(/\{\{BASE_BRANCH\}\}/);
  });

  it("renders the profile's verify command and base branch", () => {
    const rendered = render(implementPrompt, {
      ...repoArgs,
      ISSUE_NUMBER: "42",
      ISSUE_TITLE: "T",
      BRANCH: "teahouse/issue-42",
    });
    expect(rendered).toContain("pnpm typecheck && pnpm test");
    expect(rendered).toContain("--base main");
  });
});

describe("review-prompt.md — Outcome contract (ADR-0011) + profile params (#108)", () => {
  it("instructs a pass verdict via the <outcome>pass</outcome> tag", () => {
    expect(reviewPrompt).toMatch(/<outcome>pass<\/outcome>/);
  });

  it("instructs a give-up verdict with a one-line reason via the outcome tag", () => {
    expect(reviewPrompt).toMatch(/<outcome>give-up: .*<\/outcome>/);
  });

  it("triggers give-up when the Reviewer cannot make the change pass", () => {
    expect(reviewPrompt).toMatch(/cannot make the change pass/i);
  });

  it("still commits fixes itself (Model A)", () => {
    expect(reviewPrompt).toMatch(/RALPH: Review/);
  });

  it("still posts a prose review-summary comment (a comment is not dispatch-controlling)", () => {
    expect(reviewPrompt).toMatch(/gh pr review .* --comment/);
  });

  it("receives the verify command, standards path, and base branch as template params", () => {
    expect(reviewPrompt).toMatch(/\{\{VERIFY_COMMAND\}\}/);
    expect(reviewPrompt).toMatch(/\{\{STANDARDS_PATH\}\}/);
    expect(reviewPrompt).toMatch(/\{\{BASE_BRANCH\}\}/);
  });

  it("renders the profile's verify command, standards path, and diff base", () => {
    const rendered = render(reviewPrompt, {
      ...repoArgs,
      ISSUE_NUMBER: "42",
      ISSUE_TITLE: "T",
      BRANCH: "b",
    });
    expect(rendered).toContain("pnpm typecheck && pnpm test");
    expect(rendered).toContain("@.sandcastle/CODING_STANDARDS.md");
    expect(rendered).toContain("git diff main..HEAD");
  });

  it("contains no label, draft-flip, or merge commands — the orchestrator owns those (ADR-0011)", () => {
    expect(reviewPrompt).not.toMatch(/--add-label/);
    expect(reviewPrompt).not.toMatch(/--remove-label/);
    expect(reviewPrompt).not.toMatch(/gh label create/);
    expect(reviewPrompt).not.toMatch(/gh pr ready/);
    expect(reviewPrompt).not.toMatch(/gh pr merge/);
  });

  it("does not tell the agent to touch the reviewed / ready-for-human labels", () => {
    expect(reviewPrompt).not.toMatch(/ready-for-human/);
    expect(reviewPrompt).not.toMatch(/`reviewed`/);
  });
});

describe("merge-prompt.md — deleted for the agent-free Landing (ADR-0012)", () => {
  it("no longer exists: the merge phase is scripted orchestrator code, not a prompt", () => {
    expect(existsSync(url("merge-prompt.md"))).toBe(false);
  });
});

describe("resolve-prompt.md — Conflict resolver (ADR-0012, #101) + profile params (#108)", () => {
  it("instructs merging the fork base INTO the PR branch (not the other direction)", () => {
    expect(resolvePrompt).toMatch(/git merge origin\/\{\{BASE_BRANCH\}\}/);
    const rendered = render(resolvePrompt, {
      ...repoArgs,
      ISSUE_NUMBER: "1",
      ISSUE_TITLE: "T",
      BRANCH: "b",
    });
    expect(rendered).toContain("git merge origin/main");
  });

  it("instructs pushing the resolved branch back to the PR", () => {
    expect(resolvePrompt).toMatch(/git push/);
  });

  it("fixes until green via the profile's verify command (templated, no pnpm literal)", () => {
    expect(resolvePrompt).toMatch(/\{\{VERIFY_COMMAND\}\}/);
    const rendered = render(resolvePrompt, {
      ...repoArgs,
      ISSUE_NUMBER: "1",
      ISSUE_TITLE: "T",
      BRANCH: "b",
    });
    expect(rendered).toContain("pnpm typecheck && pnpm test");
  });

  it("reports a pass verdict via the <outcome>pass</outcome> tag", () => {
    expect(resolvePrompt).toMatch(/<outcome>pass<\/outcome>/);
  });

  it("reports a give-up verdict with a one-line reason via the outcome tag", () => {
    expect(resolvePrompt).toMatch(/<outcome>give-up: .*<\/outcome>/);
  });

  it("contains no dispatch-controlling gh mutations — the orchestrator owns those (ADR-0011)", () => {
    expect(resolvePrompt).not.toMatch(/--add-label/);
    expect(resolvePrompt).not.toMatch(/--remove-label/);
    expect(resolvePrompt).not.toMatch(/gh label create/);
    expect(resolvePrompt).not.toMatch(/gh pr ready/);
    expect(resolvePrompt).not.toMatch(/gh pr merge/);
  });

  it("does not tell the agent to touch the reviewed / ready-for-human labels", () => {
    expect(resolvePrompt).not.toMatch(/ready-for-human/);
    expect(resolvePrompt).not.toMatch(/`reviewed`/);
  });
});

describe("plan-prompt.md — branch prefix parameterised (#108)", () => {
  it("receives the branch prefix as a template param instead of a hardcoded prefix", () => {
    expect(planPrompt).toMatch(/\{\{BRANCH_PREFIX\}\}/);
  });

  it("renders the profile's prefix into the deterministic branch-name format", () => {
    const rendered = render(planPrompt, repoArgs);
    expect(rendered).toContain("teahouse/issue-");
  });
});
