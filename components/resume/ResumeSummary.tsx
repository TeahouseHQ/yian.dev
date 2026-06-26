interface Props {
  summary: string;
}

export function ResumeSummary({ summary }: Props) {
  return (
    <section id="summary" className="mb-6 print:mb-3 scroll-mt-4">
      <p className="text-sm leading-snug">{summary}</p>
    </section>
  );
}
