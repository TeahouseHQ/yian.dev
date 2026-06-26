import type { SkillEntry } from "types/resume";
import { computeSkillWeight, normalizeSkill, skillWeightClass } from "#/lib/resume";

interface Props {
  skills: SkillEntry[];
}

export function ResumeSkills({ skills }: Props) {
  return (
    <section id="skills" className="mb-6 print:mb-3 scroll-mt-4">
      <h2 className="text-lg font-bold uppercase tracking-wide border-b border-black/30 mb-2 pb-1">
        Skills
      </h2>
      <ul className="flex flex-wrap gap-2 print:gap-1">
        {skills.map((skill, index) => {
          const s = normalizeSkill(skill);
          const weight = computeSkillWeight(skill);
          return (
            <li
              key={index}
              className={`inline-flex items-center rounded border border-black/20 bg-black/5 px-2 py-0.5 ${skillWeightClass(
                weight
              )}`}
              data-weight={weight}
            >
              {s.name}
              {typeof s.years === "number" && (
                <span
                  className="ml-1 text-xs text-black/50"
                  aria-label={`${s.years} years of experience`}
                >
                  {s.years}y
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
