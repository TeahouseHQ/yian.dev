import Link from "next/link";

import HomeLayout from "#/components/HomeLayout";
import Pagination from "#/components/Pagination";
import PostList from "#/components/PostList";
import { getAllPosts, getPaginatedPosts } from "#/lib/api";
import { TAG_BASE_PATH, filterByTag, normalizeTag } from "#/lib/tags";

/** Fields needed to render a post card on the home listing. `tags` powers both
 * the per-card chips (PostTags) and the `/home?tag=…` filter below. */
const LIST_FIELDS = ["slug", "title", "date", "excerpt", "readingTime", "tags"];

interface Props {
  /** 1-indexed page number to render. */
  page: number;
  /**
   * Optional tag filter deep-linked as `/home?tag=<tag>` (see `tagHref`). Only
   * the page-1 entry point accepts a tag; paginated sibling routes
   * (`/home/page/<n>`) are deliberately tag-agnostic.
   */
  tag?: string;
}

/**
 * The home blog listing for a single page: layout shell + bounded post list +
 * pagination controls. Shared by `/home` (page 1) and `/home/page/[n]` (pages
 * 2..N) so the two routes can never drift apart.
 *
 * When a `tag` is present the listing is filtered to that tag and shown on a
 * single page. Pagination is dropped in that mode because the sibling
 * `/home/page/<n>` routes do not carry the tag query, so paginating a filtered
 * set would lose the filter on the first "older" click. Tag deep-links only
 * ever target `/home?tag=…`, so a single filtered page is a coherent entry
 * point.
 */
const HomePosts = async ({ page, tag }: Props): Promise<React.JSX.Element> => {
  const normalizedTag = tag ? normalizeTag(tag) : "";

  if (normalizedTag) {
    const filtered = filterByTag(getAllPosts(LIST_FIELDS), normalizedTag);

    return (
      <HomeLayout route="~">
        <div className="mb-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl text-comment">
            Posts tagged <span className="text-green">#{normalizedTag}</span>
          </h2>
          <Link href={TAG_BASE_PATH} className="text-sm text-comment hover:underline">
            clear filter
          </Link>
        </div>
        <PostList posts={filtered} />
      </HomeLayout>
    );
  }

  const { items: posts, totalPages } = getPaginatedPosts(page, LIST_FIELDS);

  return (
    <HomeLayout route="~">
      <PostList posts={posts} />
      <Pagination page={page} totalPages={totalPages} basePath="/home" />
    </HomeLayout>
  );
};

export default HomePosts;
