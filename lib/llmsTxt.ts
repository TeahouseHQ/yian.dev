import { BaseUrl } from "#/lib/constants";
import { formatOgDate } from "#/lib/og";
import type Post from "types/post";

/**
 * The post fields the llms.txt generators actually need. Narrower than `Post`
 * so the pure functions below are easy to unit-test (no full fixture required)
 * while still accepting the full `Post[]` the data layer hands the runner.
 */
export type LlmsTxtPost = Pick<Post, "slug" | "title" | "date" | "excerpt" | "tags" | "content">;

// Person-forward site summary, verbatim from the #132 PRD so the index reads
// the same everywhere it appears.
const SITE_SUMMARY = [
  '> Personal site and blog of Yi-An Lai ("Pedal Powered Dev") —',
  "> a fullstack developer and road cyclist. Writing about game",
  "> development, cycling, and code. Cycle, caffeinate, code, repeat.",
].join("\n");

/**
 * Build the `/llms.txt` index for the site.
 *
 * Pure: no file I/O. The caller (the build runner in the sibling ticket) hands
 * in the post set — typically `getAllPosts([...])`, which is already filtered
 * to non-drafts in production and sorted newest-first. This function preserves
 * that order rather than re-sorting, mirroring `lib/feed.ts`.
 */
export function buildLlmsTxt(posts: LlmsTxtPost[]): string {
  const postLines = posts.map((post) => {
    const link = `[${post.title}](/posts/${post.slug}.md)`;
    return post.excerpt ? `${link}: ${post.excerpt}` : link;
  });

  const sections: string[] = [
    "# Yi-An Lai",
    "",
    SITE_SUMMARY,
    "",
    "## Blog posts",
    "",
    ...postLines,
    "",
    "## Pages",
    "",
    "[Resume](/resume)",
  ];

  return `${sections.join("\n")}\n`;
}

/**
 * Rewrite markdown link/image destinations pointing at `/assets/...` to be
 * absolute against `BaseUrl`, so the generated `.md` file stands alone.
 * Already-absolute URLs (e.g. `https://...`) are left untouched.
 */
function absolutizeAssets(markdown: string): string {
  // `](/assets/...)` covers both `[text](url)` links and `![alt](url)` images.
  return markdown.replace(/(\]\()(\/assets\/[^)\s]*)/g, `$1${BaseUrl}$2`);
}

/**
 * Build the clean-markdown twin of a single post for `/posts/<slug>.md`.
 *
 * Pure: no file I/O. `content` is expected already front-matter-stripped, which
 * is how `getPostBySlug` exposes it (via gray-matter). The date reuses
 * `formatOgDate` for a UTC-pinned, human-readable value consistent with the
 * site's OG cards.
 */
export function buildPostMarkdown(post: LlmsTxtPost): string {
  const date = formatOgDate(post.date);
  const tags = post.tags?.filter(Boolean).join(", ");
  const metaLine = tags ? `${date} · ${tags}` : date;

  const sections: string[] = [`# ${post.title}`, "", metaLine];

  const excerpt = post.excerpt?.trim();
  if (excerpt) {
    sections.push("", `> ${excerpt}`);
  }

  // Strip trailing newlines so the file ends with exactly one.
  const body = absolutizeAssets(post.content).replace(/\n+$/, "");
  sections.push("", body);

  return `${sections.join("\n")}\n`;
}
