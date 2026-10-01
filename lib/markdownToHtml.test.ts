import { describe, expect, it } from "vitest";

import markdownToHtml from "./markdownToHtml";

describe("markdownToHtml", () => {
  it("renders GFM tables, strikethrough, autolinks, and task lists", async () => {
    const md = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "~struck~ and ~~gone~~",
      "",
      "Visit https://example.com",
      "",
      "- [x] done",
      "- [ ] pending",
    ].join("\n");

    const html = await markdownToHtml(md);

    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('<a href="https://example.com">https://example.com</a>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("leaves plain CommonMark posts unchanged", async () => {
    const md = [
      "# Title",
      "",
      "Some *emphasis* and `code`.",
      "",
      "```ts",
      "const a = 1;",
      "```",
    ].join("\n");

    const html = await markdownToHtml(md);

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("<table>");
    expect(html).not.toContain("checkbox");
  });
});
