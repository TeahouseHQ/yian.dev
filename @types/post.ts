import type Author from "./author";

type PostType = {
  id: string;
  isDraft?: boolean;
  commentsEnabled?: boolean;
  slug: string;
  title: string;
  date: string;
  coverImage: string;
  author: Author;
  excerpt: string;
  ogImage: {
    url: string;
  };
  content: string;
};

export default PostType;
