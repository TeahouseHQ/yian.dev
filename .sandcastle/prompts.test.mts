import { readFileSync } from "node:fs";
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
 * - **merge-prompt.md** still owns its give-up path in the prompt (the Merger →
 *   Landing move is ADR-0012, a separate issue); its tests are unchanged.
 */
const reviewPrompt = readFileSync(new URL("./review-prompt.md", import.meta.url), "utf8");
const mergePrompt = readFileSync(new URL("./merge-prompt.md", import.meta.url), "utf8");

/**
 * Slice a top-level (`# `) markdown section, from its heading up to (but not
 * including) the next top-level heading. Body cross-references like "follow
 * the GIVE-UP PATH" never start with `# `, and fenced code never begins a line
 * with `# `, so this cleanly bounds the section under test.
 */
function topSection(md: string, heading: string): string {
  const needle = `# ${heading}`;
  const start = md.indexOf(needle);
  expect(start, `heading "${needle}" should exist`).toBeGreaterThan(-1);
  const next = md.indexOf("\n# ", start + needle.length);
  return next === -1 ? md.slice(start) : md.slice(start, next);
}

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

describe("merge-prompt.md — ready-for-human give-up path", () => {
  const giveUp = topSection(mergePrompt, "GIVE-UP PATH");

  it("exists as its own section", () => {
    expect(giveUp.length).toBeGreaterThan(0);
  });

  it("triggers on failed test-then-merge (red) or merge conflicts", () => {
    expect(giveUp).toMatch(/conflict/i);
    expect(giveUp).toMatch(/typecheck|test/i);
  });

  it("removes the reviewed label", () => {
    expect(giveUp).toMatch(/--remove-label reviewed/);
  });

  it("reverts the PR to draft", () => {
    expect(giveUp).toMatch(/gh pr ready --undo/);
    expect(giveUp).toMatch(/draft/i);
  });

  it("adds the ready-for-human label", () => {
    expect(giveUp).toMatch(/--add-label ready-for-human/);
  });

  it("posts a COMMENT explaining what failed", () => {
    expect(giveUp).toMatch(/gh pr review .* --comment/);
  });

  it("does not merge an escalated PR", () => {
    // Prose negation avoids the literal command string.
    expect(giveUp).not.toMatch(/gh pr merge/);
  });

  it("uses the CONTEXT.md ready-for-human semantics", () => {
    expect(giveUp).toMatch(/out of all Dispatch buckets; a human owns it/i);
  });
});
