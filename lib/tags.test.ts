import { describe, it, expect } from "vitest";

import type Post from "types/post";

import {
  filterByTag,
  getUniqueTags,
  normalizeTag,
  TAG_BASE_PATH,
  TAG_QUERY_KEY,
  tagHref,
} from "./tags";

/** Build a minimal post shape carrying only the tags used by these helpers. */
function withTags(tags: string[]): Post {
  return { tags } as unknown as Post;
}

describe("normalizeTag", () => {
  it("lowercases and trims the tag for matching", () => {
    expect(normalizeTag("  NextJS ")).toBe("nextjs");
    expect(normalizeTag("Game-Dev")).toBe("game-dev");
  });

  it("collapses an all-whitespace tag to an empty string", () => {
    expect(normalizeTag("   ")).toBe("");
  });
});

describe("getUniqueTags", () => {
  it("collects every tag across posts, sorted and de-duplicated", () => {
    const tags = getUniqueTags([withTags(["tailwind", "meta"]), withTags(["meta", "nextjs"])]);
    expect(tags).toEqual(["meta", "nextjs", "tailwind"]);
  });

  it("normalizes before de-duplicating so case variants collapse", () => {
    const tags = getUniqueTags([withTags(["NextJS"]), withTags(["nextjs"]), withTags(["NEXTJS"])]);
    expect(tags).toEqual(["nextjs"]);
  });

  it("ignores posts without a tags array", () => {
    const tags = getUniqueTags([withTags(["unity"]), {} as unknown as Post]);
    expect(tags).toEqual(["unity"]);
  });

  it("returns an empty list when no post has tags", () => {
    expect(getUniqueTags([])).toEqual([]);
    expect(getUniqueTags([{} as unknown as Post])).toEqual([]);
  });
});

describe("filterByTag", () => {
  const posts = [
    withTags(["meta", "nextjs"]),
    withTags(["unity", "game-dev"]),
    withTags(["nextjs", "tailwind"]),
  ];

  it("returns only posts whose tags include the given tag", () => {
    const matched = filterByTag(posts, "nextjs");
    expect(matched).toHaveLength(2);
    expect(matched.map((p) => p.tags)).toEqual([
      ["meta", "nextjs"],
      ["nextjs", "tailwind"],
    ]);
  });

  it("matches case- and whitespace-insensitively", () => {
    expect(filterByTag(posts, "  NextJS ")).toHaveLength(2);
    expect(filterByTag(posts, "META")).toHaveLength(1);
  });

  it("returns an empty list for an unknown tag", () => {
    expect(filterByTag(posts, "nonexistent")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const snapshot = [...posts];
    filterByTag(posts, "nextjs");
    expect(posts).toEqual(snapshot);
  });

  it("acts as a no-op (returns all posts) for an empty tag", () => {
    expect(filterByTag(posts, "   ")).toEqual(posts);
  });
});

describe("tagHref", () => {
  it("points at the home listing with the tag query key", () => {
    expect(tagHref("nextjs")).toBe(`/home?tag=nextjs`);
  });

  it("normalizes the tag before encoding", () => {
    expect(tagHref("  NextJS ")).toBe(`/home?tag=nextjs`);
  });

  it("URL-encodes tags with spaces or punctuation", () => {
    expect(tagHref("game dev")).toBe(`/home?tag=game%20dev`);
  });

  it("uses exported base path + query key constants", () => {
    expect(TAG_BASE_PATH).toBe("/home");
    expect(TAG_QUERY_KEY).toBe("tag");
    expect(tagHref("x")).toBe(`${TAG_BASE_PATH}?${TAG_QUERY_KEY}=x`);
  });
});
