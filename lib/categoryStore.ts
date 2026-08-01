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
import { fetchCategoryDefinitionsFromNotion } from "@/lib/notion";

const DEFAULT_ARTIFACT_ROOT = "/tmp/statement-ledger";
const CATEGORY_CATALOG_FILE = "category-catalog.json";

export type ExpenseCategoryCatalog = {
  categories: ExpenseCategoryDefinition[];
  enabledCategories: ExpenseCategoryDefinition[];
  sourceDataSourceId?: string;
  importedAt?: string;
  updatedAt: string;
};

export type EnsuredCategoryCatalog = {
  catalog: ExpenseCategoryCatalog;
  imported?: number;
  importError?: string;
};

type StoredCategoryCatalog = {
  categories?: ExpenseCategoryDefinitionInput[];
  sourceDataSourceId?: string;
  importedAt?: string;
  updatedAt?: string;
};

let pendingAutoImport: Promise<EnsuredCategoryCatalog> | null = null;

export async function loadCategoryCatalog(): Promise<ExpenseCategoryCatalog> {
  const stored = await readStoredCategoryCatalog();
  const categories = mergeCategoryDefinitions(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
    stored.categories || []
  );

  return toCatalog(
    categories,
    stored.sourceDataSourceId,
    stored.importedAt,
    stored.updatedAt
  );
}

/**
 * Loads the catalog, importing Notion categories the first time a data source
 * is configured. Later loads reuse the stored catalog so categories the
 * reviewer turned off are not resurrected on every page load.
 */
export async function ensureCategoryCatalog(): Promise<EnsuredCategoryCatalog> {
  const catalog = await loadCategoryCatalog();
  const dataSourceId = process.env.NOTION_CATEGORY_DATA_SOURCE_ID;

  if (!dataSourceId || !shouldAutoImport(catalog, dataSourceId)) {
    return { catalog };
  }

  if (!pendingAutoImport) {
    pendingAutoImport = autoImportCategoryCatalog(dataSourceId);
  }

  try {
    return await pendingAutoImport;
  } finally {
    pendingAutoImport = null;
  }
}

export async function importCategoryCatalog(
  importedCategories: readonly ExpenseCategoryDefinitionInput[],
  sourceDataSourceId: string
) {
  const current = await loadCategoryCatalog();
  const categories = mergeCategoryDefinitions(current.categories, importedCategories);

  return saveCategoryCatalog(
    categories,
    sourceDataSourceId,
    new Date().toISOString()
  );
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

  return saveCategoryCatalog(
    categories,
    current.sourceDataSourceId,
    current.importedAt
  );
}

async function autoImportCategoryCatalog(
  dataSourceId: string
): Promise<EnsuredCategoryCatalog> {
  try {
    const importedCategories = await fetchCategoryDefinitionsFromNotion(
      dataSourceId
    );
    const catalog = await importCategoryCatalog(importedCategories, dataSourceId);

    return { catalog, imported: importedCategories.length };
  } catch (error) {
    return {
      catalog: await loadCategoryCatalog(),
      importError:
        error instanceof Error
          ? error.message
          : "Importing categories from Notion failed."
    };
  }
}

function shouldAutoImport(
  catalog: ExpenseCategoryCatalog,
  dataSourceId: string
) {
  return !catalog.importedAt || catalog.sourceDataSourceId !== dataSourceId;
}

async function saveCategoryCatalog(
  categories: readonly ExpenseCategoryDefinitionInput[],
  sourceDataSourceId?: string,
  importedAt?: string
) {
  const catalog = toCatalog(
    normalizeCategoryDefinitions(categories),
    sourceDataSourceId,
    importedAt,
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
        importedAt: catalog.importedAt,
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
      importedAt:
        typeof parsed.importedAt === "string" ? parsed.importedAt : undefined,
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
  importedAt: string | undefined,
  updatedAt = new Date().toISOString()
): ExpenseCategoryCatalog {
  return {
    categories,
    enabledCategories: getEnabledCategoryDefinitions(categories),
    sourceDataSourceId:
      sourceDataSourceId || process.env.NOTION_CATEGORY_DATA_SOURCE_ID || undefined,
    importedAt,
    updatedAt
  };
}

function categoryCatalogPath() {
  const root = process.env.STATEMENT_LEDGER_ARTIFACT_DIR || DEFAULT_ARTIFACT_ROOT;

  return path.join(root, CATEGORY_CATALOG_FILE);
}
