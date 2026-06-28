import type Author from "types/author";

import Avatar from "./Avatar";
import CoverImage from "./CoverImage";
import PostTags from "./PostTags";
import PostTitle from "./PostTitle";
import { formatReadingTime } from "#/lib/readingTime";

interface Props {
  title: string;
  coverImage: string;
  date: string;
  author: Author;
  readingTime?: number;
  tags?: string[];
}

const PostHeader = ({
  title,
  coverImage,
  date,
  author,
  readingTime,
  tags,
}: Props): React.JSX.Element => {
  return (
    <>
      <PostTitle>{title}</PostTitle>
      <div className="hidden md:block md:mb-12">
        <Avatar name={author.name} picture={author.picture} date={date} />
        {readingTime ? <div className="text-red mt-1">{formatReadingTime(readingTime)}</div> : null}
      </div>
      <div className="mb-8 md:mb-16 md:mx-0 -mx-8">
        <CoverImage title={title} src={coverImage} />
      </div>
      <div className="max-w-2xl mx-auto">
        <div className="block md:hidden mb-6">
          <Avatar name={author.name} picture={author.picture} date={date} />
          {readingTime ? (
            <div className="text-red mt-1">{formatReadingTime(readingTime)}</div>
          ) : null}
        </div>
        {/* Tags render once here (visible on all viewports) rather than in each
            avatar block, so desktop and mobile share one tags row. */}
        <PostTags tags={tags} />
      </div>
    </>
  );
};

export default PostHeader;
