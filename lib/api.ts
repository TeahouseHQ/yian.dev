import fs from "fs";
import { join } from "path";

import matter from "gray-matter";

import type Post from "types/post";

import { IS_LOCAL_DEV } from "./constants";
import { paginate, POSTS_PER_PAGE, type Paginated } from "./pagination";
import { computeReadingTime } from "./readingTime";

const postsDirectory = join(process.cwd(), "_posts");

type Items = Record<string, string>;

export function getPostSlugs(): string[] {
  return fs.readdirSync(postsDirectory);
}

export function getPostBySlug(slug: string, fields: string[] = []): Items {
  const realSlug = slug.replace(/\.md$/, "");
  const fullPath = join(postsDirectory, `${realSlug}.md`);
  const fileContents = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(fileContents);
  const items: Items = {};

  // Ensure only the minimal needed data is exposed
  fields.forEach((field) => {
    if (field === "slug") {
      items[field] = realSlug;
    }
    if (field === "content") {
      items[field] = content;
    }

    if (typeof data[field] !== "undefined") {
      items[field] = data[field];
    }
  });

  items["isDraft"] = data["isDraft"] || false;
  items["commentsEnabled"] = data["commentsEnabled"] || false;

  // Derive reading time from the raw markdown so previews and post headers
  // display the same value. Opt-in via the field list, matching the pattern
  // used for other fields above.
  if (fields.includes("readingTime")) {
    items["readingTime"] = computeReadingTime(content) as unknown as string;
  }

  return items;
}

export function getAllPosts(fields: string[] = []): Post[] {
  const slugs = getPostSlugs();
  const posts = slugs
    .map((slug) => getPostBySlug(slug, fields))
    .filter((post) => IS_LOCAL_DEV || !post.isDraft)
    // sort posts by date in descending order
    .sort((post1, post2) => (post1.date > post2.date ? -1 : 1));
  return posts as unknown as Post[];
}

/**
 * A single page of the home listing. Wraps `getAllPosts` with the pure
 * `paginate` slice so callers get the page window plus the bounds needed to
 * render prev/next controls in one shot.
 */
export function getPaginatedPosts(
  page: number,
  fields: string[] = [],
  perPage: number = POSTS_PER_PAGE
): Paginated<Post> {
  const posts = getAllPosts(fields);
  return paginate(posts, page, perPage);
}
