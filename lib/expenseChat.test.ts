import { describe, expect, test } from "bun:test";
import {
  answerExpenseQuestion,
  buildExpenseChatPrompt
} from "@/lib/expenseChat";
import type { ExpenseItem } from "@/lib/types";

const expenses: ExpenseItem[] = [
  {
    id: "tx-food-1",
    statementId: "statement-1",
    date: "2026-06-01",
    postedDate: "2026-06-02",
    description: "FOOD CITY #711",
    merchant: "Food City",
    amount: 72.5,
    currency: "USD",
    category: "Meals",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.95,
    notes: ""
  },
  {
    id: "tx-food-2",
    statementId: "statement-1",
    date: "2026-06-03",
    postedDate: "2026-06-03",
    description: "DOORDASH",
    merchant: "DoorDash",
    amount: 38.25,
    currency: "USD",
    category: "Meals",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.92,
    notes: ""
  },
  {
    id: "tx-software",
    statementId: "statement-1",
    date: "2026-06-04",
    postedDate: "2026-06-04",
    description: "FIGMA",
    merchant: "Figma",
    amount: 15,
    currency: "USD",
    category: "Software",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.94,
    notes: ""
  }
];

describe("expense chat", () => {
  test("builds prompt context from category, merchant, and selected rows", () => {
    const prompt = buildExpenseChatPrompt({
      question: "how could I minimize on food costs",
      expenses,
      selectedExpenseIds: ["tx-food-1"],
      statements: [
        {
          id: "statement-1",
          sourceFileName: "statement.pdf",
          statement: {
            institution: "American Express",
            accountMask: "12345",
            statementType: "credit_card",
            periodStart: "2026-06-01",
            periodEnd: "2026-06-30",
            currency: "USD",
            openingBalance: null,
            closingBalance: null,
            confidence: 0.9
          }
        }
      ]
    });

    expect(
      prompt.includes("Current question: how could I minimize on food costs")
    ).toBe(true);
    expect(prompt.includes("Selected rows: 1")).toBe(true);
    expect(prompt.includes("Meals: $110.75 across 2 rows")).toBe(true);
    expect(prompt.includes("Food City: $72.50 across 1 row")).toBe(true);
    expect(prompt.includes("[selected]")).toBe(true);
    expect(prompt.includes("American Express | acct 12345")).toBe(true);
  });

  test("sends expense context to OpenRouter and returns assistant text", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    let requestBody: Record<string, unknown> | undefined;

    process.env.OPENROUTER_API_KEY = "test-api-key";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Meals are $110.75. Cut DoorDash first, then consolidate grocery runs."
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const result = await answerExpenseQuestion({
        question: "food costs?",
        expenses,
        selectedExpenseIds: ["tx-food-1"]
      });

      if (!requestBody) {
        throw new Error("fetch was not called");
      }

      const messages = requestBody.messages as Array<{ content: string }>;

      expect(result.answer.includes("Meals are $110.75")).toBe(true);
      expect(result.context.rowCount).toBe(3);
      expect(result.context.selectedRowCount).toBe(1);
      expect(
        Boolean(messages[1]?.content.includes("Meals: $110.75 across 2 rows"))
      ).toBe(true);
      expect(
        Boolean(messages[1]?.content.includes("Current question: food costs?"))
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalApiKey;
      }
    }
  });
});
