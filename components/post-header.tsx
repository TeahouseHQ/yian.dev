import Avatar from "./avatar";
import CoverImage from "./cover-image";
import PostTitle from "./post-title";
import type Author from "../@types/author";

interface Props {
  title: string;
  coverImage: string;
  date: string;
  author: Author;
}

const PostHeader = ({
  title,
  coverImage,
  date,
  author,
}: Props): JSX.Element => {
  return (
    <>
      <PostTitle>{title}</PostTitle>
      <div className="hidden md:block md:mb-12">
        <Avatar name={author.name} picture={author.picture} date={date} />
      </div>
      <div className="mb-8 md:mb-16 md:mx-0 -mx-8">
        <CoverImage title={title} src={coverImage} />
      </div>
      <div className="max-w-2xl mx-auto">
        <div className="block md:hidden mb-6">
          <Avatar name={author.name} picture={author.picture} date={date} />
        </div>
      </div>
    </>
  );
};

export default PostHeader;
