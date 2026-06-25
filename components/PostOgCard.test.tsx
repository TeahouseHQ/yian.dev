import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PostOgCard from "./PostOgCard";

const baseProps = {
  title: "Hello World",
  isoDate: "2024-02-19T01:28:48Z",
  siteName: "Yi-An Lai | Pedal Powered Dev",
};

describe("PostOgCard", () => {
  it("renders the post title verbatim", () => {
    const html = renderToStaticMarkup(<PostOgCard {...baseProps} />);
    expect(html).toContain("Hello World");
  });

  it("renders the post date in long form", () => {
    const html = renderToStaticMarkup(<PostOgCard {...baseProps} />);
    expect(html).toContain("February 19, 2024");
  });

  it("renders the site branding", () => {
    const html = renderToStaticMarkup(<PostOgCard {...baseProps} />);
    expect(html).toContain("Pedal Powered Dev");
  });

  it("renders the author name when provided", () => {
    const html = renderToStaticMarkup(<PostOgCard {...baseProps} authorName="Yian" />);
    expect(html).toContain("Yian");
  });

  it("omits the author slot when no author is provided", () => {
    const html = renderToStaticMarkup(<PostOgCard {...baseProps} />);
    // No author span; the markup should still contain the date but only one
    // trailing text node (the date), no second name node.
    expect(html).toContain("February 19, 2024");
    expect(html).not.toMatch(/Yian/);
  });
});
