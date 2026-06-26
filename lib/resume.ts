import type { Education, Experience, Skill, SkillEntry, TimelineEntry } from "types/resume";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Extract the leading 4-digit year from a "YYYY-MM" date string. */
export function parseYear(date: string): number {
  const match = /^\d{4}/.exec(date);
  return match ? parseInt(match[0], 10) : Number.NaN;
}

/** Format a "YYYY-MM" date as "Month Year"; a null end date renders "Present". */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Present";
  const [year, month] = dateStr.split("-");
  const monthIndex = parseInt(month, 10) - 1;
  const monthName = MONTH_NAMES[monthIndex] ?? month;
  return `${monthName} ${year}`;
}

/** Slugify a heading into a URL-hash-friendly id, e.g. "Skills" -> "skills". */
export function sectionId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalize a legacy string skill or a structured skill into an object. */
export function normalizeSkill(skill: SkillEntry): Skill {
  return typeof skill === "string" ? { name: skill } : skill;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute a 1..10 weight for a skill, used to size/style the tag. Years of
 * experience is the primary driver; proficiency (1..5) is scaled up as a
 * fallback. Skills with no data get a neutral mid weight so they don't
 * visually vanish next to weighted peers.
 */
export function computeSkillWeight(skill: SkillEntry): number {
  const s = normalizeSkill(skill);
  if (typeof s.years === "number" && Number.isFinite(s.years)) {
    return clamp(Math.round(s.years), 1, 10);
  }
  if (typeof s.proficiency === "number" && Number.isFinite(s.proficiency)) {
    return clamp(Math.round(s.proficiency) * 2, 1, 10);
  }
  return 5;
}

/** Map a 1..10 skill weight to a Tailwind class string for visual weighting. */
export function skillWeightClass(weight: number): string {
  if (weight >= 8) return "text-lg font-bold opacity-100";
  if (weight >= 6) return "text-base font-semibold opacity-90";
  if (weight >= 4) return "text-sm font-medium opacity-80";
  return "text-xs font-normal opacity-65";
}

/**
 * Build a chronological career timeline from experience + education. Returns
 * entries sorted most-recent-first for a top-down timeline, with the
 * currently-held role flagged for highlighting.
 */
export function buildCareerTimeline(
  experience: Experience[],
  education: Education[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const job of experience) {
    entries.push({
      year: parseYear(job.startDate),
      label: job.company,
      sublabel: job.title,
      type: "experience",
      current: job.endDate == null,
    });
  }

  for (const edu of education) {
    entries.push({
      year: parseYear(edu.startDate),
      label: edu.institution,
      sublabel: edu.degree,
      type: "education",
    });
  }

  return entries.sort((a, b) => b.year - a.year);
}
