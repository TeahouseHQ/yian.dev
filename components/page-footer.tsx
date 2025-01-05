import Link from "next/link";

import styles from "../styles/styles.module.css";

const FooterLinks = [
  {
    name: "Home",
    href: "/home",
  },
  {
    name: "About",
    href: "/about",
  },
  {
    name: "Projects",
    href: "/projects",
  },
  {
    name: "Play",
    href: "/play",
  },
];

const PageFooter = ({
  className,
  showMenu,
}: {
  className?: string;
  showMenu?: boolean;
}): JSX.Element => {
  return (
    <div className={`w-full md:max-w-4xl mx-auto mb-28 ${styles.footer} ${className}`}>
      <hr className="w-full border-t-2 border-foreground/20 my-16" />
      {showMenu && (
        <ul className="flex flex-wrap justify-center list-none my-4">
          {FooterLinks.map((link) => (
            <li key={link.name} className="mx-1 my-1">
              <Link href={link.href}>{link.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center">yian.dev - {new Date().getFullYear()}</p>
    </div>
  );
};

export default PageFooter;
