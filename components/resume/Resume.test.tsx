import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Education, Experience, SkillEntry } from "types/resume";

import { ResumeExperience } from "./ResumeExperience";
import { ResumeSkills } from "./ResumeSkills";
import { ResumeTimeline } from "./ResumeTimeline";

describe("ResumeSkills", () => {
  const skills: SkillEntry[] = [
    { name: "Python", years: 12 },
    { name: "Typescript", years: 6 },
    { name: "Helm", years: 2 },
    "LegacyString",
  ];

  it("renders one weighted tag per skill, including legacy strings", () => {
    const html = renderToStaticMarkup(<ResumeSkills skills={skills} />);
    // One <li> per skill.
    const tagCount = (html.match(/<li/g) ?? []).length;
    expect(tagCount).toBe(skills.length);
    // Legacy string is still rendered by name.
    expect(html).toContain("LegacyString");
  });

  it("emits a data-weight per tag and varies the visual class by years", () => {
    const html = renderToStaticMarkup(<ResumeSkills skills={skills} />);
    // Clamped years (12 -> 10), mid years (6), low years (2), default (5).
    expect(html).toContain('data-weight="10"');
    expect(html).toContain('data-weight="6"');
    expect(html).toContain('data-weight="2"');
    expect(html).toContain('data-weight="5"');
    // The heaviest tag gets the boldest class, the lightest the smallest.
    expect(html).toContain("text-lg font-bold");
    expect(html).toContain("text-xs font-normal");
  });

  it("exposes a deep-linkable section id", () => {
    const html = renderToStaticMarkup(<ResumeSkills skills={skills} />);
    expect(html).toContain('id="skills"');
  });

  it("annotates weighted skills with their years of experience", () => {
    const html = renderToStaticMarkup(<ResumeSkills skills={skills} />);
    expect(html).toContain("12y");
    expect(html).not.toContain("LegacyStringy");
  });
});

describe("ResumeExperience", () => {
  const experience: Experience[] = [
    {
      company: "Gem",
      title: "Tech Lead Manager",
      startDate: "2023-08",
      endDate: null,
      highlights: ["Did a thing"],
    },
    {
      company: "MuleSoft",
      title: "MTS",
      startDate: "2017-04",
      endDate: "2022-05",
      highlights: ["Did another thing"],
    },
  ];

  it("renders a collapsible toggle per job with ARIA wiring", () => {
    const html = renderToStaticMarkup(<ResumeExperience experience={experience} />);
    // One toggle button per job (aria-expanded is on the collapsible control).
    const toggleCount = (html.match(/aria-expanded=/g) ?? []).length;
    expect(toggleCount).toBe(experience.length);
  });

  it("defaults every job to expanded so highlights render on first paint", () => {
    const html = renderToStaticMarkup(<ResumeExperience experience={experience} />);
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBe(experience.length);
    // Highlights are present in the SSR output (not hidden by default).
    expect(html).toContain("Did a thing");
    expect(html).toContain("Did another thing");
  });

  it("exposes a deep-linkable section id", () => {
    const html = renderToStaticMarkup(<ResumeExperience experience={experience} />);
    expect(html).toContain('id="experience"');
  });
});

describe("ResumeTimeline", () => {
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
      title: "MTS",
      startDate: "2017-04",
      endDate: "2022-05",
      highlights: [],
    },
  ];
  const education: Education[] = [
    {
      institution: "UCLA",
      degree: "MS, CS",
      startDate: "2013-09",
      endDate: "2015-03",
    },
  ];

  it("renders one milestone per merged entry, most-recent-first", () => {
    const html = renderToStaticMarkup(
      <ResumeTimeline experience={experience} education={education} />
    );
    expect(html).toContain("2023");
    expect(html).toContain("2017");
    expect(html).toContain("2013");
    // Most-recent year appears before the oldest in document order.
    expect(html.indexOf("2023")).toBeLessThan(html.indexOf("2013"));
  });

  it("flags the currently-held role with a Present marker", () => {
    const html = renderToStaticMarkup(
      <ResumeTimeline experience={experience} education={education} />
    );
    expect(html).toContain("Present");
  });
});
