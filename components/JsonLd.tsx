import { BaseUrl } from "#/lib/constants";

export function PersonJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Yi-An Lai",
    url: BaseUrl,
    jobTitle: "Software Engineer",
    sameAs: [
      "https://www.linkedin.com/in/yi-an-lai-andrew/",
      "https://www.strava.com/athletes/yianlai",
      "https://github.com/yianl",
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

interface BlogPostJsonLdProps {
  title: string;
  date: string;
  slug: string;
  excerpt?: string;
}

export function BlogPostJsonLd({ title, date, slug, excerpt }: BlogPostJsonLdProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    description: excerpt,
    datePublished: date,
    dateModified: date,
    author: {
      "@type": "Person",
      name: "Yi-An Lai",
      url: BaseUrl,
    },
    publisher: {
      "@type": "Person",
      name: "Yi-An Lai",
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${BaseUrl}/posts/${slug}`,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
