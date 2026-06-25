import { format, parseISO } from "date-fns";

/**
 * Canonical Open Graph landscape dimensions (1.91:1). Social preview tools
 * (Twitter/X, Facebook, LinkedIn, opengraph.xyz) all render at or near this
 * ratio, so the generated card avoids awkward cropping.
 */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export const OG_CONTENT_TYPE = "image/png";

/**
 * Format an ISO 8601 date as a long, locale-independent string for the OG card.
 *
 * `date-fns` `parseISO` keeps the wall-clock components of the authored string,
 * so the card shows the date the author wrote rather than a UTC-shifted value.
 * This mirrors `components/DateFormatter` (which renders "LLLL d, yyyy" in the
 * page) but uses the more verbose month name for a standalone social card where
 * there is no surrounding context.
 */
export function formatOgDate(isoDate: string): string {
  return format(parseISO(isoDate), "MMMM d, yyyy");
}
