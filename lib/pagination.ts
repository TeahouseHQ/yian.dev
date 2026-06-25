/**
 * Blog pagination helpers.
 *
 * Pure, filesystem-free math so it can be unit tested in isolation. The
 * data-fetching wrapper that slices real posts lives in `lib/api.ts`
 * (`getPaginatedPosts`) and builds on these primitives.
 *
 * Pagination convention used across the site:
 *   - Page 1 lives at the base path (e.g. `/home`).
 *   - Pages 2..N live at `<base>/page/<n>` (e.g. `/home/page/2`).
 * See `pageHref`.
 */

/** Default number of posts rendered per page on the home listing. */
export const POSTS_PER_PAGE = 5;

export interface Paginated<T> {
  items: T[];
  /** 1-indexed page number this slice represents. */
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Number of pages needed to hold `totalItems` at `perPage` items each. Always
 * at least 1 so a postless blog still has a valid page 1 to render.
 */
export function getTotalPages(totalItems: number, perPage: number): number {
  if (perPage <= 0) {
    throw new Error("perPage must be a positive integer");
  }
  if (totalItems <= 0) return 1;
  return Math.ceil(totalItems / perPage);
}

/**
 * Slice an already-sorted collection into the window for `page`. Posts are
 * expected to be sorted newest-first by the caller, so a lower page number
 * yields newer items. A page beyond the total returns an empty slice rather
 * than throwing, leaving notFound/redirect decisions to the caller.
 */
export function paginate<T>(items: T[], page: number, perPage: number): Paginated<T> {
  if (perPage <= 0) {
    throw new Error("perPage must be a positive integer");
  }

  const totalItems = items.length;
  const totalPages = getTotalPages(totalItems, perPage);
  const start = (page - 1) * perPage;
  const itemsForPage = start >= 0 && start < totalItems ? items.slice(start, start + perPage) : [];

  return {
    items: itemsForPage,
    page,
    perPage,
    totalItems,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/**
 * Canonical href for a given page number. Page 1 maps to the bare base path so
 * the home listing and its paginated siblings share one address space without
 * a `/page/1` duplicate (which would compete for the canonical URL).
 */
export function pageHref(basePath: string, page: number): string {
  if (page <= 1) return basePath;
  return `${basePath}/page/${page}`;
}
