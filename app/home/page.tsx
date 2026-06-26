import HomePosts from "#/components/HomePosts";

interface SearchParams {
  /** Deep-linked tag filter (`/home?tag=<tag>`). See `tagHref`. */
  tag?: string;
}

/**
 * Page 1 of the home listing. Reads an optional `tag` query string so a tag
 * chip (e.g. on a post card) can deep-link to a filtered view of the listing.
 * Accessing `searchParams` opts this route into dynamic rendering; the no-tag
 * request still renders the same first page of posts.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const { tag } = await searchParams;
  return <HomePosts page={1} tag={tag} />;
}
