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
  readingTime: number;
  /** Free-form taxonomy tags authored in front matter (`tags: string[]`). */
  tags?: string[];
  ogImage: {
    url: string;
  };
  content: string;
};

export default PostType;
