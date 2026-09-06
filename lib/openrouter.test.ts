import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  getEnabledCategoryDefinitions
} from "@/lib/categories";
import {
  extractStatementFromCsv,
  extractStatementFromPdf
} from "@/lib/openrouter";

describe("extractStatementFromPdf", () => {
  test("sends usable local PDF text instead of invoking the file parser", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    const categories = getEnabledCategoryDefinitions(
      DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
    );
    let requestBody: Record<string, unknown> | undefined;

    process.env.OPENROUTER_API_KEY = "test-api-key";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  statement: {
                    institution: "American Express",
                    accountMask: "12345",
                    statementType: "credit_card",
                    periodStart: "",
                    periodEnd: "2026-06-03",
                    currency: "USD",
                    openingBalance: 0,
                    closingBalance: 10,
                    confidence: 0.9
                  },
                  expenses: [
                    {
                      id: "food-city",
                      date: "2026-05-06",
                      postedDate: "2026-05-06",
                      description: "FOOD CITY #711 CHATTANOOGA TN",
                      merchant: "FOOD CITY #711",
                      amount: 10,
                      currency: "USD",
                      category: "Meals",
                      subcategory: "",
                      paymentMethod: "card",
                      statementSection: "purchase",
                      confidence: 0.9,
                      notes: ""
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const file = new File([new Uint8Array([1, 2, 3])], "statement.pdf", {
        type: "application/pdf"
      });
      const pdfText = `Statement
New Charges Details
Date Description Type Amount
05/06/26 FOOD CITY #711 CHATTANOOGA TN Pay Over Time $10.00
${"transactions ".repeat(60)}`;

      const result = await extractStatementFromPdf(file, {
        categories,
        pdfText
      });

      if (!requestBody) {
        throw new Error("fetch was not called");
      }

      const messages = requestBody.messages as Array<{ content: unknown }>;
      const userContent = messages[1]?.content;

      expect(result.expenses.length).toBe(1);
      expect(requestBody.plugins).toBe(undefined);
      expect(typeof userContent).toBe("string");
      expect(String(userContent).includes("FOOD CITY #711")).toBe(true);
      expect(String(userContent).includes("file_data")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalApiKey;
      }
    }
  });

  test("sends CSV text through AI extraction without the file parser plugin", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    const categories = getEnabledCategoryDefinitions(
      DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
    );
    let requestBody: Record<string, unknown> | undefined;

    process.env.OPENROUTER_API_KEY = "test-api-key";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  statement: {
                    institution: "CSV Bank",
                    accountMask: "",
                    statementType: "bank",
                    periodStart: "2026-06-01",
                    periodEnd: "2026-06-30",
                    currency: "USD",
                    openingBalance: null,
                    closingBalance: null,
                    confidence: 0.8
                  },
                  expenses: [
                    {
                      id: "adobe",
                      date: "2026-06-05",
                      postedDate: "2026-06-05",
                      description: "ADOBE CREATIVE CLOUD",
                      merchant: "Adobe",
                      amount: 32.5,
                      currency: "USD",
                      category: "Software",
                      subcategory: "",
                      paymentMethod: "card",
                      statementSection: "purchase",
                      confidence: 0.92,
                      notes: "Import Guidance: merchant mapped to Software."
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const file = new File(
        ["Date,Description,Amount\n2026-06-05,ADOBE CREATIVE CLOUD,-32.50\n"],
        "transactions.csv",
        { type: "text/csv" }
      );

      const result = await extractStatementFromCsv(file, {
        categories,
        importGuidance: "Adobe is Software"
      });

      if (!requestBody) {
        throw new Error("fetch was not called");
      }

      const messages = requestBody.messages as Array<{ content: unknown }>;
      const userContent = messages[1]?.content;

      expect(result.expenses.length).toBe(1);
      expect(requestBody.plugins).toBe(undefined);
      expect(typeof userContent).toBe("string");
      expect(String(userContent).includes("<statement_csv>")).toBe(true);
      expect(String(userContent).includes("ADOBE CREATIVE CLOUD")).toBe(true);
      expect(String(userContent).includes("Adobe is Software")).toBe(true);
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
