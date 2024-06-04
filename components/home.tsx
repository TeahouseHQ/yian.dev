import PostList from "./post-list";
import Logo from "./ppd-logo";
import PostType from "../@types/post";

type Props = {
  posts: PostType[];
};

const Home = ({ posts }: Props): JSX.Element => {
  return (
    <div className="flex-col md:flex-row flex items-center md:justify-between md:h-screen">
      <div className="flex flex-col items-center md:w-5/12 gap-2 py-16 md:py-0">
        <Logo />
        <h1>Yi-An Lai</h1>
        <h2>Fullstack | Roadie</h2>
        <div className="flex flex-row items-center justify-center gap-2 text-2xl min-h-[40px]">
          <a
            href="https://www.linkedin.com/in/yi-an-lai-andrew/"
            target="_blank"
          >
            <i className="fa-brands fa-linkedin"></i>
          </a>
          <a href="https://github.com/yianL" target="_blank">
            <i className="fa-brands fa-square-github"></i>
          </a>
          <a href="https://www.strava.com/athletes/yianlai" target="_blank">
            <i className="fa-brands fa-strava"></i>
          </a>
          <a
            href="https://docs.google.com/document/d/1VpCJXs3vGY7mk4KDMjQkLSZmTz399kFW-lUGZVxjZXo/edit?usp=sharing"
            target="_blank"
          >
            <i className="fa-regular fa-address-card"></i>
          </a>
        </div>
      </div>
      <div className="flex flex-col items-center md:w-7/12 p-4">
        <PostList posts={posts} />
      </div>
    </div>
  );
};

export default Home;
