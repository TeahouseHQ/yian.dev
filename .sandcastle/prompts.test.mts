import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Prompt-contract tests. They read the prompt source directly (no agent run
 * required), the same way theme.test pins CSS/colour wiring.
 *
 * - **review-prompt.md** now follows the **Outcome contract** (ADR-0011, #96):
 *   the Reviewer no longer runs `gh` to flip labels/draft state; it reviews,
 *   commits fixes (Model A), posts a prose review-summary comment, and ends its
 *   Session with a structured `<outcome>` tag the orchestrator acts on. These
 *   tests pin that tag contract and assert the dispatch-controlling `gh`
 *   commands are gone.
 * - **merge-prompt.md is gone** (ADR-0012, #97): the merge phase is the
 *   agent-free **Landing**, fully scripted orchestrator code with no prompt.
 *   The test below pins that the prompt file no longer exists.
 */
const reviewPrompt = readFileSync(new URL("./review-prompt.md", import.meta.url), "utf8");
const resolvePrompt = readFileSync(new URL("./resolve-prompt.md", import.meta.url), "utf8");

describe("review-prompt.md — Outcome contract (ADR-0011)", () => {
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
    expect(existsSync(new URL("./merge-prompt.md", import.meta.url))).toBe(false);
  });
});

describe("resolve-prompt.md — Conflict resolver (ADR-0012, #101)", () => {
  it("instructs merging origin/main INTO the PR branch (not the other direction)", () => {
    expect(resolvePrompt).toMatch(/git merge origin\/main/);
  });

  it("instructs pushing the resolved branch back to the PR", () => {
    expect(resolvePrompt).toMatch(/git push/);
  });

  it("instructs the resolver to fix until the suite is green (typecheck + test)", () => {
    expect(resolvePrompt).toMatch(/pnpm typecheck/);
    expect(resolvePrompt).toMatch(/pnpm test/);
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
