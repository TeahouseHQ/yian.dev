import { describe, expect, it } from "vitest";

import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, formatOgDate } from "./og";

describe("formatOgDate", () => {
  it("formats an ISO date as a long human-readable date", () => {
    expect(formatOgDate("2024-02-19T01:28:48Z")).toBe("February 19, 2024");
  });

  it("preserves the authored day regardless of timezone offset", () => {
    // The authored string is parsed as-is; date-fns parseISO keeps the wall-clock
    // components so the OG card shows the date the author wrote, not UTC-shifted.
    expect(formatOgDate("2024-05-31T03:48:47Z")).toBe("May 31, 2024");
  });
});

describe("OG image dimensions", () => {
  it("uses the 1200x630 social-card aspect ratio", () => {
    expect(OG_IMAGE_WIDTH).toBe(1200);
    expect(OG_IMAGE_HEIGHT).toBe(630);
    // ~1.91:1, the canonical Open Graph landscape ratio.
    expect((OG_IMAGE_WIDTH / OG_IMAGE_HEIGHT).toFixed(2)).toBe("1.90");
  });
});
