interface Props {
  skills: string[];
}

export function ResumeSkills({ skills }: Props) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-bold uppercase tracking-wide border-b border-black/30 mb-2 pb-1">
        Skills
      </h2>
      <p className="text-sm">{skills.join(", ")}</p>
    </section>
  );
}
