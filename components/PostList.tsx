import Link from "next/link";

import Post from "types/post";

import DateFormatter from "./DateFormatter";
import { formatReadingTime } from "#/lib/readingTime";

interface Props {
  posts: Post[];
}

const PostList = ({ posts }: Props): JSX.Element => {
  return (
    <div>
      {posts.map((post) => (
        <div key={post.slug} className="mb-16 md:mb-8">
          <h3 className="mb-4 text-3xl font-bold leading-tight tracking-tight">
            <Link href={`/posts/${post.slug}`}>
              {post.isDraft ? "[Draft-local-only] " : ""}
              {post.title}
            </Link>
          </h3>
          <div className={`mb-4 text-foreground`}>
            {post.excerpt || "No excerpt available for this post."}
          </div>
          <div className="mb-4 text-green flex items-center gap-2">
            <DateFormatter isoDateString={post.date} />
            {post.readingTime ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatReadingTime(post.readingTime)}</span>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PostList;
