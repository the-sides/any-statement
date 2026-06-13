import { describe, expect, test } from "bun:test";
import {
  createReviewDraft,
  createReviewStatement,
  createStatementExpenses,
  parseReviewDraft
} from "@/lib/reviewDraft";
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
  test("creates and parses a multi-statement review draft", () => {
    const statement = createReviewStatement({
      id: "statement-a",
      statement: extraction.statement,
      sourceFileName: "statement.pdf"
    });
    const expenses = createStatementExpenses("statement-a", extraction.expenses);
    const draft = createReviewDraft({
      statements: [statement],
      expenses,
      selectedIds: [expenses[0].id, "missing"],
      activeStatementId: "statement-a"
    });
    const parsed = parseReviewDraft(JSON.parse(JSON.stringify(draft)));

    expect(parsed?.expenses.length).toBe(1);
    expect(parsed?.expenses[0].statementId).toBe("statement-a");
    expect(parsed?.selectedIds.length).toBe(1);
    expect(parsed?.selectedIds[0]).toBe(expenses[0].id);
    expect(parsed?.statements[0].sourceFileName).toBe("statement.pdf");
  });

  test("migrates the previous single-statement draft shape", () => {
    const parsed = parseReviewDraft({
      version: 1,
      extraction,
      selectedIds: ["tx-1"],
      sourceFileName: "legacy.pdf",
      savedAt: "2026-06-12T00:00:00.000Z"
    });

    expect(parsed?.version).toBe(2);
    expect(parsed?.statements.length).toBe(1);
    expect(parsed?.statements[0].sourceFileName).toBe("legacy.pdf");
    expect(parsed?.expenses[0].statementId).toBe(parsed?.statements[0].id);
    expect(parsed?.selectedIds.join(",")).toBe("tx-1");
  });

  test("rejects unknown draft shapes", () => {
    expect(parseReviewDraft({ version: 999 })).toBe(null);
    const parsed = parseReviewDraft({ version: 2, statements: null });

    expect(parsed?.version).toBe(2);
    expect(parsed?.statements.length).toBe(0);
    expect(parsed?.expenses.length).toBe(0);
    expect(parsed?.selectedIds.length).toBe(0);
    expect(parsed?.activeStatementId).toBe("");
  });
});
