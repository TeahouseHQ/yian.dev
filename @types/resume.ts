export interface ResumeData {
  meta: {
    version: string;
    lastUpdated: string;
  };
  contact: {
    name: string;
    phone: string;
    email: string;
    linkedin: string;
    location: string;
  };
  summary: string;
  skills: SkillEntry[];
  experience: Experience[];
  education: Education[];
}

export interface Skill {
  name: string;
  /** Years of experience; drives tag visual weighting when present. */
  years?: number;
  /** Optional 1..5 proficiency; used as a weight fallback. */
  proficiency?: number;
}

/**
 * A skill entry may be a plain string (legacy data) or a structured object
 * carrying weighting data. Components normalize via lib/resume.normalizeSkill.
 */
export type SkillEntry = string | Skill;

export interface Experience {
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
  highlights: string[];
}

export interface Education {
  institution: string;
  degree: string;
  startDate: string;
  endDate: string;
}

/** A single milestone on the career timeline. */
export interface TimelineEntry {
  /** Start year, used to order the timeline. NaN if the date is unparseable. */
  year: number;
  label: string;
  sublabel?: string;
  type: "experience" | "education";
  /** True when the experience has no end date (currently held). */
  current?: boolean;
}
