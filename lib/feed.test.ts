import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the module under test
vi.mock("#/lib/api", () => ({
  getAllPosts: vi.fn(),
}));

vi.mock("#/lib/markdownToHtml", () => ({
  default: vi.fn().mockResolvedValue("<p>Rendered HTML content</p>"),
}));

import { getAllPosts } from "#/lib/api";
import markdownToHtml from "#/lib/markdownToHtml";
import { generateRssFeed } from "#/lib/feed";

const mockedGetAllPosts = vi.mocked(getAllPosts);
const mockedMarkdownToHtml = vi.mocked(markdownToHtml);

describe("generateRssFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return valid XML string", async () => {
    mockedGetAllPosts.mockReturnValue([]);

    const result = await generateRssFeed();

    expect(result).toContain("<?xml");
    expect(result).toContain("<rss");
    expect(result).toContain("</rss>");
  });

  it("should include site metadata in the channel", async () => {
    mockedGetAllPosts.mockReturnValue([]);

    const result = await generateRssFeed();

    expect(result).toContain("Yi-An Lai | Pedal Powered Dev</title>");
    expect(result).toContain("<description>Cycle, caffeinate, code, repeat.</description>");
    expect(result).toContain("<link>https://www.yian.dev</link>");
    expect(result).toContain("<language>en</language>");
  });

  it("should include feed items for each published post", async () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome to Pedal Powered Dev",
        content: "Hello, World. Welcome...",
        coverImage: "/assets/blog/hello-world/helloworld.jpg",
      },
      {
        slug: "second-post",
        title: "Second Post",
        date: "2024-03-01T00:00:00Z",
        excerpt: "Another post",
        content: "More content here...",
        coverImage: "/assets/blog/second-post/image.jpg",
      },
    ] as any);
    mockedMarkdownToHtml.mockResolvedValue("<p>Rendered content</p>");

    const result = await generateRssFeed();

    // Should contain items for both posts (feed library uses CDATA)
    expect(result).toContain("Hello World");
    expect(result).toContain("Second Post");

    // Links should be absolute
    expect(result).toContain("<link>https://www.yian.dev/posts/hello-world</link>");
    expect(result).toContain("<link>https://www.yian.dev/posts/second-post</link>");

    // Should have called markdownToHtml for each post
    expect(mockedMarkdownToHtml).toHaveBeenCalledTimes(2);
  });

  it("should prepend BaseUrl to relative cover images", async () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome",
        content: "Hello",
        coverImage: "/assets/blog/hello-world/helloworld.jpg",
      },
    ] as any);
    mockedMarkdownToHtml.mockResolvedValue("<p>Content</p>");

    const result = await generateRssFeed();

    expect(result).toContain("https://www.yian.dev/assets/blog/hello-world/helloworld.jpg");
  });

  it("should handle empty blog (no posts)", async () => {
    mockedGetAllPosts.mockReturnValue([]);

    const result = await generateRssFeed();

    // Should still be valid RSS with channel but no items
    expect(result).toContain("<rss");
    expect(result).toContain("<channel>");
    expect(result).toContain("</channel>");
    expect(result).toContain("</rss>");
    // Should NOT contain <item>
    expect(result).not.toContain("<item>");
  });

  it("should include publication dates for posts", async () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome",
        content: "Hello",
        coverImage: "/assets/blog/hello-world/helloworld.jpg",
      },
    ] as any);
    mockedMarkdownToHtml.mockResolvedValue("<p>Content</p>");

    const result = await generateRssFeed();

    // RSS 2.0 uses <pubDate> in items
    expect(result).toContain("<pubDate>");
    expect(result).toContain("2024");
  });

  it("should include rendered HTML content for each post", async () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome",
        content: "**Bold text**",
        coverImage: "/assets/blog/hello-world/helloworld.jpg",
      },
    ] as any);
    mockedMarkdownToHtml.mockResolvedValue("<p><strong>Bold text</strong></p>");

    const result = await generateRssFeed();

    expect(mockedMarkdownToHtml).toHaveBeenCalledWith("**Bold text**");
    expect(result).toContain("<content:encoded>");
  });

  it("should use post excerpt as description", async () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "A custom excerpt for the post",
        content: "Hello",
        coverImage: "/assets/blog/hello-world/helloworld.jpg",
      },
    ] as any);
    mockedMarkdownToHtml.mockResolvedValue("<p>Content</p>");

    const result = await generateRssFeed();

    expect(result).toContain("A custom excerpt for the post");
  });
});
