import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #65 — give the Reviewer and Merger prompts a durable `ready-for-human`
 * escape hatch so the upcoming persistent poller can't re-dispatch
 * un-actionable work forever (ADR-0006). A persistent loop re-sees the same
 * PR every tick, so every give-up path must durably change GitHub state.
 *
 * These tests pin the wording/commands the two prompts must contain (and the
 * ones they must NOT) when an item escalates to `ready-for-human`. They read
 * the prompt source directly (no agent run required), the same way theme.test
 * pins CSS/colour wiring.
 */
const reviewPrompt = readFileSync(
  new URL("./review-prompt.md", import.meta.url),
  "utf8"
);
const mergePrompt = readFileSync(
  new URL("./merge-prompt.md", import.meta.url),
  "utf8"
);

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

describe("review-prompt.md — ready-for-human give-up path", () => {
  const giveUp = topSection(reviewPrompt, "GIVE-UP PATH");

  it("exists as its own section", () => {
    expect(giveUp.length).toBeGreaterThan(0);
  });

  it("triggers when the Reviewer cannot make the change pass", () => {
    expect(giveUp).toMatch(/cannot make the change pass/i);
  });

  it("posts a COMMENT-type review explaining why", () => {
    expect(giveUp).toMatch(/gh pr review .* --comment/);
  });

  it("adds the ready-for-human label to the PR", () => {
    expect(giveUp).toMatch(/--add-label ready-for-human/);
  });

  it("keeps the PR as a draft", () => {
    expect(giveUp).toMatch(/draft/i);
  });

  it("does not mark the PR ready, add reviewed, or merge", () => {
    // No positive ready/reviewed/merge instructions in the escalation. Prose
    // negations ("do not") deliberately avoid the literal command strings.
    expect(giveUp).not.toMatch(/gh pr ready\b/);
    expect(giveUp).not.toMatch(/--add-label reviewed/);
    expect(giveUp).not.toMatch(/gh pr merge/);
  });

  it("uses the CONTEXT.md ready-for-human semantics", () => {
    expect(giveUp).toMatch(/out of all Dispatch buckets; a human owns it/i);
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
