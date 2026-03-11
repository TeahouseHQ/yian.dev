import { Metadata } from "next";
import { ResumeLayout } from "#/components/resume";
import resumeData from "#/data/resume.json";
import type { ResumeData } from "types/resume";

export const metadata: Metadata = {
  title: "Resume",
  description: "Yi-An Lai - Software Engineer Resume",
  alternates: {
    canonical: "/resume",
  },
};

export default function ResumePage() {
  return <ResumeLayout data={resumeData as ResumeData} />;
}
