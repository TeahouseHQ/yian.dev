import HomeLayout from "#/components/home-layout";

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
        </div>
      </div>
    </HomeLayout>
  );
}
