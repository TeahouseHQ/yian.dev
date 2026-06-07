import type { ResumeData } from "types/resume";

interface Props {
  contact: ResumeData["contact"];
}

export function ResumeHeader({ contact }: Props) {
  return (
    <header className="mb-6 print:mb-3 border-b-2 border-black pb-4 print:pb-2">
      <div className="flex flex-col md:flex-row md:justify-between md:items-start print:flex-row print:justify-between print:items-start gap-2">
        <h1 className="text-4xl font-bold tracking-tight print:text-3xl">{contact.name}</h1>
        <div className="text-sm md:text-right print:text-right space-y-1">
          <div>{contact.phone}</div>
          <div>
            <a href={`mailto:${contact.email}`} className="hover:underline">
              {contact.email}
            </a>
          </div>
          <div>
            <a
              href={`https://linkedin.com${contact.linkedin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              linkedin.com{contact.linkedin}
            </a>
          </div>
          <div>{contact.location}</div>
        </div>
      </div>
    </header>
  );
}
