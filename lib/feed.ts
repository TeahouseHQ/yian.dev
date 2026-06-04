import { Feed } from "feed";
import { getAllPosts } from "#/lib/api";
import { BaseUrl, SiteTitle, SiteDescription } from "#/lib/constants";
import markdownToHtml from "#/lib/markdownToHtml";

export async function generateRssFeed(): Promise<string> {
  const feed = new Feed({
    title: SiteTitle,
    description: SiteDescription,
    id: BaseUrl,
    link: BaseUrl,
    language: "en",
    image: `${BaseUrl}/og-image.png`,
    favicon: `${BaseUrl}/favicon-32x32.png`,
    copyright: `All rights reserved ${new Date().getFullYear()}, Yi-An Lai`,
    author: {
      name: "Yi-An Lai",
      link: BaseUrl,
    },
  });

  const posts = getAllPosts(["slug", "title", "date", "excerpt", "content", "coverImage"]);

  for (const post of posts) {
    const htmlContent = await markdownToHtml(post.content);

    feed.addItem({
      title: post.title,
      id: `${BaseUrl}/posts/${post.slug}`,
      link: `${BaseUrl}/posts/${post.slug}`,
      description: post.excerpt,
      content: htmlContent,
      date: new Date(post.date),
      image: post.coverImage ? `${BaseUrl}${post.coverImage}` : undefined,
    });
  }

  return feed.rss2();
}
