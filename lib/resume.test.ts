import { describe, expect, it } from "vitest";

import type { Education, Experience } from "types/resume";

import {
  buildCareerTimeline,
  computeSkillWeight,
  formatDate,
  normalizeSkill,
  parseYear,
  sectionId,
  skillWeightClass,
} from "./resume";

describe("parseYear", () => {
  it("extracts the leading 4-digit year from a YYYY-MM date", () => {
    expect(parseYear("2023-08")).toBe(2023);
    expect(parseYear("2015-04")).toBe(2015);
  });

  it("returns NaN for unparseable input", () => {
    expect(parseYear("present")).toBeNaN();
    expect(parseYear("")).toBeNaN();
  });
});

describe("formatDate", () => {
  it("formats a YYYY-MM date as 'Month Year'", () => {
    expect(formatDate("2023-08")).toBe("August 2023");
    expect(formatDate("2022-05")).toBe("May 2022");
  });

  it("renders a null end date as 'Present'", () => {
    expect(formatDate(null)).toBe("Present");
  });
});

describe("sectionId", () => {
  it("slugifies a heading into a URL-hash-friendly id", () => {
    expect(sectionId("Experience")).toBe("experience");
    expect(sectionId("Skills & Tools")).toBe("skills-tools");
    expect(sectionId("  Leading/Trailing  ")).toBe("leading-trailing");
  });
});

describe("normalizeSkill", () => {
  it("wraps a legacy string skill into an object", () => {
    expect(normalizeSkill("Python")).toEqual({ name: "Python" });
  });

  it("passes a structured skill through untouched", () => {
    const skill = { name: "Python", years: 12 };
    expect(normalizeSkill(skill)).toBe(skill);
  });
});

describe("computeSkillWeight", () => {
  it("uses years of experience as the primary weight, clamped to 1..10", () => {
    expect(computeSkillWeight({ name: "Python", years: 12 })).toBe(10);
    expect(computeSkillWeight({ name: "New", years: 1 })).toBe(1);
    expect(computeSkillWeight({ name: "Solid", years: 7 })).toBe(7);
  });

  it("scales proficiency (1..5) up as a fallback weight", () => {
    expect(computeSkillWeight({ name: "A", proficiency: 5 })).toBe(10);
    expect(computeSkillWeight({ name: "B", proficiency: 1 })).toBe(2);
  });

  it("falls back to a neutral mid weight when no data is present", () => {
    expect(computeSkillWeight("Some Skill")).toBe(5);
    expect(computeSkillWeight({ name: "Mystery" })).toBe(5);
  });
});

describe("skillWeightClass", () => {
  it("maps higher weights to larger, bolder classes", () => {
    expect(skillWeightClass(10)).toBe("text-lg font-bold opacity-100");
    expect(skillWeightClass(7)).toBe("text-base font-semibold opacity-90");
    expect(skillWeightClass(5)).toBe("text-sm font-medium opacity-80");
    expect(skillWeightClass(2)).toBe("text-xs font-normal opacity-65");
  });
});

describe("buildCareerTimeline", () => {
  const experience: Experience[] = [
    {
      company: "Gem",
      title: "Tech Lead Manager",
      startDate: "2023-08",
      endDate: null,
      highlights: [],
    },
    {
      company: "MuleSoft",
      title: "Senior - Lead MTS",
      startDate: "2017-04",
      endDate: "2022-05",
      highlights: [],
    },
  ];

  const education: Education[] = [
    {
      institution: "UCLA",
      degree: "MS, Computer Science",
      startDate: "2013-09",
      endDate: "2015-03",
    },
  ];

  it("merges experience and education, sorted most-recent-first", () => {
    const timeline = buildCareerTimeline(experience, education);
    expect(timeline.map((e) => e.year)).toEqual([2023, 2017, 2013]);
  });

  it("marks the open-ended role as current", () => {
    const timeline = buildCareerTimeline(experience, education);
    const current = timeline.filter((e) => e.current);
    expect(current).toHaveLength(1);
    expect(current[0].label).toBe("Gem");
  });

  it("classifies entries by type and carries sublabels", () => {
    const timeline = buildCareerTimeline(experience, education);
    const edu = timeline.find((e) => e.type === "education");
    expect(edu?.label).toBe("UCLA");
    expect(edu?.sublabel).toBe("MS, Computer Science");
  });
});
