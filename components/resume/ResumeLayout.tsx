import type { ResumeData } from "types/resume";
import { ResumeEducation } from "./ResumeEducation";
import { ResumeExperience } from "./ResumeExperience";
import { ResumeHashScroll } from "./ResumeHashScroll";
import { ResumeHeader } from "./ResumeHeader";
import { ResumeSkills } from "./ResumeSkills";
import { ResumeSummary } from "./ResumeSummary";
import { ResumeTimeline } from "./ResumeTimeline";
import { ResumeDownload } from "./ResumeDownload";

interface Props {
  data: ResumeData;
}

export function ResumeLayout({ data }: Props) {
  return (
    <div className="min-h-screen bg-white">
      <ResumeHashScroll />
      <div className="max-w-4xl mx-auto px-6 py-8 print:px-0 print:py-0 print:max-w-none">
        <ResumeDownload />
        <article className="bg-white text-black font-sans">
          <ResumeHeader contact={data.contact} />
          <ResumeSummary summary={data.summary} />
          <ResumeSkills skills={data.skills} />
          <ResumeTimeline experience={data.experience} education={data.education} />
          <ResumeExperience experience={data.experience} />
          <ResumeEducation education={data.education} />
        </article>
      </div>
    </div>
  );
}
