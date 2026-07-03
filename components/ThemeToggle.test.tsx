import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeToggleButton } from "./ThemeToggle";
import ThemeToggle from "./ThemeToggle";

describe("ThemeToggleButton (presentational)", () => {
  it("renders a real <button> with an accessible, action-reflecting label in dark mode", () => {
    const html = renderToStaticMarkup(<ThemeToggleButton theme="dark" onToggle={() => {}} />);

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    // The label reflects the action a click will take (switch to light), and
    // the current state is independently exposed via aria-pressed.
    expect(html).toContain("Switch to light theme");
    expect(html).toContain('aria-pressed="false"');
    // Fixed in a top corner of the viewport, above the content.
    expect(html).toContain("fixed");
  });

  it("reflects the light state with the opposite action and aria-pressed", () => {
    const html = renderToStaticMarkup(<ThemeToggleButton theme="light" onToggle={() => {}} />);

    expect(html).toContain("Switch to dark theme");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("fixed");
  });

  it("marks the icon decorative so the label is the accessible name", () => {
    const html = renderToStaticMarkup(<ThemeToggleButton theme="dark" onToggle={() => {}} />);

    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("ThemeToggle (client wrapper)", () => {
  it("server-renders the dark default (no localStorage at SSR) as a fixed button", () => {
    // localStorage is unavailable during SSR, so first paint is always dark;
    // the stored preference is applied later, on mount, to avoid a mismatch.
    const html = renderToStaticMarkup(<ThemeToggle />);

    expect(html).toContain("<button");
    expect(html).toContain("fixed");
    expect(html).toContain("Switch to light theme");
  });
});
