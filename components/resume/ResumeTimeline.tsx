import type { Education, Experience } from "types/resume";
import { buildCareerTimeline } from "#/lib/resume";

interface Props {
  experience: Experience[];
  education: Education[];
}

/**
 * Vertical career timeline: one milestone per experience/education start,
 * most-recent-first. Education entries render as an outlined dot to
 * distinguish them from work history. The whole timeline is hidden when
 * printing (the detailed sections already cover the same ground).
 */
export function ResumeTimeline({ experience, education }: Props) {
  const entries = buildCareerTimeline(experience, education);

  return (
    <section id="timeline" className="mb-6 print:mb-3 print:hidden scroll-mt-4">
      <h2 className="text-lg font-bold uppercase tracking-wide border-b border-black/30 mb-3 pb-1">
        Career Timeline
      </h2>
      <ol className="relative ml-2 space-y-3 border-l-2 border-black/20">
        {entries.map((entry, index) => (
          <li key={index} className="relative ml-4">
            <span
              className={`absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full border-2 border-black ${
                entry.type === "education" ? "bg-white" : "bg-black"
              }`}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-bold">{entry.year}</span>
              {entry.current && (
                <span className="rounded bg-black px-1 text-xs uppercase tracking-wide text-white">
                  Present
                </span>
              )}
            </div>
            <div className="text-sm">
              <span className="font-semibold">{entry.label}</span>
              {entry.sublabel && (
                <>
                  <span className="text-black/50"> — </span>
                  <span className="italic text-black/70">{entry.sublabel}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
