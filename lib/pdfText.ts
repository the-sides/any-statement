import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractPdfText(pdfPath: string) {
  try {
    const { stdout } = await execFileAsync("pdftotext", [
      "-layout",
      pdfPath,
      "-"
    ]);
    return stdout;
  } catch {
    return "";
  }
}
