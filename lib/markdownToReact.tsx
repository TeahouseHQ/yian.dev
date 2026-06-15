import { Children, isValidElement, type ReactNode } from "react";
import * as prod from "react/jsx-runtime";
import rehypeHighlight from "rehype-highlight";
import rehypeReact from "rehype-react";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import CopyButton from "#/components/CopyButton";

/**
 * Recursively extract the raw text content out of a React subtree. Used by
 * the custom <pre> renderer to seed each per-codeblock CopyButton with the
 * code that should be placed on the clipboard, without DOM scanning.
 */
export function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return Children.toArray(props.children ?? [])
      .map(extractText)
      .join("");
  }
  return "";
}

interface PreProps extends React.HTMLAttributes<HTMLPreElement> {
  children?: ReactNode;
}

/**
 * Custom <pre> renderer that mirrors rehype-stringify output but also injects
 * a per-codeblock React CopyButton. The button stays a direct child of <pre>
 * so the existing `pre > button` styles in styles/index.css apply unchanged.
 */
const Pre = ({ children, ...rest }: PreProps): React.JSX.Element => {
  const text = extractText(children);
  return (
    <pre {...rest}>
      {children}
      <CopyButton text={text} />
    </pre>
  );
};

// react/jsx-runtime's types don't quite line up with rehype-react's expected
// shape, so narrow the runtime once here rather than casting at each field.
const jsxRuntime = prod as unknown as {
  Fragment: typeof import("react").Fragment;
  jsx: unknown;
  jsxs: unknown;
};

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeHighlight, { plainText: ["txt", "text"] })
  .use(rehypeReact, {
    Fragment: jsxRuntime.Fragment,
    jsx: jsxRuntime.jsx,
    jsxs: jsxRuntime.jsxs,
    components: {
      pre: Pre,
    },
  } as Parameters<typeof rehypeReact>[0]);

/**
 * Convert a markdown string into a React node tree, with per-codeblock copy
 * buttons rendered as actual React components (no global DOM-scanning script).
 */
export default async function markdownToReact(markdown: string): Promise<ReactNode> {
  const file = await processor.run(processor.parse(markdown));
  // rehype-react installs a compiler that returns a React element.
  return processor.stringify(file as never) as unknown as ReactNode;
}
