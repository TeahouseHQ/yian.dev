import HomeLayout from "#/components/HomeLayout";
import Pagination from "#/components/Pagination";
import PostList from "#/components/PostList";
import { getPaginatedPosts } from "#/lib/api";

/** Fields needed to render a post card on the home listing. */
const LIST_FIELDS = ["slug", "title", "date", "excerpt", "readingTime"];

interface Props {
  /** 1-indexed page number to render. */
  page: number;
}

/**
 * The home blog listing for a single page: layout shell + bounded post list +
 * pagination controls. Shared by `/home` (page 1) and `/home/page/[n]` (pages
 * 2..N) so the two routes can never drift apart.
 */
const HomePosts = async ({ page }: Props): Promise<React.JSX.Element> => {
  const { items: posts, totalPages } = getPaginatedPosts(page, LIST_FIELDS);

  return (
    <HomeLayout route="~">
      <PostList posts={posts} />
      <Pagination page={page} totalPages={totalPages} basePath="/home" />
    </HomeLayout>
  );
};

export default HomePosts;
