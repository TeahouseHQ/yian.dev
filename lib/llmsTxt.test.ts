import { describe, it, expect } from "vitest";

import { BaseUrl } from "#/lib/constants";
import { buildLlmsTxt, buildPostMarkdown, type LlmsTxtPost } from "#/lib/llmsTxt";

// Minimal post shape matching the Pick<Post, ...> the generator consumes.
function makePost(overrides: Partial<LlmsTxtPost> = {}): LlmsTxtPost {
  return {
    slug: "hello-world",
    title: "Hello World",
    date: "2024-02-19T01:28:48Z",
    excerpt: "Welcome to Pedal Powered Dev",
    tags: ["helloworld"],
    content: "Hello, World.",
    ...overrides,
  };
}

describe("buildLlmsTxt", () => {
  it("opens with the site H1 and person-forward blockquote", () => {
    const output = buildLlmsTxt([]);

    expect(output).toContain("# Yi-An Lai");
    expect(output).toContain('"Pedal Powered Dev"');
    expect(output).toContain("Cycle, caffeinate, code, repeat.");
    // Blockquote lines are prefixed with `>`.
    expect(output).toMatch(/^> /m);
  });

  it("lists blog posts newest-first with .md links and excerpts", () => {
    const newest = makePost({ slug: "newest", title: "Newest Post", excerpt: "Newest excerpt" });
    const older = makePost({ slug: "older", title: "Older Post", excerpt: "Older excerpt" });
    // getAllPosts already returns newest-first; the pure generator preserves
    // the caller's order rather than re-sorting (mirrors lib/feed.ts).
    const output = buildLlmsTxt([newest, older]);

    const newestIdx = output.indexOf("Newest Post");
    const olderIdx = output.indexOf("Older Post");
    expect(newestIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newestIdx).toBeLessThan(olderIdx);

    expect(output).toContain("[Newest Post](/posts/newest.md): Newest excerpt");
    expect(output).toContain("[Older Post](/posts/older.md): Older excerpt");
  });

  it("links each post at a /posts/<slug>.md URL", () => {
    const output = buildLlmsTxt([makePost({ slug: "abc" })]);

    expect(output).toContain("[Hello World](/posts/abc.md)");
  });

  it("includes a Pages section linking to the resume", () => {
    const output = buildLlmsTxt([]);

    expect(output).toContain("## Pages");
    expect(output).toContain("[Resume](/resume)");
  });

  it("renders the Blog posts heading even when there are no posts", () => {
    const output = buildLlmsTxt([]);

    expect(output).toContain("## Blog posts");
  });

  it("emits a link without a trailing ': ' when a post has no excerpt", () => {
    const output = buildLlmsTxt([makePost({ slug: "no-excerpt", excerpt: "" })]);

    expect(output).toContain("[Hello World](/posts/no-excerpt.md)");
    expect(output).not.toContain("[Hello World](/posts/no-excerpt.md):");
  });
});

describe("buildPostMarkdown", () => {
  it("starts with the title as an H1", () => {
    const output = buildPostMarkdown(makePost());

    expect(output.startsWith("# Hello World\n")).toBe(true);
  });

  it("includes a date-and-tags metadata line", () => {
    const output = buildPostMarkdown(makePost({ tags: ["unity", "game-dev"] }));

    // Reuses the OG UTC long-date formatter for a readable, locale-stable date.
    expect(output).toContain("February 19, 2024");
    expect(output).toContain("· unity, game-dev");
  });

  it("shows the date alone when a post has no tags", () => {
    const output = buildPostMarkdown(makePost({ tags: undefined }));

    expect(output).toContain("February 19, 2024");
    // No middle-dot separator anywhere in the output for this fixture.
    expect(output).not.toContain("·");
  });

  it("renders the excerpt as a blockquote", () => {
    const excerpt = "A custom excerpt for the post";
    const output = buildPostMarkdown(makePost({ excerpt }));

    expect(output).toContain(`> ${excerpt}`);
  });

  it("omits the excerpt blockquote when the excerpt is empty", () => {
    const output = buildPostMarkdown(makePost({ excerpt: "" }));

    expect(output).not.toMatch(/^> /m);
  });

  it("includes the raw markdown body", () => {
    const content = "## A section\n\nSome body text here.";
    const output = buildPostMarkdown(makePost({ content }));

    expect(output).toContain("## A section");
    expect(output).toContain("Some body text here.");
  });

  it("does not include YAML front matter in the body", () => {
    // content arrives already front-matter-stripped from getPostBySlug; the
    // generator must not re-introduce a `---` block.
    const output = buildPostMarkdown(makePost({ content: "Clean body with no front matter." }));

    expect(output).not.toMatch(/^---$/m);
  });

  it("absolutizes /assets/ links against BaseUrl", () => {
    const content = "![cover](/assets/blog/hello-world/cover.jpg)";
    const output = buildPostMarkdown(makePost({ content }));

    expect(output).toContain(`![cover](${BaseUrl}/assets/blog/hello-world/cover.jpg)`);
    expect(output).not.toContain("](/assets/");
  });

  it("leaves already-absolute URLs untouched", () => {
    const content = "[Gemini](https://gemini.google.com)";
    const output = buildPostMarkdown(makePost({ content }));

    expect(output).toContain("[Gemini](https://gemini.google.com)");
  });
});
