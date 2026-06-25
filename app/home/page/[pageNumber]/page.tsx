import type { Metadata } from "next";
import { notFound } from "next/navigation";

import HomePosts from "#/components/HomePosts";
import { getAllPosts } from "#/lib/api";
import { POSTS_PER_PAGE, getTotalPages } from "#/lib/pagination";

export const dynamicParams = false;

interface Params {
  pageNumber: string;
}

/**
 * Only pre-render real pages 2..N. Page 1 lives at `/home` (not here), so it is
 * deliberately excluded to avoid a `/home/page/1` duplicate that would compete
 * with `/home` for the canonical URL. `dynamicParams = false` then makes any
 * out-of-range or `/page/1` request 404 rather than render at request time.
 */
export async function generateStaticParams(): Promise<Params[]> {
  const total = getAllPosts(["slug"]).length;
  const totalPages = getTotalPages(total, POSTS_PER_PAGE);

  const params: Params[] = [];
  for (let page = 2; page <= totalPages; page++) {
    params.push({ pageNumber: String(page) });
  }
  return params;
}

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { pageNumber } = await props.params;
  return {
    title: `Posts (Page ${pageNumber})`,
    alternates: { canonical: `/home/page/${pageNumber}` },
  };
}

export default async function Page(props: { params: Promise<Params> }): Promise<React.JSX.Element> {
  const { pageNumber } = await props.params;
  const page = Number(pageNumber);

  if (!Number.isInteger(page) || page < 2) {
    notFound();
  }

  return <HomePosts page={page} />;
}
