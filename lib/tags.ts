/**
 * Tag taxonomy + filtering helpers for the blog.
 *
 * Pure and filesystem-free so they can be unit tested in isolation. The
 * data-fetching side lives in `lib/api.ts` (`getAllPosts`); these helpers
 * operate on already-loaded post shapes.
 *
 * Deep-link convention: filtering the home listing by a tag uses a query
 * string on the base home path, e.g. `/home?tag=nextjs` (see `tagHref`). Page
 * 1 of the listing is the single entry point for tag filtering; paginated
 * sibling routes (`/home/page/<n>`) are deliberately tag-agnostic.
 */

import type Post from "types/post";

/** Base path a tag deep-link points at (the home listing, page 1). */
export const TAG_BASE_PATH = "/home";

/** Query-string key used to filter the home listing by tag. */
export const TAG_QUERY_KEY = "tag";

/**
 * Normalize a tag for matching: trimmed + lowercased so "NextJS", " nextjs ",
 * and "nextjs" all resolve to the same filter. Display code uses the original
 * authored string; only comparisons and hrefs go through this. Since the blog
 * authors tags as lowercase kebab-case, this is usually a no-op but keeps the
 * filter robust to hand-edited query strings.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Posts whose tags include `tag` (case-insensitive). Returns a new array and
 * does not mutate the input. An unknown tag yields an empty list rather than
 * throwing, leaving empty-state rendering to the caller. An empty/whitespace
 * `tag` is a no-op that returns the input unchanged.
 */
export function filterByTag(posts: Post[], tag: string): Post[] {
  const want = normalizeTag(tag);
  if (!want) return posts;
  return posts.filter((post) => (post.tags ?? []).some((t) => normalizeTag(t) === want));
}

/**
 * Deep-link href for a tag filter on the home listing. Uses the base home path
 * (never a paginated sibling) so a filtered view never collides with
 * `/home/page/<n>`. The tag is normalized then URL-encoded so spaces /
 * punctuation round-trip safely through the address bar.
 */
export function tagHref(tag: string): string {
  return `${TAG_BASE_PATH}?${TAG_QUERY_KEY}=${encodeURIComponent(normalizeTag(tag))}`;
}
