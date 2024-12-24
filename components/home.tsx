import Link from "next/link";

import PostType from "types/post";

import PostList from "./post-list";
import Logo from "./ppd-logo";
import PageFooter from "./page-footer";

type Props = {
  posts: PostType[];
};

const Home = ({ posts }: Props): JSX.Element => {
  return (
    <div className="flex-col md:flex-row flex items-center md:justify-between md:h-screen">
      <div className="flex flex-col items-center xl:w-3/12 md:w-5/12 gap-2 pt-16 md:py-0">
        <Link href={"/play"}>
          <Logo />
        </Link>
        <h1 className="text-4xl">Yian Lai</h1>
        <div className="flex flex-row items-center justify-center gap-2 text-2xl min-h-[40px]">
          <span>
            <a href="https://github.com/yianL" target="_blank">
              {">"}
            </a>
          </span>
          <a href="https://www.linkedin.com/in/yi-an-lai-andrew/" target="_blank">
            fullstack
          </a>
          <a href="https://www.strava.com/athletes/yianlai" target="_blank">
            roadie
          </a>
        </div>
      </div>
      <hr className="w-full border-t-2 border-foreground/40 md:hidden my-16" />
      <div className="flex flex-col items-center xl:w-9/12 md:w-7/12 p-4">
        <PostList posts={posts} />
      </div>
      <PageFooter className="md:hidden" />
    </div>
  );
};

export default Home;
