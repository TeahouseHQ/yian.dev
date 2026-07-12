import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Mock the data layer before importing the module under test. The runner must
// delegate draft-filtering and ordering to `getAllPosts` (mirrors lib/feed.ts),
// so we stub it and assert on what gets written.
vi.mock("#/lib/api", () => ({
  getAllPosts: vi.fn(),
}));

import { getAllPosts } from "#/lib/api";
import { generateLlmsFiles } from "#/scripts/generate-llms";

const mockedGetAllPosts = vi.mocked(getAllPosts);

function makeOutputDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "llms-test-"));
}

describe("generateLlmsFiles", () => {
  let outputDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outputDir = makeOutputDir();
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it("reads posts with the fields the generators need", () => {
    mockedGetAllPosts.mockReturnValue([]);

    generateLlmsFiles({ outputDir });

    expect(mockedGetAllPosts).toHaveBeenCalledTimes(1);
    expect(mockedGetAllPosts).toHaveBeenCalledWith([
      "slug",
      "title",
      "date",
      "excerpt",
      "tags",
      "content",
    ]);
  });

  it("writes public/llms.txt containing the index", () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome to Pedal Powered Dev",
        tags: ["helloworld"],
        content: "Hello, World.",
      },
    ] as any);

    generateLlmsFiles({ outputDir });

    const llmsTxt = fs.readFileSync(path.join(outputDir, "llms.txt"), "utf8");
    expect(llmsTxt).toContain("# Yi-An Lai");
    expect(llmsTxt).toContain("[Hello World](/posts/hello-world.md)");
    expect(llmsTxt).toContain("[Resume](/resume)");
  });

  it("writes public/posts/<slug>.md for each post", () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome",
        tags: ["helloworld"],
        content: "Hello, World.",
      },
      {
        slug: "second-post",
        title: "Second Post",
        date: "2024-03-01T00:00:00Z",
        excerpt: "Another",
        tags: ["misc"],
        content: "More content.",
      },
    ] as any);

    generateLlmsFiles({ outputDir });

    const first = fs.readFileSync(path.join(outputDir, "posts", "hello-world.md"), "utf8");
    expect(first.startsWith("# Hello World\n")).toBe(true);
    expect(first).toContain("Hello, World.");

    const second = fs.readFileSync(path.join(outputDir, "posts", "second-post.md"), "utf8");
    expect(second.startsWith("# Second Post\n")).toBe(true);
  });

  it("creates the public/posts/ directory if it does not exist", () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome",
        tags: ["helloworld"],
        content: "Hello, World.",
      },
    ] as any);

    // The directory should not pre-exist.
    expect(fs.existsSync(path.join(outputDir, "posts"))).toBe(false);

    generateLlmsFiles({ outputDir });

    expect(fs.existsSync(path.join(outputDir, "posts"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "posts", "hello-world.md"))).toBe(true);
  });

  it("returns the list of files written (relative to outputDir)", () => {
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome",
        tags: ["helloworld"],
        content: "Hello, World.",
      },
    ] as any);

    const written = generateLlmsFiles({ outputDir });

    expect(written).toContain("llms.txt");
    expect(written).toContain(path.join("posts", "hello-world.md"));
  });

  it("defaults to the public/ directory when no outputDir is given", () => {
    mockedGetAllPosts.mockReturnValue([]);

    // Run from the temp dir so the default `public/` lands there, not in the
    // repo, then clean it up.
    const cwd = process.cwd();
    process.chdir(outputDir);
    try {
      generateLlmsFiles();
      expect(fs.existsSync(path.join(outputDir, "public", "llms.txt"))).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it("delegates draft filtering to getAllPosts (writes nothing for excluded posts)", () => {
    // Only one post survives getAllPosts' production-time draft filter; the
    // runner must not re-implement that filter, just write what it's given.
    mockedGetAllPosts.mockReturnValue([
      {
        slug: "hello-world",
        title: "Hello World",
        date: "2024-02-19T01:28:48Z",
        excerpt: "Welcome",
        tags: ["helloworld"],
        content: "Hello, World.",
      },
    ] as any);

    generateLlmsFiles({ outputDir });

    expect(fs.existsSync(path.join(outputDir, "posts", "hello-world.md"))).toBe(true);
    // A draft slug that getAllPosts would have filtered out is never written.
    expect(fs.existsSync(path.join(outputDir, "posts", "host-your-unity-game-on-github.md"))).toBe(
      false
    );
  });
});
