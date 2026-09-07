import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  getEnabledCategoryDefinitions
} from "@/lib/categories";
import type { ExpenseCategoryCatalog } from "@/lib/categoryStore";
import { saveExpensesToNotion, type NotionConnection } from "@/lib/notion";
import type {
  ExpenseItem,
  SaveExpensesPayload,
  StatementSummary
} from "@/lib/types";

const EXPENSE_DATA_SOURCE_ID = "ddd53551-1dbb-4073-8fc7-0e7780246fed";
const CATEGORY_DATA_SOURCE_ID = "5d4f3cbe-4fd7-4b36-80a1-e472c179e472";
const SUBSCRIPTION_PAGE_ID = "ff6b9430-3170-4a49-9269-63568871e499";
const FOOD_PAGE_ID = "ca6a5cf6-363a-45df-9742-71490376087b";

const EXPENSE_SCHEMA = {
  Name: { id: "title", name: "Name", type: "title" },
  Date: { id: "date", name: "Date", type: "date" },
  Amount: { id: "amount", name: "Amount", type: "number" },
  Reimbursed: { id: "reimbursed", name: "Reimbursed", type: "number" },
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

const CONNECTION: NotionConnection = {
  apiKey: "test-api-key",
  dataSourceId: EXPENSE_DATA_SOURCE_ID,
  categoryDataSourceId: CATEGORY_DATA_SOURCE_ID
};

// No stored catalog, so the built-in categories stand in -- none of them carry
// a Notion `sourceId`, which keeps the relation matching in these tests purely
// name-based.
const CATEGORY_CATALOG: ExpenseCategoryCatalog = {
  categories: [...DEFAULT_EXPENSE_CATEGORY_DEFINITIONS],
  enabledCategories: getEnabledCategoryDefinitions(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  ),
  updatedAt: ""
};

const originalFetch = globalThis.fetch;

let createdPages: CapturedPage[] = [];

beforeEach(() => {
  createdPages = [];

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
});

describe("saveExpensesToNotion", () => {
  test("titles rows with the merchant and links the Notion category relation", async () => {
    const result = await save({
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
    await save({
      statement: STATEMENT,
      expenses: [expenseItem({ category: "  subscription " })]
    });

    expect(createdPages[0].properties.Category).toEqual({
      relation: [{ id: SUBSCRIPTION_PAGE_ID }]
    });
  });

  test("never writes the legacy Expense Category select", async () => {
    await save({
      statement: STATEMENT,
      expenses: [expenseItem({ category: "Subscription" })]
    });

    expect(createdPages).toHaveLength(1);
    expect(createdPages[0].properties["Expense Category"]).toBeUndefined();
  });

  test("leaves the relation empty and reports categories missing from Notion", async () => {
    const result = await save({
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

  test("writes reimbursed amounts when the property exists", async () => {
    await save({
      statement: STATEMENT,
      expenses: [expenseItem({ reimbursedAmount: 25 })]
    });

    expect(createdPages[0].properties.Reimbursed).toEqual({ number: 25 });
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
    reimbursedAmount: 0,
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

function save(payload: SaveExpensesPayload) {
  return saveExpensesToNotion(payload, {
    connection: CONNECTION,
    categoryCatalog: CATEGORY_CATALOG
  });
}
