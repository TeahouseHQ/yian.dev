interface Props {
  summary: string;
}

export function ResumeSummary({ summary }: Props) {
  return (
    <section className="mb-6 print:mb-3">
      <p className="text-sm leading-snug">{summary}</p>
    </section>
  );
}
