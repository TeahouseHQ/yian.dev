"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { NAV_LINKS, isActivePath } from "#/lib/navLinks";

const linkClassName = (active: boolean): string =>
  active ? "text-aqua no-underline" : "hover:no-underline hover:text-aqua transition-colors";

/**
 * Global responsive site navigation.
 *
 * Desktop: sticky top header with the brand mark on the left and the primary
 * link set inline on the right. Mobile: the same header with a hamburger
 * button that toggles a stacked link panel. The active route is highlighted via
 * {@link isActivePath}.
 *
 * Rendered from the root layout so every page shares one nav surface. It uses
 * a `<nav>` element so the existing print stylesheet hides it on the resume.
 */
const NavBar = (): React.JSX.Element => {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const current = pathname ?? "/";

  return (
    <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/95 backdrop-blur">
      <nav
        aria-label="Primary"
        className="container mx-auto flex items-center justify-between px-4 py-3"
      >
        <Link href="/home" className="text-xl font-bold tracking-tight hover:no-underline">
          PPD<span className="text-aqua">.</span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden items-center gap-6 text-lg md:flex">
          {NAV_LINKS.map((link) => {
            const active = isActivePath(current, link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={linkClassName(active)}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="inline-flex items-center justify-center p-2 md:hidden"
          aria-expanded={open}
          aria-controls="primary-nav-mobile"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile link panel */}
      {open && (
        <ul
          id="primary-nav-mobile"
          className="container mx-auto flex flex-col gap-1 px-4 pb-4 text-lg md:hidden"
        >
          {NAV_LINKS.map((link) => {
            const active = isActivePath(current, link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`block py-2 ${linkClassName(active)}`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </header>
  );
};

export default NavBar;
