import Link from "next/link";

import { tagHref } from "#/lib/tags";

interface Props {
  tags?: string[];
}

/**
 * Render a post's tags as deep-link chips that filter the home listing. Side-
 * effect free and server-renderable so it can be mounted from any server
 * component (post header, post list card, post preview). Returns `null` when
 * there are no tags so callers can mount it unconditionally without leaving an
 * empty container in the DOM.
 */
const PostTags = ({ tags }: Props): React.JSX.Element | null => {
  if (!tags || tags.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            href={tagHref(tag)}
            className="inline-block rounded border border-foreground/30 px-2 py-0.5 text-sm text-comment transition-colors hover:border-green hover:text-green"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
};

export default PostTags;
