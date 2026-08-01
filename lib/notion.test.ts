import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { saveExpensesToNotion } from "@/lib/notion";
import type { ExpenseItem, StatementSummary } from "@/lib/types";

const EXPENSE_DATA_SOURCE_ID = "ddd53551-1dbb-4073-8fc7-0e7780246fed";
const CATEGORY_DATA_SOURCE_ID = "5d4f3cbe-4fd7-4b36-80a1-e472c179e472";
const SUBSCRIPTION_PAGE_ID = "ff6b9430-3170-4a49-9269-63568871e499";
const FOOD_PAGE_ID = "ca6a5cf6-363a-45df-9742-71490376087b";

const EXPENSE_SCHEMA = {
  Name: { id: "title", name: "Name", type: "title" },
  Date: { id: "date", name: "Date", type: "date" },
  Amount: { id: "amount", name: "Amount", type: "number" },
  Merchant: { id: "merchant", name: "Merchant", type: "rich_text" },
  Description: { id: "desc", name: "Description", type: "rich_text" },
  Subcategory: { id: "subcat", name: "Subcategory", type: "rich_text" },
  Account: { id: "account", name: "Account", type: "rich_text" },
  Institution: { id: "institution", name: "Institution", type: "rich_text" },
  "Source File": { id: "source", name: "Source File", type: "rich_text" },
  Confidence: { id: "confidence", name: "Confidence", type: "number" },
  Notes: { id: "notes", name: "Notes", type: "rich_text" },
  "Expense Category": {
    id: "legacy",
    name: "Expense Category",
    type: "select"
  },
  Category: {
    id: "category",
    name: "Category",
    type: "relation",
    relation: { data_source_id: CATEGORY_DATA_SOURCE_ID }
  }
};

const CATEGORY_SCHEMA = {
  Name: { id: "title", name: "Name", type: "title" }
};

const CATEGORY_PAGES = [
  {
    object: "page",
    id: SUBSCRIPTION_PAGE_ID,
    properties: {
      Name: { type: "title", title: [{ plain_text: "Subscription" }] }
    }
  },
  {
    object: "page",
    id: FOOD_PAGE_ID,
    properties: {
      Name: { type: "title", title: [{ plain_text: "Food" }] }
    }
  }
];

const STATEMENT: StatementSummary = {
  institution: "American Express",
  accountMask: "12345",
  statementType: "credit_card",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  currency: "USD",
  openingBalance: 0,
  closingBalance: 100,
  confidence: 0.9
};

type CapturedPage = {
  parent: { data_source_id?: string };
  properties: Record<string, Record<string, unknown>>;
};

const originalFetch = globalThis.fetch;
const originalEnv = {
  apiKey: process.env.NOTION_API_KEY,
  dataSourceId: process.env.NOTION_DATA_SOURCE_ID,
  categoryDataSourceId: process.env.NOTION_CATEGORY_DATA_SOURCE_ID,
  artifactDir: process.env.STATEMENT_LEDGER_ARTIFACT_DIR
};

let createdPages: CapturedPage[] = [];

beforeEach(() => {
  createdPages = [];
  process.env.NOTION_API_KEY = "test-api-key";
  process.env.NOTION_DATA_SOURCE_ID = EXPENSE_DATA_SOURCE_ID;
  process.env.NOTION_CATEGORY_DATA_SOURCE_ID = CATEGORY_DATA_SOURCE_ID;
  // Missing on purpose: loadCategoryCatalog falls back to the built-in catalog.
  process.env.STATEMENT_LEDGER_ARTIFACT_DIR =
    "/tmp/statement-ledger-notion-test-missing";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";

    if (url.endsWith(`/data_sources/${EXPENSE_DATA_SOURCE_ID}`)) {
      return jsonResponse({
        object: "data_source",
        id: EXPENSE_DATA_SOURCE_ID,
        properties: EXPENSE_SCHEMA
      });
    }

    if (url.endsWith(`/data_sources/${CATEGORY_DATA_SOURCE_ID}`)) {
      return jsonResponse({
        object: "data_source",
        id: CATEGORY_DATA_SOURCE_ID,
        properties: CATEGORY_SCHEMA
      });
    }

    if (url.endsWith(`/data_sources/${CATEGORY_DATA_SOURCE_ID}/query`)) {
      return jsonResponse({ results: CATEGORY_PAGES, has_more: false });
    }

    if (url.endsWith("/v1/pages") && method === "POST") {
      const page = JSON.parse(String(init?.body)) as CapturedPage;
      createdPages.push(page);

      return jsonResponse({
        id: `page-${createdPages.length}`,
        url: `https://notion.so/page-${createdPages.length}`
      });
    }

    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("NOTION_API_KEY", originalEnv.apiKey);
  restoreEnv("NOTION_DATA_SOURCE_ID", originalEnv.dataSourceId);
  restoreEnv(
    "NOTION_CATEGORY_DATA_SOURCE_ID",
    originalEnv.categoryDataSourceId
  );
  restoreEnv("STATEMENT_LEDGER_ARTIFACT_DIR", originalEnv.artifactDir);
});

describe("saveExpensesToNotion", () => {
  test("titles rows with the merchant and links the Notion category relation", async () => {
    const result = await saveExpensesToNotion({
      sourceFileName: "activity.csv",
      statement: STATEMENT,
      expenses: [
        expenseItem({ merchant: "Hulu", category: "Subscription" }),
        expenseItem({
          id: "trader-joes",
          merchant: "Trader Joe's #787",
          category: "Food"
        })
      ]
    });

    expect(result.saved).toBe(2);
    expect(result.unmatchedCategories).toEqual([]);
    expect(titleOf(createdPages[0])).toBe("Hulu");
    expect(titleOf(createdPages[1])).toBe("Trader Joe's #787");
    expect(createdPages[0].properties.Category).toEqual({
      relation: [{ id: SUBSCRIPTION_PAGE_ID }]
    });
    expect(createdPages[1].properties.Category).toEqual({
      relation: [{ id: FOOD_PAGE_ID }]
    });
  });

  test("matches category names case-insensitively", async () => {
    await saveExpensesToNotion({
      statement: STATEMENT,
      expenses: [expenseItem({ category: "  subscription " })]
    });

    expect(createdPages[0].properties.Category).toEqual({
      relation: [{ id: SUBSCRIPTION_PAGE_ID }]
    });
  });

  test("never writes the legacy Expense Category select", async () => {
    await saveExpensesToNotion({
      statement: STATEMENT,
      expenses: [expenseItem({ category: "Subscription" })]
    });

    expect(createdPages).toHaveLength(1);
    expect(createdPages[0].properties["Expense Category"]).toBeUndefined();
  });

  test("leaves the relation empty and reports categories missing from Notion", async () => {
    const result = await saveExpensesToNotion({
      statement: STATEMENT,
      expenses: [
        expenseItem({ merchant: "Delta", category: "Other" }),
        expenseItem({ id: "wework", merchant: "WeWork", category: "Other" }),
        expenseItem({ id: "hulu", merchant: "Hulu", category: "Subscription" })
      ]
    });

    expect(result.saved).toBe(3);
    expect(result.unmatchedCategories).toEqual(["Other"]);
    expect(createdPages[0].properties.Category).toBeUndefined();
    expect(createdPages[1].properties.Category).toBeUndefined();
    expect(createdPages[2].properties.Category).toEqual({
      relation: [{ id: SUBSCRIPTION_PAGE_ID }]
    });
    expect(
      createdPages.every(
        (page) => page.parent.data_source_id === EXPENSE_DATA_SOURCE_ID
      )
    ).toBe(true);
  });
});

function expenseItem(overrides: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id: "hulu",
    date: "2026-06-11",
    postedDate: "2026-06-11",
    description: "Hulu Plus streaming subscription",
    merchant: "Hulu",
    amount: 51.44,
    currency: "USD",
    category: "Subscription",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.9,
    notes: "",
    ...overrides
  };
}

function titleOf(page: CapturedPage) {
  const title = page.properties.Name.title as Array<{
    text?: { content?: string };
  }>;

  return title[0]?.text?.content;
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
