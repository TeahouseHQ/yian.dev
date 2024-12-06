import Link from "next/link";
import Post from "types/post";

import DateFormatter from "./date-formatter";

interface Props {
  posts: Post[];
}

const PostList = ({ posts }: Props): JSX.Element => {
  return (
    <div className="max-w-2xl mx-auto">
      {posts.map((post) => (
        <div key={post.slug}>
          <h3 className="mb-4 text-3xl font-bold leading-tight tracking-tight">
            <Link href={`/posts/${post.slug}`}>
              {post.isDraft ? "[Draft-local-only] " : ""}
              {post.title}
            </Link>
          </h3>
          <div
            className={`mb-4 ${
              post.excerpt ? "text-gray-700" : "text-gray-400"
            }`}
          >
            {post.excerpt || "No excerpt available for this post."}
          </div>
          <div className="mb-4 text-gray-500">
            <DateFormatter isoDateString={post.date} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default PostList;
