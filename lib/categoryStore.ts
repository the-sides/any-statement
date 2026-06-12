import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  type ExpenseCategoryDefinition,
  type ExpenseCategoryDefinitionInput,
  getEnabledCategoryDefinitions,
  mergeCategoryDefinitions,
  normalizeCategoryDefinitions,
  normalizeCategoryName
} from "@/lib/categories";

const DEFAULT_ARTIFACT_ROOT = "/tmp/statement-ledger";
const CATEGORY_CATALOG_FILE = "category-catalog.json";

export type ExpenseCategoryCatalog = {
  categories: ExpenseCategoryDefinition[];
  enabledCategories: ExpenseCategoryDefinition[];
  sourceDataSourceId?: string;
  updatedAt: string;
};

type StoredCategoryCatalog = {
  categories?: ExpenseCategoryDefinitionInput[];
  sourceDataSourceId?: string;
  updatedAt?: string;
};

export async function loadCategoryCatalog(): Promise<ExpenseCategoryCatalog> {
  const stored = await readStoredCategoryCatalog();
  const categories = mergeCategoryDefinitions(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
    stored.categories || []
  );

  return toCatalog(categories, stored.sourceDataSourceId, stored.updatedAt);
}

export async function importCategoryCatalog(
  importedCategories: readonly ExpenseCategoryDefinitionInput[],
  sourceDataSourceId: string
) {
  const current = await loadCategoryCatalog();
  const categories = mergeCategoryDefinitions(current.categories, importedCategories);

  return saveCategoryCatalog(categories, sourceDataSourceId);
}

export async function setCategoryEnabled(name: string, enabled: boolean) {
  const current = await loadCategoryCatalog();
  const normalizedName = normalizeCategoryName(name);
  const categories = normalizeCategoryDefinitions(
    current.categories.map((category) =>
      category.name.toLowerCase() === normalizedName.toLowerCase()
        ? { ...category, enabled }
        : category
    )
  );

  return saveCategoryCatalog(categories, current.sourceDataSourceId);
}

async function saveCategoryCatalog(
  categories: readonly ExpenseCategoryDefinitionInput[],
  sourceDataSourceId?: string
) {
  const catalog = toCatalog(
    normalizeCategoryDefinitions(categories),
    sourceDataSourceId,
    new Date().toISOString()
  );
  const filePath = categoryCatalogPath();

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        categories: catalog.categories,
        sourceDataSourceId: catalog.sourceDataSourceId,
        updatedAt: catalog.updatedAt
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return catalog;
}

async function readStoredCategoryCatalog(): Promise<StoredCategoryCatalog> {
  try {
    const raw = await readFile(categoryCatalogPath(), "utf8");
    const parsed = JSON.parse(raw) as StoredCategoryCatalog;

    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      sourceDataSourceId:
        typeof parsed.sourceDataSourceId === "string"
          ? parsed.sourceDataSourceId
          : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: unknown }).code);

      if (code === "ENOENT") {
        return {};
      }
    }

    throw error;
  }
}

function toCatalog(
  categories: ExpenseCategoryDefinition[],
  sourceDataSourceId: string | undefined,
  updatedAt = new Date().toISOString()
): ExpenseCategoryCatalog {
  return {
    categories,
    enabledCategories: getEnabledCategoryDefinitions(categories),
    sourceDataSourceId:
      sourceDataSourceId || process.env.NOTION_CATEGORY_DATA_SOURCE_ID || undefined,
    updatedAt
  };
}

function categoryCatalogPath() {
  const root = process.env.STATEMENT_LEDGER_ARTIFACT_DIR || DEFAULT_ARTIFACT_ROOT;

  return path.join(root, CATEGORY_CATALOG_FILE);
}
