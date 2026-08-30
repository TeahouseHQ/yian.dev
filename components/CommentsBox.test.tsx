import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import CommentsBox from "./CommentsBox";

describe("CommentsBox (server render)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubConfiguredEnv() {
    vi.stubEnv("NEXT_PUBLIC_GISCUS_REPO_ID", "R_kgDOabc");
    vi.stubEnv("NEXT_PUBLIC_GISCUS_CATEGORY_ID", "DIC_kwDOxyz");
  }

  it("renders nothing when comments are disabled for the post", () => {
    stubConfiguredEnv();

    expect(renderToStaticMarkup(<CommentsBox term="post-uuid" />)).toBe("");
  });

  it("renders nothing while Giscus is unconfigured (ids unset)", () => {
    expect(renderToStaticMarkup(<CommentsBox term="post-uuid" enabled />)).toBe("");
  });

  it("renders the giscus host container for an enabled, configured post", () => {
    stubConfiguredEnv();

    const html = renderToStaticMarkup(<CommentsBox term="post-uuid" enabled />);

    // The host is the mount point the client effect fills with the Giscus
    // <script>; its data attribute is the stable public marker.
    expect(html).toContain("data-giscus-host");
    // No third-party script is emitted during SSR — injection is client-only.
    expect(html).not.toContain("giscus.app/client.js");
  });
});
