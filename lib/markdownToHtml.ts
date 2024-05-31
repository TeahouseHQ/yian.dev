import rehypeFormat from "rehype-format";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export default async function markdownToHtml(
  markdown: string
): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeFormat)
    .use(rehypeHighlight, { plainText: ["txt", "text"] })
    .use(rehypeStringify)
    .process(markdown);
  return result.toString();
}
