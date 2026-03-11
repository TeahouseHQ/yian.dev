import type { Experience } from "types/resume";

interface Props {
  experience: Experience[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Present";
  const [year, month] = dateStr.split("-");
  const monthNames = [
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
  ];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

export function ResumeExperience({ experience }: Props) {
  return (
    <section className="mb-6 print:mb-3">
      <h2 className="text-lg font-bold uppercase tracking-wide border-b border-black/30 mb-3 pb-1">
        Experience
      </h2>
      <div className="space-y-4 print:space-y-2">
        {experience.map((job, index) => (
          <div key={index} className="resume-entry">
            <div className="flex flex-col md:flex-row md:justify-between md:items-baseline">
              <div>
                <span className="font-bold">{job.company}</span>
                <span className="text-black/60"> | </span>
                <span className="italic">{job.title}</span>
              </div>
              <div className="text-sm text-black/60">
                {formatDate(job.startDate)} - {formatDate(job.endDate)}
              </div>
            </div>
            <ul className="mt-1 ml-4 text-sm space-y-1 print:space-y-0">
              {job.highlights.map((highlight, hIndex) => (
                <li key={hIndex} className="list-disc">
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
