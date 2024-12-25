import Link from "next/link";

import styles from "../styles/styles.module.css";

const FooterLinks = [
  {
    name: "Home",
    href: "/",
  },
  {
    name: "LinkedIn",
    href: "https://www.linkedin.com/in/yi-an-lai-andrew/",
    target: "_blank",
  },
  {
    name: "GitHub",
    href: "https://github.com/yianL",
    target: "_blank",
  },
  {
    name: "Strava",
    href: "https://www.strava.com/athletes/yianlai",
    target: "_blank",
  },
  {
    name: "Play",
    href: "/play",
  },
];

const PageFooter = ({ className }: { className?: string }): JSX.Element => {
  return (
    <div className={`max-w-4xl mx-auto mb-28 ${styles.footer} ${className}`}>
      <hr className="w-full border-t-2 border-foreground/20 my-16" />
      <ul className="flex flex-wrap justify-center list-none my-4">
        {FooterLinks.map((link) => (
          <li key={link.name} className="mx-2 my-1">
            <Link href={link.href} target={link.target}>
              {link.name}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-center">yian.dev - {new Date().getFullYear()}</p>
    </div>
  );
};

export default PageFooter;
