import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import markdownToReact, { extractText } from "./markdownToReact";

describe("extractText", () => {
  it("recurses through React children to build the raw text", () => {
    const tree = (
      <pre>
        <code>
          {"const "}
          <span>x</span>
          {" = 1;"}
        </code>
      </pre>
    );
    expect(extractText(tree)).toBe("const x = 1;");
  });

  it("handles null, booleans, and arrays", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(false)).toBe("");
    expect(extractText(["a", "b", null, "c"])).toBe("abc");
  });
});

describe("markdownToReact", () => {
  it("renders a copy button inside every fenced code block", async () => {
    const md = [
      "Hello.",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "Mid paragraph.",
      "",
      "```",
      "plain text",
      "```",
    ].join("\n");

    const node = await markdownToReact(md);
    const html = renderToStaticMarkup(<>{node}</>);

    const preCount = (html.match(/<pre/g) ?? []).length;
    const copyButtonCount = (html.match(/aria-label="Copy code to clipboard"/g) ?? []).length;

    expect(preCount).toBe(2);
    expect(copyButtonCount).toBe(2);
    // The button is a direct child of <pre> so the existing pre > button CSS
    // applies. We check that the closing </pre> is preceded by a </button>.
    expect(html).toMatch(/<\/button><\/pre>/);
  });

  it("does not render copy buttons for inline code", async () => {
    const md = "This is `inline` code, not a block.";
    const node = await markdownToReact(md);
    const html = renderToStaticMarkup(<>{node}</>);
    expect(html).not.toMatch(/aria-label="Copy code to clipboard"/);
    expect(html).toMatch(/<code>inline<\/code>/);
  });
});
