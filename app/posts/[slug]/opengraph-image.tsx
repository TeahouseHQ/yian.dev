import { ImageResponse } from "next/og";
import type Author from "types/author";

import PostOgCard from "#/components/PostOgCard";
import { getPostBySlug } from "#/lib/api";
import { SiteTitle } from "#/lib/constants";
import { OG_CONTENT_TYPE, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "#/lib/og";

// Next.js file-based metadata convention: exporting `size`, `contentType`, and
// `alt` from an `opengraph-image.tsx` in a route segment makes this default
// export the generator for that segment's `og:image`. It also feeds
// `twitter:image`, because the segment's `generateMetadata` deliberately omits
// `openGraph.images` / `twitter.images` and Next.js inherits twitter images
// from openGraph when they are absent.
export const alt = "Cover image for a Pedal Powered Dev blog post";
export const size = { width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT };
export const contentType = OG_CONTENT_TYPE;

interface Params {
  slug: string;
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<Params>;
}): Promise<ImageResponse> {
  const { slug } = await params;
  const post = getPostBySlug(slug, ["title", "date", "author"]);
  const author = post.author as unknown as Author | undefined;

  return new ImageResponse(
    <PostOgCard
      title={post.title}
      isoDate={post.date}
      authorName={author?.name}
      siteName={SiteTitle}
    />,
    size
  );
}
