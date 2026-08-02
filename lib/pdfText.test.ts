import { describe, expect, test } from "bun:test";
import { renderPageLayout, type PositionedItem } from "@/lib/pdfText";

const CHARGE_LINE =
  /^\s*(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s{2,}(Pay Over Time|Pay In Full|Cash Advance).*?\$([0-9,]+\.\d{2})\s*$/;

function cell(text: string, x: number, y: number): PositionedItem {
  return { text, x, y, width: text.length * 4.6 };
}

describe("renderPageLayout", () => {
  test("keeps the column gap the New Charges fallback parser matches on", () => {
    const rendered = renderPageLayout([
      cell("11/03/25", 56, 700),
      cell("FOOD CITY #711 CHATTANOOGA TN", 116, 700),
      cell("Pay Over Time", 348, 700),
      cell("$84.21", 470, 700)
    ]);

    expect(CHARGE_LINE.test(rendered)).toBe(true);
  });

  test("groups items onto lines by baseline rather than emission order", () => {
    const rendered = renderPageLayout([
      cell("Amount", 470, 684),
      cell("11/03/25", 56, 700),
      cell("Type", 348, 684),
      cell("Date", 56, 684)
    ]);

    const lines = rendered.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("11/03/25");
    expect(/^Date\s{2,}Type\s{2,}Amount$/.test(lines[1])).toBe(true);
  });

  test("pushes a colliding cell right instead of overwriting its neighbour", () => {
    const rendered = renderPageLayout([
      cell("A VERY LONG DESCRIPTION THAT RUNS PAST ITS COLUMN", 56, 700),
      cell("Pay In Full", 60, 700)
    ]);

    expect(rendered).toBe(
      "A VERY LONG DESCRIPTION THAT RUNS PAST ITS COLUMN Pay In Full"
    );
  });

  test("returns nothing for a page with no text items", () => {
    expect(renderPageLayout([])).toBe("");
  });
});
