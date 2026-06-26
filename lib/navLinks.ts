/**
 * Canonical site navigation. This is the single source of truth for the link
 * set rendered by the global {@link NavBar} (and any other nav surface), so
 * adding/removing a page only needs an edit here.
 *
 * Order matters — it is the display order in the header.
 */
export interface NavLink {
  label: string;
  href: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { label: "Home", href: "/home" },
  { label: "About", href: "/about" },
  { label: "Projects", href: "/projects" },
  { label: "Play", href: "/play" },
  { label: "Resume", href: "/resume" },
] as const;

/**
 * The Home link is the blog index, so being on the root path or reading a post
 * counts as being "in" the Home section. Any other section treats its index as
 * a prefix (so /play/unity/foo highlights Play) without bleeding across a
 * segment boundary (so /players does NOT highlight Play).
 */
const HOME_LIKE_PREFIXES = ["/", "/home", "/posts/"];

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

export function isActivePath(currentPath: string, linkHref: string): boolean {
  const path = normalizePath(currentPath);
  const href = normalizePath(linkHref);

  if (href === "/home") {
    return HOME_LIKE_PREFIXES.some((prefix) =>
      prefix === "/" ? path === "/" : path.startsWith(prefix)
    );
  }

  return path === href || path.startsWith(href + "/");
}
