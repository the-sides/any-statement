import {
  normalizeCategoryName,
  type ExpenseCategoryDefinitionInput
} from "@/lib/categories";
import {
  loadCategoryCatalog,
  type ExpenseCategoryCatalog
} from "@/lib/categoryStore";
import type {
  ExpenseItem,
  SaveExpensesPayload,
  SaveExpensesResult,
  SaveStatementSource
} from "@/lib/types";

const NOTION_VERSION = "2026-03-11";
const NOTION_PAGES_URL = "https://api.notion.com/v1/pages";
const NOTION_DATA_SOURCES_URL = "https://api.notion.com/v1/data_sources";
const NOTION_QUERY_PAGE_SIZE = 100;

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

  const categoryCatalog = await loadCategoryCatalog();
  const resolvedDataSourceId = await resolveDataSourceId(apiKey, dataSourceId);
  const schema = await ensureExpenseSchema(apiKey, resolvedDataSourceId);
  const categoryResolver = await createCategoryResolver(
    apiKey,
    schema,
    categoryCatalog
  );
  const categoryPageIds = await resolveExpenseCategoryPageIds(
    categoryResolver,
    payload.expenses
  );
  const statementById = new Map(
    (payload.statements || []).map((statement) => [statement.id, statement])
  );
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
          data_source_id: resolvedDataSourceId
        },
        properties: buildProperties(
          expense,
          payload,
          schema,
          statementById,
          categoryPageIds.get(normalizeCategoryKey(expense.category))
        )
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

export async function fetchCategoryDefinitionsFromNotion(dataSourceId?: string) {
  const apiKey = process.env.NOTION_API_KEY;
  const categoryDataSourceId =
    dataSourceId || process.env.NOTION_CATEGORY_DATA_SOURCE_ID;

  if (!apiKey) {
    throw new NotionSaveError(
      "NOTION_API_KEY is missing. Add it to .env.local before importing categories.",
      503
    );
  }

  if (!categoryDataSourceId) {
    throw new NotionSaveError(
      "NOTION_CATEGORY_DATA_SOURCE_ID is missing. Add it to .env.local before importing categories.",
      400
    );
  }

  const resolvedDataSourceId = await resolveDataSourceId(
    apiKey,
    categoryDataSourceId
  );
  const dataSource = await retrieveDataSource(apiKey, resolvedDataSourceId);
  const titleProperty = findProperty(dataSource.properties, "title");
  const pages = await queryDataSourcePages(apiKey, resolvedDataSourceId);

  return pages
    .map((page, index) =>
      categoryDefinitionFromPage(page, titleProperty, index)
    )
    .filter((category): category is ExpenseCategoryDefinitionInput => Boolean(category));
}

async function ensureExpenseSchema(
  apiKey: string,
  dataSourceId: string
) {
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

function retrieveDataSource(
  apiKey: string,
  dataSourceId: string
): Promise<NotionDataSource>;
function retrieveDataSource(
  apiKey: string,
  dataSourceId: string,
  options: { allowNotFound: true }
): Promise<NotionDataSource | null>;
async function retrieveDataSource(
  apiKey: string,
  dataSourceId: string,
  options: { allowNotFound?: boolean } = {}
): Promise<NotionDataSource | null> {
  const response = await fetch(`${NOTION_DATA_SOURCES_URL}/${dataSourceId}`, {
    headers: notionHeaders(apiKey)
  });
  const result = await readJson(response);

  if (!response.ok) {
    if (response.status === 404 && options.allowNotFound) {
      return null;
    }

    throw new NotionSaveError(
      getNotionError(result) || "Could not retrieve the Notion data source.",
      response.status
    );
  }

  return result as NotionDataSource;
}

async function retrieveDatabase(apiKey: string, databaseId: string) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: notionHeaders(apiKey)
  });
  const result = await readJson(response);

  if (!response.ok) {
    throw new NotionSaveError(
      getNotionError(result) ||
        "Could not retrieve the Notion database or data source.",
      response.status
    );
  }

  return result as NotionDatabase;
}

async function resolveDataSourceId(apiKey: string, id: string) {
  const dataSource = await retrieveDataSource(apiKey, id, { allowNotFound: true });

  if (dataSource) {
    return dataSource.id;
  }

  const database = await retrieveDatabase(apiKey, id);
  const dataSourceId = database.data_sources?.[0]?.id;

  if (!dataSourceId) {
    throw new NotionSaveError(
      "The Notion database does not expose a data source.",
      400
    );
  }

  return dataSourceId;
}

async function queryDataSourcePages(apiKey: string, dataSourceId: string) {
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const response = await fetch(`${NOTION_DATA_SOURCES_URL}/${dataSourceId}/query`, {
      method: "POST",
      headers: notionHeaders(apiKey),
      body: JSON.stringify({
        page_size: NOTION_QUERY_PAGE_SIZE,
        start_cursor: startCursor
      })
    });
    const result = await readJson(response);

    if (!response.ok) {
      throw new NotionSaveError(
        getNotionError(result) || "Could not query the Notion category data source.",
        response.status
      );
    }

    const payload = result as NotionQueryResponse;
    const results = Array.isArray(payload.results) ? payload.results : [];
    pages.push(
      ...results.filter(
        (page) => !page.archived && !page.in_trash && page.object === "page"
      )
    );

    startCursor =
      payload.has_more && payload.next_cursor ? payload.next_cursor : undefined;
  } while (startCursor);

  return pages;
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
  addMissingProperty(schema, patch, "Account", "rich_text", { rich_text: {} });
  addMissingProperty(schema, patch, "Institution", "rich_text", {
    rich_text: {}
  });
  addMissingProperty(schema, patch, "Source File", "rich_text", {
    rich_text: {}
  });
  addMissingProperty(schema, patch, "Confidence", "number", {
    number: { format: "number" }
  });
  addMissingProperty(schema, patch, "Notes", "rich_text", { rich_text: {} });

  return patch;
}

function categoryDefinitionFromPage(
  page: NotionPage,
  titlePropertyName: string | undefined,
  index: number
): ExpenseCategoryDefinitionInput | null {
  const name =
    getTextProperty(page.properties, titlePropertyName) ||
    getTextProperty(page.properties, findPropertyInPage(page.properties, "title"));

  if (!name) {
    return null;
  }

  return {
    name,
    enabled: getEnabledProperty(page.properties),
    description:
      getTextProperty(
        page.properties,
        findNamedPageProperty(page.properties, [
          "Description",
          "Notes",
          "Prompt",
          "Instructions"
        ])
      ) || "",
    source: "notion",
    sourceId: page.id,
    sortOrder: getNumberProperty(
      page.properties,
      findNamedPageProperty(page.properties, ["Sort", "Order", "Priority"])
    ) ?? (index + 1) * 10
  };
}

function getEnabledProperty(properties: NotionPagePropertyMap) {
  const explicitProperty = findNamedPageProperty(properties, [
    "Enabled",
    "Active",
    "Use",
    "Include",
    "Import"
  ]);
  const property = explicitProperty ? properties[explicitProperty] : undefined;

  if (property?.type === "checkbox") {
    return Boolean(property.checkbox);
  }

  const statusProperty = findNamedPageProperty(properties, [
    "Status",
    "State",
    "Visibility"
  ]);
  const status = statusProperty
    ? getStatusLikePropertyValue(properties[statusProperty])
    : "";

  if (["disabled", "inactive", "off", "excluded", "ignore"].includes(status)) {
    return false;
  }

  return true;
}

function getStatusLikePropertyValue(property: NotionPageProperty | undefined) {
  if (property?.type === "status") {
    return String(property.status?.name || "").trim().toLowerCase();
  }

  if (property?.type === "select") {
    return String(property.select?.name || "").trim().toLowerCase();
  }

  return "";
}

function getTextProperty(
  properties: NotionPagePropertyMap,
  propertyName: string | undefined
) {
  if (!propertyName) {
    return "";
  }

  const property = properties[propertyName];

  if (property?.type === "title") {
    return plainText(property.title);
  }

  if (property?.type === "rich_text") {
    return plainText(property.rich_text);
  }

  if (property?.type === "select") {
    return String(property.select?.name || "").trim();
  }

  if (property?.type === "status") {
    return String(property.status?.name || "").trim();
  }

  return "";
}

function getNumberProperty(
  properties: NotionPagePropertyMap,
  propertyName: string | undefined
) {
  if (!propertyName) {
    return undefined;
  }

  const property = properties[propertyName];

  return property?.type === "number" && typeof property.number === "number"
    ? property.number
    : undefined;
}

function findNamedPageProperty(
  properties: NotionPagePropertyMap,
  names: readonly string[]
) {
  const normalizedNames = names.map((name) => name.toLowerCase());

  return Object.keys(properties).find((name) =>
    normalizedNames.includes(name.toLowerCase())
  );
}

function findPropertyInPage(
  properties: NotionPagePropertyMap,
  type: NotionPropertyType
) {
  return Object.entries(properties).find(
    ([, property]) => property.type === type
  )?.[0];
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

async function createCategoryResolver(
  apiKey: string,
  expenseSchema: NotionPropertyMap,
  categoryCatalog: ExpenseCategoryCatalog
) {
  const categoryProperty = expenseSchema.Category;

  if (categoryProperty?.type !== "relation") {
    throw new NotionSaveError(
      "The Notion expense data source needs a Category relation property before rows can be saved.",
      400
    );
  }

  const categoryDataSourceId =
    categoryProperty.relation?.data_source_id ||
    categoryCatalog.sourceDataSourceId ||
    process.env.NOTION_CATEGORY_DATA_SOURCE_ID;

  if (!categoryDataSourceId) {
    throw new NotionSaveError(
      "NOTION_CATEGORY_DATA_SOURCE_ID is missing and the Category relation target could not be detected.",
      400
    );
  }

  const resolvedCategoryDataSourceId = await resolveDataSourceId(
    apiKey,
    categoryDataSourceId
  );
  const categoryDataSource = await retrieveDataSource(
    apiKey,
    resolvedCategoryDataSourceId
  );
  const titleProperty = findProperty(categoryDataSource.properties, "title");

  if (!titleProperty) {
    throw new NotionSaveError(
      "The Notion category data source needs a title property before categories can be created.",
      400
    );
  }

  const pages = await queryDataSourcePages(apiKey, resolvedCategoryDataSourceId);
  const pageIdsByName = new Map<string, string>();
  const catalogSourceMatchesRelation =
    !categoryCatalog.sourceDataSourceId ||
    sameNotionId(categoryCatalog.sourceDataSourceId, categoryDataSourceId);

  for (const page of pages) {
    const name =
      getTextProperty(page.properties, titleProperty) ||
      getTextProperty(page.properties, findPropertyInPage(page.properties, "title"));
    const key = normalizeCategoryKey(name);

    if (key) {
      pageIdsByName.set(key, page.id);
    }
  }

  if (catalogSourceMatchesRelation) {
    for (const category of categoryCatalog.categories) {
      const key = normalizeCategoryKey(category.name);

      if (key && category.sourceId && !pageIdsByName.has(key)) {
        pageIdsByName.set(key, category.sourceId);
      }
    }
  }

  return {
    async getOrCreatePageId(name: string) {
      const normalizedName = normalizeCategoryName(name);
      const key = normalizeCategoryKey(normalizedName);

      if (!key) {
        return "";
      }

      const existingPageId = pageIdsByName.get(key);

      if (existingPageId) {
        return existingPageId;
      }

      const pageId = await createCategoryPage(
        apiKey,
        resolvedCategoryDataSourceId,
        categoryDataSource.properties,
        titleProperty,
        normalizedName
      );
      pageIdsByName.set(key, pageId);
      return pageId;
    }
  };
}

async function resolveExpenseCategoryPageIds(
  categoryResolver: Awaited<ReturnType<typeof createCategoryResolver>>,
  expenses: readonly ExpenseItem[]
) {
  const pageIds = new Map<string, string>();

  for (const expense of expenses) {
    const key = normalizeCategoryKey(expense.category);

    if (!key || pageIds.has(key)) {
      continue;
    }

    pageIds.set(
      key,
      await categoryResolver.getOrCreatePageId(expense.category)
    );
  }

  return pageIds;
}

async function createCategoryPage(
  apiKey: string,
  dataSourceId: string,
  schema: NotionPropertyMap,
  titleProperty: string,
  name: string
) {
  const properties: Record<string, unknown> = {
    [titleProperty]: {
      title: richText(name)
    }
  };
  const enabledProperty = findNamedSchemaProperty(schema, [
    "Enabled",
    "Active",
    "Use",
    "Include",
    "Import"
  ]);

  if (enabledProperty && schema[enabledProperty]?.type === "checkbox") {
    properties[enabledProperty] = { checkbox: true };
  }

  const response = await fetch(NOTION_PAGES_URL, {
    method: "POST",
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      parent: {
        data_source_id: dataSourceId
      },
      properties
    })
  });
  const result = await readJson(response);

  if (!response.ok) {
    throw new NotionSaveError(
      getNotionError(result) || `Could not create Notion category ${name}.`,
      response.status
    );
  }

  const pageId = String((result as { id?: string }).id || "");

  if (!pageId) {
    throw new NotionSaveError(
      `Notion created category ${name} without returning a page ID.`,
      500
    );
  }

  return pageId;
}

function buildProperties(
  expense: ExpenseItem,
  payload: SaveExpensesPayload,
  schema: NotionPropertyMap,
  statementById: ReadonlyMap<string, SaveStatementSource>,
  categoryPageId: string | undefined
) {
  const source = getStatementSource(expense, payload, statementById);
  const statement = source.statement;
  const name = expense.merchant || expense.description || "Expense";
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
  setRelation(properties, schema, "Category", categoryPageId);
  setRichText(properties, schema, "Account", statement.accountMask);
  setRichText(properties, schema, "Institution", statement.institution);
  setRichText(properties, schema, "Source File", source.sourceFileName);
  setNumber(properties, schema, "Confidence", expense.confidence);
  setRichText(properties, schema, "Notes", expense.notes);

  return properties;
}

function getStatementSource(
  expense: ExpenseItem,
  payload: SaveExpensesPayload,
  statementById: ReadonlyMap<string, SaveStatementSource>
) {
  const matchedSource = expense.statementId
    ? statementById.get(expense.statementId)
    : undefined;
  const fallbackStatement =
    payload.statement || payload.statements?.[0]?.statement;
  const statement = matchedSource?.statement || fallbackStatement;

  if (!statement) {
    throw new NotionSaveError(
      "Statement metadata is required before rows can be saved.",
      400
    );
  }

  return {
    statement,
    sourceFileName:
      matchedSource?.sourceFileName || payload.sourceFileName || ""
  };
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

function setRelation(
  properties: Record<string, unknown>,
  schema: NotionPropertyMap,
  name: string,
  pageId: string | undefined
) {
  if (!pageId || schema[name]?.type !== "relation") {
    return;
  }

  properties[name] = {
    relation: [{ id: pageId }]
  };
}

function findProperty(schema: NotionPropertyMap, type: NotionPropertyType) {
  return Object.entries(schema).find(([, property]) => property.type === type)?.[0];
}

function findNamedSchemaProperty(
  schema: NotionPropertyMap,
  names: readonly string[]
) {
  const normalizedNames = names.map((name) => name.toLowerCase());

  return Object.keys(schema).find((name) =>
    normalizedNames.includes(name.toLowerCase())
  );
}

function normalizeCategoryKey(value: string) {
  return normalizeCategoryName(value).toLowerCase();
}

function sameNotionId(left: string, right: string) {
  return notionIdKey(left) === notionIdKey(right);
}

function notionIdKey(value: string) {
  return value.replace(/-/g, "").toLowerCase();
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

function plainText(items: NotionText[] | undefined) {
  return Array.isArray(items)
    ? items
        .map((item) => item.plain_text || item.text?.content || "")
        .join("")
        .trim()
    : "";
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
  | "status"
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
  relation?: {
    data_source_id?: string;
  };
};

type NotionPropertyMap = Record<string, NotionPropertySchema>;

type NotionDataSource = {
  object: "data_source";
  id: string;
  properties: NotionPropertyMap;
};

type NotionDatabase = {
  object: "database";
  id: string;
  data_sources?: Array<{
    id: string;
    name?: string;
  }>;
};

type NotionText = {
  plain_text?: string;
  text?: {
    content?: string;
  };
};

type NotionPageProperty = {
  id?: string;
  name?: string;
  type?: NotionPropertyType;
  title?: NotionText[];
  rich_text?: NotionText[];
  checkbox?: boolean;
  relation?: Array<{
    id?: string;
  }>;
  select?: {
    name?: string;
  } | null;
  status?: {
    name?: string;
  } | null;
  number?: number | null;
};

type NotionPagePropertyMap = Record<string, NotionPageProperty>;

type NotionPage = {
  object: "page";
  id: string;
  archived?: boolean;
  in_trash?: boolean;
  properties: NotionPagePropertyMap;
};

type NotionQueryResponse = {
  results?: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
};
