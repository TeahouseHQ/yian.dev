import HomeLayout from "#/components/home-layout";

export default function ProjectsPage() {
  return (
    <HomeLayout route="/projects">
      <h1 className="text-6xl font-bold tracking-tighter leading-tight md:pr-8">Projects</h1>
      <div className="max-w-2xl mx-auto">
        <div className="prose dark:prose-invert">
          <p>
            {/* Add your projects content here */}
            This is where you can showcase your projects. Add descriptions, links, and images of
            your work.
          </p>
        </div>
      </div>
    </HomeLayout>
  );
}
