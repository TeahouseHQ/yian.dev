"use client";

const RESUME_PDF_URL = "https://github.com/yianL/yian.dev/releases/latest/download/resume.pdf";

export function ResumeDownload() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="no-print mb-6 flex gap-3 print:hidden">
      <a
        href={RESUME_PDF_URL}
        download
        className="px-4 py-2 bg-black text-white rounded hover:opacity-80 transition-opacity"
      >
        Download PDF
      </a>
      <button
        onClick={handlePrint}
        className="px-4 py-2 border border-black text-black rounded hover:bg-gray-100 transition-colors"
      >
        Print
      </button>
    </div>
  );
}
