"use client";

export function ResumeDownload() {
  return (
    <div className="no-print mb-6 print:hidden">
      <a
        href="/Resume_YiAn_Lai_2026.pdf"
        download
        className="px-4 py-2 bg-black text-white rounded hover:opacity-80 transition-opacity"
      >
        Download PDF
      </a>
    </div>
  );
}
