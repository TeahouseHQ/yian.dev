import PostList from "#/components/PostList";
import HomeLayout from "#/components/HomeLayout";
import { getAllPosts } from "#/lib/api";

export default async function HomePage() {
  const posts = getAllPosts(["slug", "title", "date", "excerpt", "readingTime"]);

  return (
    <HomeLayout route="~">
      <PostList posts={posts} />
    </HomeLayout>
  );
}
