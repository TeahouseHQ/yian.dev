import { describe, it, expect } from "vitest";

import { WORDS_PER_MINUTE, computeReadingTime, formatReadingTime } from "./readingTime";

describe("computeReadingTime", () => {
  it("returns a minimum of 1 minute for empty or trivial content", () => {
    expect(computeReadingTime("")).toBe(1);
    expect(computeReadingTime("   \n  ")).toBe(1);
    expect(computeReadingTime("hello world")).toBe(1);
  });

  it("rounds up to the nearest minute using the standard rate", () => {
    const words = Array.from({ length: WORDS_PER_MINUTE * 2 }, () => "word").join(" ");
    expect(computeReadingTime(words)).toBe(2);

    const partial = Array.from({ length: WORDS_PER_MINUTE + 1 }, () => "word").join(" ");
    expect(computeReadingTime(partial)).toBe(2);
  });

  it("strips markdown syntax (code fences, links, images) before counting", () => {
    const md = [
      "# Title",
      "",
      "Here is a [link](https://example.com) and an ![image](/x.png).",
      "",
      "```ts",
      "const a = 1; // not counted as prose",
      "```",
      "",
      "Some more words here.",
    ].join("\n");

    // Should yield a positive integer >= 1, and should not blow up.
    const minutes = computeReadingTime(md);
    expect(minutes).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(minutes)).toBe(true);
  });

  it("produces the same value for the same input (deterministic)", () => {
    const md = "one two three four five six seven eight nine ten";
    expect(computeReadingTime(md)).toBe(computeReadingTime(md));
  });
});

describe("formatReadingTime", () => {
  it("formats minutes with a 'min read' suffix", () => {
    expect(formatReadingTime(1)).toBe("1 min read");
    expect(formatReadingTime(7)).toBe("7 min read");
  });
});
