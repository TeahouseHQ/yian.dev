import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type Post from "types/post";

// Mock the data layer so the orchestrator can be rendered without touching the
// filesystem. Mirrors the pattern in lib/feed.test.ts.
vi.mock("#/lib/api", () => ({
  getAllPosts: vi.fn(),
  getPaginatedPosts: vi.fn(),
}));

// HomeLayout pulls in next/font (via PpdLogo), which only initializes inside
// Next's runtime. Render it as a passthrough so the filtering behavior under
// test stays isolated from layout/font wiring.
vi.mock("#/components/HomeLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { getAllPosts, getPaginatedPosts } from "#/lib/api";
import HomePosts from "./HomePosts";

const mockedGetAllPosts = vi.mocked(getAllPosts);
const mockedGetPaginatedPosts = vi.mocked(getPaginatedPosts);

/** Minimal post shape carrying only the fields PostList/HomePosts render. */
function makePost(over: Partial<Post> & Pick<Post, "title">): Post {
  return {
    slug: "x",
    date: "2024-01-01T00:00:00Z",
    excerpt: "",
    readingTime: 1,
    tags: [],
    ...over,
  } as unknown as Post;
}

describe("HomePosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters the listing to a single tag and surfaces the active filter", async () => {
    const all = [
      makePost({ slug: "a", title: "Alpha", tags: ["nextjs", "meta"] }),
      makePost({ slug: "b", title: "Bravo", tags: ["unity"] }),
      makePost({ slug: "c", title: "Charlie", tags: ["nextjs"] }),
    ];
    mockedGetAllPosts.mockReturnValue(all);

    const html = renderToStaticMarkup(await HomePosts({ page: 1, tag: "nextjs" }));

    expect(html).toContain("Alpha");
    expect(html).toContain("Charlie");
    expect(html).not.toContain("Bravo");
    // Active-filter affordance is present, with a clear link back to /home.
    expect(html).toContain("Posts tagged");
    expect(html).toContain('href="/home"');
  });

  it("matches the tag case- and whitespace-insensitively", async () => {
    const all = [
      makePost({ slug: "a", title: "Alpha", tags: ["NextJS"] }),
      makePost({ slug: "b", title: "Bravo", tags: ["unity"] }),
    ];
    mockedGetAllPosts.mockReturnValue(all);

    const html = renderToStaticMarkup(await HomePosts({ page: 1, tag: "  NEXTJS " }));

    expect(html).toContain("Alpha");
    expect(html).not.toContain("Bravo");
  });

  it("renders an empty state when the tag matches nothing", async () => {
    mockedGetAllPosts.mockReturnValue([makePost({ slug: "a", title: "Alpha", tags: ["nextjs"] })]);

    const html = renderToStaticMarkup(await HomePosts({ page: 1, tag: "nope" }));

    expect(html).not.toContain("Alpha");
    expect(html).toContain("Posts tagged");
  });

  it("renders the paginated listing (no filter) when no tag is given", async () => {
    mockedGetPaginatedPosts.mockReturnValue({
      items: [makePost({ slug: "a", title: "Alpha" })],
      page: 1,
      perPage: 5,
      totalItems: 1,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
    });

    const html = renderToStaticMarkup(await HomePosts({ page: 1 }));

    expect(html).toContain("Alpha");
    // No active-filter indicator when not filtering.
    expect(html).not.toContain("Posts tagged");
  });
});
