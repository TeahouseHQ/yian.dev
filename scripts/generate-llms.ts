import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { getAllPosts } from "#/lib/api";
import { buildLlmsTxt, buildPostMarkdown } from "#/lib/llmsTxt";
import type Post from "types/post";

// Exactly the fields the pure generators consume. Requesting more would be
// dead weight; requesting fewer would break `buildPostMarkdown`/`buildLlmsTxt`.
const POST_FIELDS = ["slug", "title", "date", "excerpt", "tags", "content"] as const;

export interface GenerateLlmsOptions {
  /**
   * Root directory the emitted files are written under. Defaults to `public/`
   * relative to the current working directory — i.e. the real build output.
   * Tests pass a temp dir so nothing escapes the sandbox.
   */
  outputDir?: string;
}

/**
 * Emit `/llms.txt` and `/posts/<slug>.md` for every post `getAllPosts` returns.
 *
 * Thin runner mirroring `app/feed.xml/route.ts` → `lib/feed.ts`: the pure
 * formatting lives in `lib/llmsTxt.ts`; this module owns only the I/O wiring.
 *
 * Draft handling and newest-first ordering are delegated to `getAllPosts`,
 * which already excludes drafts at `NODE_ENV=production` and sorts descending
 * by date — exactly like the statically-generated post pages and the RSS feed.
 *
 * @returns The files written, each relative to `outputDir`, so callers can log
 * or assert on the result without re-reading the filesystem.
 */
export function generateLlmsFiles(options: GenerateLlmsOptions = {}): string[] {
  const outputDir = path.resolve(options.outputDir ?? "public");
  const postsDir = path.join(outputDir, "posts");

  // Create the per-post directory up front; `public/posts/` doesn't exist in a
  // fresh checkout (the .md twins are build artifacts), so `recursive: true`
  // no-ops when it's already there.
  fs.mkdirSync(postsDir, { recursive: true });

  const written: string[] = [];
  const writeFile = (relPath: string, content: string) => {
    fs.writeFileSync(path.join(outputDir, relPath), content);
    written.push(relPath);
  };

  const posts = getAllPosts([...POST_FIELDS]) as Pick<
    Post,
    "slug" | "title" | "date" | "excerpt" | "tags" | "content"
  >[];

  writeFile("llms.txt", buildLlmsTxt(posts));
  for (const post of posts) {
    writeFile(path.join("posts", `${post.slug}.md`), buildPostMarkdown(post));
  }

  return written;
}

async function main(): Promise<void> {
  const written = generateLlmsFiles();
  for (const file of written) {
    console.log(`llms: wrote ${file}`);
  }
}

// Run only when invoked directly via `tsx scripts/generate-llms.ts`, not when
// imported (e.g. by tests). `pathToFileURL` keeps the comparison correct across
// POSIX/Windows and whatever URL form tsx assigns to `import.meta.url`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
