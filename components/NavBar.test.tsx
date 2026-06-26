import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NavBar from "./NavBar";

describe("NavBar", () => {
  // usePathname() is null during SSR, so the active route resolves to "/" which
  // the Home section owns, and the mobile panel renders closed.
  const html = renderToStaticMarkup(<NavBar />);

  it("renders the brand mark linking home", () => {
    expect(html).toContain('href="/home"');
    expect(html).toContain("PPD");
  });

  it("renders one link per NAV_LINK in the desktop strip", () => {
    for (const href of ["/home", "/about", "/projects", "/play", "/resume"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("renders the hamburger toggle wired to the mobile panel id", () => {
    expect(html).toContain('aria-controls="primary-nav-mobile"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Open menu"');
  });

  it("labels the nav as the primary landmark", () => {
    expect(html).toContain('aria-label="Primary"');
  });
});
