import { readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";

/**
 * Text extraction used both to feed OpenRouter a cheap text prompt and to drive
 * the `New Charges Details` fallback parser. The fallback matches on column
 * gaps, so pages are rendered onto a character grid rather than concatenated —
 * the same shape `pdftotext -layout` produces, without needing the binary
 * (Vercel's runtime has no Poppler).
 */
export async function extractPdfText(pdfPath: string) {
  try {
    return await extractPdfTextFromBytes(await readFile(pdfPath));
  } catch {
    return "";
  }
}

export async function extractPdfTextFromBytes(bytes: Uint8Array) {
  try {
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();

      pages.push(renderPageLayout(toPositionedItems(content.items)));
    }

    return pages.join("\n\f\n");
  } catch {
    return "";
  }
}

export type PositionedItem = {
  text: string;
  x: number;
  y: number;
  width: number;
};

/** pdfjs text items carry their own transform; only the translation matters. */
function toPositionedItems(items: readonly unknown[]): PositionedItem[] {
  const positioned: PositionedItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const { str, transform, width } = item as {
      str?: unknown;
      transform?: unknown;
      width?: unknown;
    };

    if (typeof str !== "string" || !str.trim() || !Array.isArray(transform)) {
      continue;
    }

    const x = Number(transform[4]);
    const y = Number(transform[5]);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    positioned.push({
      text: str,
      x,
      y,
      width: Number.isFinite(Number(width)) ? Number(width) : 0
    });
  }

  return positioned;
}

export function renderPageLayout(items: readonly PositionedItem[]) {
  if (items.length === 0) {
    return "";
  }

  const charWidth = estimateCharWidth(items);
  const originX = Math.min(...items.map((item) => item.x));

  return groupIntoLines(items)
    .map((line) => renderLine(line, originX, charWidth))
    .join("\n")
    .replace(/[ \t]+$/gm, "");
}

/**
 * A single grid step for the whole page. Erring narrow only ever widens gaps,
 * which keeps column separations intact; erring wide would merge columns and
 * silently break the fallback parser.
 */
function estimateCharWidth(items: readonly PositionedItem[]) {
  const widths = items
    .filter((item) => item.width > 0 && item.text.length > 0)
    .map((item) => item.width / item.text.length)
    .filter((width) => width > 0.5)
    .sort((left, right) => left - right);

  if (widths.length === 0) {
    return 5;
  }

  return widths[Math.floor(widths.length * 0.25)];
}

/** Items sharing a baseline form a line; PDFs emit them in arbitrary order. */
function groupIntoLines(items: readonly PositionedItem[]) {
  const sorted = [...items].sort((left, right) => right.y - left.y);
  const lines: PositionedItem[][] = [];
  let current: PositionedItem[] = [];
  let currentY = Number.NaN;

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(item.y - currentY) <= LINE_TOLERANCE) {
      if (current.length === 0) {
        currentY = item.y;
      }
      current.push(item);
      continue;
    }

    lines.push(current);
    current = [item];
    currentY = item.y;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.map((line) => line.sort((left, right) => left.x - right.x));
}

const LINE_TOLERANCE = 3;

function renderLine(
  line: readonly PositionedItem[],
  originX: number,
  charWidth: number
) {
  let rendered = "";

  for (const item of line) {
    const column = Math.max(0, Math.round((item.x - originX) / charWidth));
    // Never let a column collision swallow a neighbour; push it right instead.
    const start = rendered.length === 0 ? column : Math.max(column, rendered.length + 1);

    rendered = rendered.padEnd(start, " ") + item.text;
  }

  return rendered;
}
