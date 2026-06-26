import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PostTags from "./PostTags";

describe("PostTags", () => {
  it("renders one deep-link per tag", () => {
    const html = renderToStaticMarkup(<PostTags tags={["meta", "nextjs"]} />);
    // Two links, each pointing at the home listing filtered by that tag.
    expect(html).toContain('href="/home?tag=meta"');
    expect(html).toContain('href="/home?tag=nextjs"');
  });

  it("exposes each tag label with a # prefix as accessible text", () => {
    const html = renderToStaticMarkup(<PostTags tags={["unity"]} />);
    expect(html).toContain("#unity");
  });

  it("renders nothing when there are no tags", () => {
    expect(renderToStaticMarkup(<PostTags tags={[]} />)).toBe("");
    expect(renderToStaticMarkup(<PostTags />)).toBe("");
    expect(renderToStaticMarkup(<PostTags tags={undefined} />)).toBe("");
  });
});
