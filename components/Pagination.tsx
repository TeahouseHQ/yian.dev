import Link from "next/link";

import { pageHref } from "#/lib/pagination";

interface Props {
  /** 1-indexed page currently being rendered. */
  page: number;
  totalPages: number;
  /** Base path for page 1 (e.g. `/home`). Pages 2..N use `<base>/page/<n>`. */
  basePath: string;
}

/**
 * Prev/next + numbered page navigation for the blog listing. Posts are sorted
 * newest-first, so a lower page number is "newer" and a higher one is "older".
 *
 * Renders nothing when there is only a single page, so callers can always
 * mount it without conditionals.
 */
const Pagination = ({ page, totalPages, basePath }: Props): React.JSX.Element | null => {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav
      className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t-2 border-foreground/10 pt-6"
      aria-label="Pagination"
    >
      <div className="min-w-[6rem]">
        {page > 1 ? (
          <Link href={pageHref(basePath, page - 1)} rel="prev" className="hover:underline">
            ← Newer
          </Link>
        ) : (
          <span className="text-foreground/30" aria-disabled="true">
            ← Newer
          </span>
        )}
      </div>

      <ol className="flex items-center gap-1">
        {pages.map((p) => (
          <li key={p}>
            {p === page ? (
              <span
                aria-current="page"
                className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded bg-foreground px-2 text-background"
              >
                {p}
              </span>
            ) : (
              <Link
                href={pageHref(basePath, p)}
                className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded px-2 hover:bg-foreground/10"
              >
                {p}
              </Link>
            )}
          </li>
        ))}
      </ol>

      <div className="min-w-[6rem] text-right">
        {page < totalPages ? (
          <Link href={pageHref(basePath, page + 1)} rel="next" className="hover:underline">
            Older →
          </Link>
        ) : (
          <span className="text-foreground/30" aria-disabled="true">
            Older →
          </span>
        )}
      </div>
    </nav>
  );
};

export default Pagination;
