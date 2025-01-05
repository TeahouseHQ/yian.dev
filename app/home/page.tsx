import PostList from "#/components/post-list";
import HomeLayout from "#/components/home-layout";
import { getAllPosts } from "#/lib/api";

export default async function HomePage() {
  const posts = getAllPosts(["slug", "title", "date", "excerpt"]);

  return (
    <HomeLayout route="~">
      <PostList posts={posts} />
    </HomeLayout>
  );
}
