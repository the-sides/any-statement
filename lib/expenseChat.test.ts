import { describe, expect, test } from "bun:test";
import {
  answerExpenseQuestion,
  buildExpenseChatPrompt,
  resolveExpenseChatEdits
} from "@/lib/expenseChat";
import { applyExpenseEditsToRows } from "@/lib/expenseEdits";
import type { ExpenseChatRow } from "@/lib/expenseChat";
import type { ExpenseItem } from "@/lib/types";
const expensesWithoutMonth: ExpenseItem[] = [
  {
    id: "tx-food-1",
    statementId: "statement-1",
    date: "2026-06-01",
    postedDate: "2026-06-02",
    description: "FOOD CITY #711",
    merchant: "Food City",
    amount: 72.5,
    reimbursedAmount: 0,
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
    reimbursedAmount: 0,
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
    reimbursedAmount: 0,
    currency: "USD",
    category: "Software",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.94,
    notes: ""
  }
];

const expenses: ExpenseChatRow[] = expensesWithoutMonth.map((expense) => ({
  ...expense,
  month: "2026-06"
}));

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
  test("keeps valid chat edits and drops unknown rows and values", () => {
    const resolved = resolveExpenseChatEdits({
      rows: expenses,
      edits: [
        {
          expenseId: "tx-food-1",
          field: "category",
          value: "Groceries",
          reason: "Food City is a grocer."
        },
        {
          expenseId: "tx-missing",
          field: "category",
          value: "Groceries",
          reason: "Unknown row is dropped."
        },
        {
          expenseId: "tx-food-2",
          field: "category",
          value: "Not A Category",
          reason: "Unknown category is dropped."
        },
        {
          expenseId: "tx-software",
          field: "amount",
          value: "$18.999",
          reason: "Amount parses to cents."
        },
        {
          expenseId: "tx-software",
          field: "amount",
          value: "abc",
          reason: "Unparseable amount is dropped."
        },
        {
          expenseId: "tx-software",
          field: "notes",
          value: "Seats for the design team",
          reason: ""
        },
        {
          expenseId: "tx-food-1",
          field: "category",
          value: "Meals",
          reason: "No-op change is dropped."
        }
      ],
      categoryNames: ["Meals", "Groceries", "Software"]
    });

    expect(resolved.map((edit) => `${edit.expenseId}:${edit.field}`)).toEqual([
      "tx-food-1:category",
      "tx-software:amount",
      "tx-software:notes"
    ]);
    expect(resolved[0] && {
      month: resolved[0].month,
      before: resolved[0].before,
      after: resolved[0].after,
      rowLabel: resolved[0].rowLabel,
      date: resolved[0].date,
      reason: resolved[0].reason
    }).toEqual({
      month: "2026-06",
      before: "Meals",
      after: "Groceries",
      rowLabel: "Food City",
      date: "2026-06-01",
      reason: "Food City is a grocer."
    });
    expect(resolved[1]?.after).toBe(19);
  });

  test("applies approved edits to the right rows and skips stale ones", () => {
    const resolved = resolveExpenseChatEdits({
      rows: expenses,
      edits: [
        {
          expenseId: "tx-food-1",
          field: "category",
          value: "Groceries",
          reason: ""
        },
        {
          expenseId: "tx-software",
          field: "category",
          value: "Groceries",
          reason: ""
        }
      ],
      categoryNames: ["Meals", "Groceries", "Software"]
    });

    if (resolved.length !== 2) {
      throw new Error("expected both edits to resolve");
    }

    const first = applyExpenseEditsToRows(expenses, resolved);

    expect(first.applied).toBe(2);
    expect(
      first.expenses.find((row) => row.id === "tx-food-1")?.category
    ).toBe("Groceries");
    expect(
      first.expenses.find((row) => row.id === "tx-food-2")?.category
    ).toBe("Meals");

    const second = applyExpenseEditsToRows(first.expenses, [resolved[0]]);

    expect(second.applied).toBe(0);
    expect(second.expenses).toBe(first.expenses);
  });
});

