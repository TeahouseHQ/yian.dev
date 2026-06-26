import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CopyButton from "./CopyButton";

describe("CopyButton", () => {
  it("renders a tree-shaken inline SVG copy icon instead of a FontAwesome <i>", () => {
    const html = renderToStaticMarkup(<CopyButton text="hello" />);

    // lucide-react renders an inline <svg>...
    expect(html).toContain("<svg");
    // ...and no longer carries FontAwesome marker classes.
    expect(html).not.toMatch(/fa-(regular|solid|brands|clone)\b/);
    expect(html).not.toMatch(/\bfas\b/);
  });

  it("keeps the accessible label and 'Copied!' tooltip span", () => {
    const html = renderToStaticMarkup(<CopyButton text="hello" />);
    expect(html).toMatch(/aria-label="Copy code to clipboard"/);
    expect(html).toContain("Copied!");
  });
});
