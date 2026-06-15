/**
 * Reading-time estimate utilities.
 *
 * A single source of truth so post previews and post headers display the
 * exact same value for a given piece of content.
 */

export const WORDS_PER_MINUTE = 200;

/**
 * Strip the most common markdown syntax so we count prose words, not
 * punctuation/markup. Intentionally lightweight; perfect accuracy is not
 * required for a reading-time estimate.
 */
function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/[#>*_~`>-]/g, " ") // common markdown punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(input: string): number {
  const cleaned = stripMarkdown(input);
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/**
 * Compute reading time in whole minutes (minimum 1). Deterministic for a
 * given input so previews and headers always agree.
 */
export function computeReadingTime(content: string, wpm: number = WORDS_PER_MINUTE): number {
  const words = countWords(content);
  if (words === 0) return 1;
  return Math.max(1, Math.ceil(words / wpm));
}

export function formatReadingTime(minutes: number): string {
  return `${minutes} min read`;
}
