import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES
} from "@/lib/categories";
import type {
  ExpenseItem,
  SaveExpensesPayload,
  SaveExpensesResult
} from "@/lib/types";

const NOTION_VERSION = "2026-03-11";
const NOTION_PAGES_URL = "https://api.notion.com/v1/pages";
const NOTION_DATA_SOURCES_URL = "https://api.notion.com/v1/data_sources";

export class NotionSaveError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "NotionSaveError";
    this.status = status;
  }
}

export async function saveExpensesToNotion(
  payload: SaveExpensesPayload
): Promise<SaveExpensesResult> {
  const apiKey = process.env.NOTION_API_KEY;
  const dataSourceId = payload.dataSourceId || process.env.NOTION_DATA_SOURCE_ID;

  if (!apiKey) {
    throw new NotionSaveError(
      "NOTION_API_KEY is missing. Add it to .env.local before saving expenses.",
      503
    );
  }

  if (!dataSourceId) {
    throw new NotionSaveError(
      "NOTION_DATA_SOURCE_ID is missing. Add it to .env.local or enter one in the UI.",
      400
    );
  }

  if (!payload.expenses.length) {
    throw new NotionSaveError("Select at least one expense to save.", 400);
  }

  const schema = await ensureExpenseSchema(apiKey, dataSourceId);
  const pages = [];

  for (const expense of payload.expenses) {
    const response = await fetch(NOTION_PAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION
      },
      body: JSON.stringify({
        parent: {
          data_source_id: dataSourceId
        },
        properties: buildProperties(expense, payload, schema)
      })
    });

    const result = await readJson(response);

    if (!response.ok) {
      throw new NotionSaveError(
        getNotionError(result) ||
          `Notion rejected ${expense.merchant || expense.description}.`,
        response.status
      );
    }

    pages.push({
      id: String((result as { id?: string }).id || ""),
      url: String((result as { url?: string }).url || "")
    });
  }

  return {
    saved: pages.length,
    pages
  };
}

async function ensureExpenseSchema(apiKey: string, dataSourceId: string) {
  const dataSource = await retrieveDataSource(apiKey, dataSourceId);
  let schema = dataSource.properties;
  const patch = buildSchemaPatch(schema);

  if (Object.keys(patch).length === 0) {
    return schema;
  }

  const response = await fetch(`${NOTION_DATA_SOURCES_URL}/${dataSourceId}`, {
    method: "PATCH",
    headers: notionHeaders(apiKey),
    body: JSON.stringify({ properties: patch })
  });
  const result = await readJson(response);

  if (!response.ok) {
    throw new NotionSaveError(
      getNotionError(result) ||
        "Notion data source is missing expense columns and could not be updated.",
      response.status
    );
  }

  schema = (result as NotionDataSource).properties || schema;
  return schema;
}

async function retrieveDataSource(apiKey: string, dataSourceId: string) {
  const response = await fetch(`${NOTION_DATA_SOURCES_URL}/${dataSourceId}`, {
    headers: notionHeaders(apiKey)
  });
  const result = await readJson(response);

  if (!response.ok) {
    throw new NotionSaveError(
      getNotionError(result) || "Could not retrieve the Notion data source.",
      response.status
    );
  }

  return result as NotionDataSource;
}

function buildSchemaPatch(schema: NotionPropertyMap) {
  const patch: Record<string, unknown> = {};

  addMissingProperty(schema, patch, "Date", "date", { date: {} });
  addMissingProperty(schema, patch, "Amount", "number", {
    number: { format: "dollar" }
  });
  addMissingProperty(schema, patch, "Merchant", "rich_text", { rich_text: {} });
  addMissingProperty(schema, patch, "Description", "rich_text", {
    rich_text: {}
  });
  addMissingProperty(schema, patch, "Subcategory", "rich_text", {
    rich_text: {}
  });
  addMissingProperty(schema, patch, "Currency", "select", {
    select: { options: selectOptions(["USD"]) }
  });
  addMissingProperty(schema, patch, "Payment Method", "select", {
    select: { options: selectOptions(PAYMENT_METHODS) }
  });
  addMissingProperty(schema, patch, "Section", "select", {
    select: { options: selectOptions(STATEMENT_SECTIONS) }
  });
  addMissingProperty(schema, patch, "Statement", "select", {
    select: { options: selectOptions(STATEMENT_TYPES) }
  });
  addMissingProperty(schema, patch, "Account", "rich_text", { rich_text: {} });
  addMissingProperty(schema, patch, "Institution", "rich_text", {
    rich_text: {}
  });
  addMissingProperty(schema, patch, "Statement Period", "rich_text", {
    rich_text: {}
  });
  addMissingProperty(schema, patch, "Source File", "rich_text", {
    rich_text: {}
  });
  addMissingProperty(schema, patch, "Confidence", "number", {
    number: { format: "number" }
  });
  addMissingProperty(schema, patch, "Notes", "rich_text", { rich_text: {} });

  const categoryProperty = schema.Category;
  if (!categoryProperty) {
    patch.Category = {
      select: { options: selectOptions(EXPENSE_CATEGORIES) }
    };
  } else if (categoryProperty.type !== "select") {
    addMissingProperty(schema, patch, "Expense Category", "select", {
      select: { options: selectOptions(EXPENSE_CATEGORIES) }
    });
  }

  return patch;
}

function addMissingProperty(
  schema: NotionPropertyMap,
  patch: Record<string, unknown>,
  name: string,
  type: NotionPropertyType,
  value: unknown
) {
  if (!schema[name]) {
    patch[name] = value;
    return;
  }

  if (schema[name].type !== type) {
    return;
  }
}

function buildProperties(
  expense: ExpenseItem,
  payload: SaveExpensesPayload,
  schema: NotionPropertyMap
) {
  const statement = payload.statement;
  const name = [
    expense.date,
    expense.merchant || expense.description || "Expense"
  ]
    .filter(Boolean)
    .join(" - ");
  const properties: Record<string, unknown> = {};
  const titleProperty = findProperty(schema, "title");

  if (!titleProperty) {
    throw new NotionSaveError(
      "The Notion data source needs a title property before rows can be created.",
      400
    );
  }

  properties[titleProperty] = {
    title: richText(name)
  };

  setDate(properties, schema, "Date", expense.date);
  setRichText(properties, schema, "Merchant", expense.merchant);
  setRichText(properties, schema, "Description", expense.description);
  setRichText(properties, schema, "Subcategory", expense.subcategory);
  setNumber(properties, schema, "Amount", expense.amount);
  setSelect(
    properties,
    schema,
    "Expense Category",
    expense.category,
    "Category"
  );
  setSelect(properties, schema, "Currency", expense.currency || statement.currency);
  setSelect(properties, schema, "Payment Method", expense.paymentMethod);
  setSelect(properties, schema, "Section", expense.statementSection);
  setSelect(properties, schema, "Statement", statement.statementType);
  setRichText(properties, schema, "Account", statement.accountMask);
  setRichText(properties, schema, "Institution", statement.institution);
  setRichText(
    properties,
    schema,
    "Statement Period",
    [statement.periodStart, statement.periodEnd].filter(Boolean).join(" to ")
  );
  setRichText(properties, schema, "Source File", payload.sourceFileName || "");
  setNumber(properties, schema, "Confidence", expense.confidence);
  setRichText(properties, schema, "Notes", expense.notes);

  return properties;
}

function setDate(
  properties: Record<string, unknown>,
  schema: NotionPropertyMap,
  name: string,
  value: string
) {
  if (!value || schema[name]?.type !== "date") {
    return;
  }

  properties[name] = {
    date: { start: value }
  };
}

function setNumber(
  properties: Record<string, unknown>,
  schema: NotionPropertyMap,
  name: string,
  value: number
) {
  if (schema[name]?.type !== "number") {
    return;
  }

  properties[name] = { number: value };
}

function setRichText(
  properties: Record<string, unknown>,
  schema: NotionPropertyMap,
  name: string,
  value: string
) {
  if (schema[name]?.type !== "rich_text") {
    return;
  }

  properties[name] = { rich_text: richText(value) };
}

function setSelect(
  properties: Record<string, unknown>,
  schema: NotionPropertyMap,
  preferredName: string,
  value: string,
  fallbackName?: string
) {
  const propertyName = [preferredName, fallbackName]
    .filter(Boolean)
    .find((name) => schema[String(name)]?.type === "select");

  if (!propertyName || !value) {
    return;
  }

  properties[propertyName] = {
    select: {
      name: value
    }
  };
}

function findProperty(schema: NotionPropertyMap, type: NotionPropertyType) {
  return Object.entries(schema).find(([, property]) => property.type === type)?.[0];
}

function richText(content: string) {
  const safeContent = content.slice(0, 1900);
  return safeContent
    ? [
        {
          text: {
            content: safeContent
          }
        }
      ]
    : [];
}

function selectOptions(options: readonly string[]) {
  return options.map((name) => ({
    name,
    color: "default"
  }));
}

function notionHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getNotionError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  return String((payload as { message?: string }).message || "");
}

type NotionPropertyType =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "people"
  | "files"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "formula"
  | "relation"
  | "rollup"
  | "created_time"
  | "created_by"
  | "last_edited_time"
  | "last_edited_by";

type NotionPropertySchema = {
  id: string;
  name: string;
  type: NotionPropertyType;
};

type NotionPropertyMap = Record<string, NotionPropertySchema>;

type NotionDataSource = {
  object: "data_source";
  id: string;
  properties: NotionPropertyMap;
};
