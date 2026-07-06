import { parseISO } from "date-fns";

/**
 * Canonical Open Graph landscape dimensions (1.91:1). Social preview tools
 * (Twitter/X, Facebook, LinkedIn, opengraph.xyz) all render at or near this
 * ratio, so the generated card avoids awkward cropping.
 */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export const OG_CONTENT_TYPE = "image/png";

/**
 * Long-date formatter pinned to UTC so the output depends only on the authored
 * ISO string, never on the machine's `TZ`. `date-fns` `format` renders in local
 * time, which shifts the day for offsets west of UTC (e.g. `...T03:48Z` reads as
 * the previous day in `UTC−7`); `Intl` with `timeZone: "UTC"` avoids that.
 */
const UTC_LONG_DATE = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Format an ISO 8601 date as a long, locale-independent string for the OG card.
 *
 * The card shows the date the author wrote (the UTC calendar day of the ISO
 * instant) regardless of the rendering machine's timezone. This mirrors
 * `components/DateFormatter` but uses the more verbose month name for a
 * standalone social card where there is no surrounding context.
 */
export function formatOgDate(isoDate: string): string {
  return UTC_LONG_DATE.format(parseISO(isoDate));
}
