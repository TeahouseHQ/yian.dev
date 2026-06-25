import { describe, it, expect } from "vitest";

import { POSTS_PER_PAGE, getTotalPages, paginate, pageHref } from "./pagination";

describe("getTotalPages", () => {
  it("returns at least 1 page when there are no posts", () => {
    expect(getTotalPages(0, 5)).toBe(1);
  });

  it("returns 1 page when posts fit exactly in a single page", () => {
    expect(getTotalPages(5, 5)).toBe(1);
  });

  it("rounds up partial trailing pages", () => {
    expect(getTotalPages(6, 5)).toBe(2);
    expect(getTotalPages(11, 5)).toBe(3);
    expect(getTotalPages(1, 5)).toBe(1);
  });

  it("throws on a non-positive per-page size", () => {
    expect(() => getTotalPages(10, 0)).toThrow();
    expect(() => getTotalPages(10, -1)).toThrow();
  });
});

describe("paginate", () => {
  it("slices the first page and reports correct bounds", () => {
    const result = paginate([1, 2, 3, 4, 5, 6, 7], 1, 3);

    expect(result.items).toEqual([1, 2, 3]);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(3);
    expect(result.totalItems).toBe(7);
    expect(result.hasPrev).toBe(false);
    expect(result.hasNext).toBe(true);
  });

  it("slices a middle page with both prev and next links", () => {
    const result = paginate([1, 2, 3, 4, 5, 6, 7], 2, 3);

    expect(result.items).toEqual([4, 5, 6]);
    expect(result.hasPrev).toBe(true);
    expect(result.hasNext).toBe(true);
  });

  it("slices the final page (may be partial) and has no next link", () => {
    const result = paginate([1, 2, 3, 4, 5, 6, 7], 3, 3);

    expect(result.items).toEqual([7]);
    expect(result.hasPrev).toBe(true);
    expect(result.hasNext).toBe(false);
  });

  it("treats an empty collection as a single empty page", () => {
    const result = paginate([], 1, 5);

    expect(result.items).toEqual([]);
    expect(result.totalPages).toBe(1);
    expect(result.hasPrev).toBe(false);
    expect(result.hasNext).toBe(false);
  });

  it("returns an empty slice for a page beyond the total", () => {
    const result = paginate([1, 2, 3], 5, 5);

    expect(result.items).toEqual([]);
    expect(result.totalPages).toBe(1);
  });
});

describe("pageHref", () => {
  it("returns the bare base path for page 1", () => {
    expect(pageHref("/home", 1)).toBe("/home");
  });

  it("appends /page/N for pages after the first", () => {
    expect(pageHref("/home", 2)).toBe("/home/page/2");
    expect(pageHref("/home", 3)).toBe("/home/page/3");
  });
});

describe("POSTS_PER_PAGE", () => {
  it("is a positive integer used as the site default", () => {
    expect(Number.isInteger(POSTS_PER_PAGE)).toBe(true);
    expect(POSTS_PER_PAGE).toBeGreaterThan(0);
  });
});
