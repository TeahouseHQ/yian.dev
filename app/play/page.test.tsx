import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Index from "./page";

describe("/play page", () => {
  it("renders a tree-shaken inline SVG play icon, not a FontAwesome <i>", () => {
    const html = renderToStaticMarkup(<Index />);

    // lucide-react renders an inline <svg>...
    expect(html).toContain("<svg");
    // ...and no longer carries FontAwesome marker classes.
    expect(html).not.toContain("fa-play");
    expect(html).not.toMatch(/\bfas\b/);
  });
});
