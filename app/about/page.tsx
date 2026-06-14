import Link from "next/link";
import HomeLayout from "#/components/HomeLayout";

export default function AboutPage() {
  return (
    <HomeLayout route="/about">
      <h1 className="text-6xl font-bold tracking-tighter leading-tight md:pr-8">About</h1>
      <div className="max-w-2xl mx-auto">
        <div className="prose dark:prose-invert">
          <p>
            {/* Add your about content here */}
            This is the about page. You can add your personal information, background, skills, and
            interests here.
          </p>

          <h2>Resume</h2>
          <p>
            View my{" "}
            <Link href="/resume" className="underline">
              resume online
            </Link>{" "}
            or{" "}
            <a
              href="https://github.com/TeahouseHQ/yian.dev/releases/latest/download/resume.pdf"
              download
              className="underline"
            >
              download the PDF
            </a>
            .
          </p>
        </div>
      </div>
    </HomeLayout>
  );
}
