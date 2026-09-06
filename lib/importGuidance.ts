/**
 * Import Guidance is the reviewer's standing instructions to the extraction
 * model: merchant-to-category corrections, naming quirks, rows to ignore. It is
 * shared by the browser, the API route, and the prompt builders, so the length
 * cap and normalization live here rather than being re-stated at each edge.
 */
export const MAX_IMPORT_GUIDANCE_LENGTH = 4000;

export function normalizeImportGuidance(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, MAX_IMPORT_GUIDANCE_LENGTH);
}
