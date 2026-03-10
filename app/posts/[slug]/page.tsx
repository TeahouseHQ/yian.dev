import { Metadata, ResolvingMetadata } from "next";
import Script from "next/script";

import type PostType from "types/post";

import { BlogPostJsonLd } from "#/components/JsonLd";
import CommentsBox from "../../../components/comments-box";
import Container from "../../../components/container";
import Layout from "../../../components/layout";
import PageFooter from "../../../components/page-footer";
import PostBody from "../../../components/post-body";
import PostHeader from "../../../components/post-header";
import { getAllPosts, getPostBySlug } from "../../../lib/api";
import { BaseUrl, Suffix } from "../../../lib/constants";
import markdownToHtml from "../../../lib/markdownToHtml";

export const dynamicParams = false;

interface Params {
  slug: string;
}

export async function generateMetadata(
  props: { params: Promise<Params> },
  _: ResolvingMetadata
): Promise<Metadata> {
  const params = await props.params;
  const { slug } = params;

  // fetch data
  const post = getPostBySlug(slug, ["title", "excerpt", "ogImage"]);

  return {
    title: post.title,
    description: post.excerpt,
    alternates: {
      canonical: `/posts/${slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      url: `/posts/${slug}`,
      type: "article",
      images: [post.ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: [post.ogImage],
    },
  };
}

export default async function Page(props: { params: Promise<Params> }): Promise<JSX.Element> {
  const params = await props.params;
  const post = await getPost(params);

  return (
    <Layout>
      <BlogPostJsonLd title={post.title} date={post.date} slug={post.slug} excerpt={post.excerpt} />
      <Container>
        <article className="mb-24 pt-16">
          <PostHeader
            title={post.title}
            coverImage={post.coverImage}
            date={post.date}
            author={post.author}
          />
          <PostBody content={post.content} />
        </article>
        <CommentsBox
          pageUrl={`${BaseUrl}/posts/${post.slug}`}
          pageId={post.id}
          enabled={post.commentsEnabled}
        />
        <PageFooter showMenu />
        <Script src="/assets/js/copy.js" />
      </Container>
    </Layout>
  );
}

export async function generateStaticParams(): Promise<Params[]> {
  const posts = getAllPosts(["slug"]);

  return posts.map((post) => ({
    slug: post.slug,
  }));
}

async function getPost(params): Promise<PostType> {
  const post = getPostBySlug(params.slug, [
    "id",
    "title",
    "date",
    "slug",
    "author",
    "content",
    "excerpt",
    "ogImage",
    "coverImage",
  ]);
  const content = await markdownToHtml(post.content || "");

  return {
    ...post,
    content,
  } as PostType;
}
