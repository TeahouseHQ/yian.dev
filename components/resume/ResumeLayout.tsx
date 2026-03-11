import type { ResumeData } from "types/resume";
import { ResumeHeader } from "./ResumeHeader";
import { ResumeSummary } from "./ResumeSummary";
import { ResumeSkills } from "./ResumeSkills";
import { ResumeExperience } from "./ResumeExperience";
import { ResumeEducation } from "./ResumeEducation";
import { ResumeDownload } from "./ResumeDownload";

interface Props {
  data: ResumeData;
}

export function ResumeLayout({ data }: Props) {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-8 print:px-0 print:py-0 print:max-w-none">
        <ResumeDownload />
        <article className="bg-white text-black">
          <ResumeHeader contact={data.contact} />
          <ResumeSummary summary={data.summary} />
          <ResumeSkills skills={data.skills} />
          <ResumeExperience experience={data.experience} />
          <ResumeEducation education={data.education} />
        </article>
      </div>
    </div>
  );
}
