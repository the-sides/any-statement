import { describe, expect, test } from "bun:test";
import { createReviewDraft, parseReviewDraft } from "@/lib/reviewDraft";
import type { StatementExtraction } from "@/lib/types";

const extraction: StatementExtraction = {
  statement: {
    institution: "American Express",
    accountMask: "12345",
    statementType: "credit_card",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    currency: "USD",
    openingBalance: 0,
    closingBalance: 10,
    confidence: 0.9
  },
  expenses: [
    {
      id: "tx-1",
      date: "2026-05-06",
      postedDate: "2026-05-06",
      description: "FOOD CITY #711 CHATTANOOGA TN",
      merchant: "Food City #711",
      amount: 10,
      currency: "USD",
      category: "Food",
      subcategory: "Grocery",
      paymentMethod: "card",
      statementSection: "purchase",
      confidence: 0.95,
      notes: ""
    }
  ]
};

describe("review draft persistence", () => {
  test("creates and parses a persisted review draft", () => {
    const draft = createReviewDraft({
      extraction,
      items: extraction.expenses,
      selectedIds: ["tx-1", "missing"],
      sourceFileName: "statement.pdf"
    });
    const parsed = parseReviewDraft(JSON.parse(JSON.stringify(draft)));

    expect(parsed?.extraction.expenses.length).toBe(1);
    expect(parsed?.selectedIds.length).toBe(1);
    expect(parsed?.selectedIds[0]).toBe("tx-1");
    expect(parsed?.sourceFileName).toBe("statement.pdf");
  });

  test("rejects unknown draft shapes", () => {
    expect(parseReviewDraft({ version: 999 })).toBe(null);
    expect(parseReviewDraft({ version: 1, extraction: null })).toBe(null);
  });
});
