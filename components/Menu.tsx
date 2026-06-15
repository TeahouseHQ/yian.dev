import Link from "next/link";

const Menu = (): React.JSX.Element => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 flex justify-center gap-8 text-lg py-4 bg-background">
      <Link href="/home" className="hover:no-underline hover:text-aqua transition-colors">
        Home
      </Link>
      <Link href="/about" className="hover:no-underline hover:text-aqua transition-colors">
        About
      </Link>
      <Link href="/projects" className="hover:no-underline hover:text-aqua transition-colors">
        Projects
      </Link>
    </nav>
  );
};

export default Menu;
