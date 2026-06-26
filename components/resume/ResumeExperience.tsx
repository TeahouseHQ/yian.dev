import type { Experience } from "types/resume";
import { formatDate } from "#/lib/resume";

import { Collapsible } from "./Collapsible";

interface Props {
  experience: Experience[];
}

export function ResumeExperience({ experience }: Props) {
  return (
    <section id="experience" className="mb-6 print:mb-3 scroll-mt-4">
      <h2 className="text-lg font-bold uppercase tracking-wide border-b border-black/30 mb-3 pb-1">
        Experience
      </h2>
      <div className="space-y-4 print:space-y-2">
        {experience.map((job, index) => (
          <Collapsible
            key={index}
            summary={
              <>
                <span className="font-bold">{job.company}</span>
                <span className="text-black/60"> | </span>
                <span className="italic">{job.title}</span>
              </>
            }
            meta={`${formatDate(job.startDate)} - ${formatDate(job.endDate)}`}
          >
            <ul className="ml-4 text-sm space-y-1 print:space-y-0">
              {job.highlights.map((highlight, hIndex) => (
                <li key={hIndex} className="list-disc">
                  {highlight}
                </li>
              ))}
            </ul>
          </Collapsible>
        ))}
      </div>
    </section>
  );
}
