import { chromium } from "playwright";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const RESUME_JSON = join(process.cwd(), "data/resume.json");
const OUTPUT_PDF = join(process.cwd(), "public/Resume_YiAn_Lai_2026.pdf");
const HASH_FILE = join(process.cwd(), ".resume-hash");

async function generatePdf() {
  // Check if JSON changed
  const currentHash = createHash("md5").update(readFileSync(RESUME_JSON)).digest("hex");

  if (existsSync(HASH_FILE)) {
    const previousHash = readFileSync(HASH_FILE, "utf-8").trim();
    if (currentHash === previousHash) {
      console.log("✓ Resume JSON unchanged, skipping PDF generation");
      return;
    }
  }

  console.log("⏳ Generating resume PDF...");

  const baseUrl = process.env.BASE_URL || "http://localhost:3000";

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(`${baseUrl}/resume`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Hide the download button for PDF generation
    await page.evaluate(() => {
      const downloadDiv = document.querySelector(".no-print");
      if (downloadDiv) {
        (downloadDiv as HTMLElement).style.display = "none";
      }
    });

    await page.pdf({
      path: OUTPUT_PDF,
      format: "Letter",
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      printBackground: true,
    });

    // Save hash for next run
    writeFileSync(HASH_FILE, currentHash);

    console.log(`✓ PDF generated: ${OUTPUT_PDF}`);
  } catch (error) {
    console.error("✗ Failed to generate PDF:", error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

generatePdf();
