import type { Education } from "types/resume";
import { formatDate } from "#/lib/resume";

interface Props {
  education: Education[];
}

export function ResumeEducation({ education }: Props) {
  return (
    <section id="education" className="mb-6 print:mb-3 scroll-mt-4">
      <h2 className="text-lg font-bold uppercase tracking-wide border-b border-black/30 mb-3 pb-1">
        Education
      </h2>
      <div className="space-y-2">
        {education.map((edu, index) => (
          <div
            key={index}
            className="resume-entry flex flex-col md:flex-row md:justify-between print:flex-row print:justify-between"
          >
            <div>
              <span className="font-bold">{edu.institution}</span>
              <span className="text-black/60"> - </span>
              <span className="italic">{edu.degree}</span>
            </div>
            <div className="text-sm text-black/60">
              {formatDate(edu.startDate)} - {formatDate(edu.endDate)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
