import { getSql } from "@/lib/db";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  type ExpenseCategoryDefinition,
  type ExpenseCategoryDefinitionInput,
  getEnabledCategoryDefinitions,
  mergeCategoryDefinitions,
  normalizeCategoryDefinitions,
  normalizeCategoryName
} from "@/lib/categories";
import {
  fetchCategoryDefinitionsFromNotion,
  type NotionConnection
} from "@/lib/notion";
import { readUsableNotionConnection } from "@/lib/notionConnection";

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

/**
 * Keyed by user: the catalog is per-user now, so one user's first page load
 * must not de-duplicate another user's pending import away.
 */
const pendingAutoImports = new Map<string, Promise<EnsuredCategoryCatalog>>();

export async function loadCategoryCatalog(
  userId: string
): Promise<ExpenseCategoryCatalog> {
  const stored = await readStoredCategoryCatalog(userId);
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
export async function ensureCategoryCatalog(
  userId: string
): Promise<EnsuredCategoryCatalog> {
  const catalog = await loadCategoryCatalog(userId);
  const connection = await readUsableNotionConnection(userId);
  const dataSourceId = connection.categoryDataSourceId;

  if (!dataSourceId || !shouldAutoImport(catalog, dataSourceId)) {
    return { catalog };
  }

  const pending =
    pendingAutoImports.get(userId) ||
    autoImportCategoryCatalog(userId, connection);

  pendingAutoImports.set(userId, pending);

  try {
    return await pending;
  } finally {
    pendingAutoImports.delete(userId);
  }
}

export async function importCategoryCatalog(
  userId: string,
  importedCategories: readonly ExpenseCategoryDefinitionInput[],
  sourceDataSourceId: string
) {
  const current = await loadCategoryCatalog(userId);
  const categories = mergeCategoryDefinitions(current.categories, importedCategories);

  return saveCategoryCatalog(
    userId,
    categories,
    sourceDataSourceId,
    new Date().toISOString()
  );
}

export async function setCategoryEnabled(
  userId: string,
  name: string,
  enabled: boolean
) {
  const current = await loadCategoryCatalog(userId);
  const normalizedName = normalizeCategoryName(name);
  const categories = normalizeCategoryDefinitions(
    current.categories.map((category) =>
      category.name.toLowerCase() === normalizedName.toLowerCase()
        ? { ...category, enabled }
        : category
    )
  );

  return saveCategoryCatalog(
    userId,
    categories,
    current.sourceDataSourceId,
    current.importedAt
  );
}

async function autoImportCategoryCatalog(
  userId: string,
  connection: NotionConnection
): Promise<EnsuredCategoryCatalog> {
  try {
    const importedCategories = await fetchCategoryDefinitionsFromNotion(
      connection
    );
    const catalog = await importCategoryCatalog(
      userId,
      importedCategories,
      connection.categoryDataSourceId
    );

    return { catalog, imported: importedCategories.length };
  } catch (error) {
    return {
      catalog: await loadCategoryCatalog(userId),
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
  userId: string,
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

  await getSql()`
    insert into category_catalog (
      user_id, categories, source_data_source_id, imported_at, updated_at
    ) values (
      ${userId},
      ${JSON.stringify(catalog.categories)}::jsonb,
      ${catalog.sourceDataSourceId ?? null},
      ${catalog.importedAt ?? null},
      ${catalog.updatedAt}
    )
    on conflict (user_id) do update
      set categories = excluded.categories,
          source_data_source_id = excluded.source_data_source_id,
          imported_at = excluded.imported_at,
          updated_at = excluded.updated_at
  `;

  return catalog;
}

/**
 * Reads degrade to the built-in defaults when the catalog is unreachable — no
 * row yet, no database configured, table not migrated. Categories are only a
 * vocabulary, so a reader outage must not take down extraction or the Notion
 * save that merely resolves names against it. Writes still surface their errors.
 */
async function readStoredCategoryCatalog(
  userId: string
): Promise<StoredCategoryCatalog> {
  let row:
    | {
        categories: unknown;
        source_data_source_id: unknown;
        imported_at: unknown;
        updated_at: unknown;
      }
    | undefined;

  try {
    const rows = (await getSql()`
      select categories, source_data_source_id, imported_at, updated_at
      from category_catalog
      where user_id = ${userId}
    `) as Array<NonNullable<typeof row>>;

    row = rows[0];
  } catch {
    return {};
  }

  if (!row) {
    return {};
  }

  return {
    categories: Array.isArray(row.categories)
      ? (row.categories as ExpenseCategoryDefinitionInput[])
      : [],
    sourceDataSourceId:
      typeof row.source_data_source_id === "string"
        ? row.source_data_source_id
        : undefined,
    importedAt:
      typeof row.imported_at === "string" ? row.imported_at : undefined,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined
  };
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
    sourceDataSourceId: sourceDataSourceId || undefined,
    importedAt,
    updatedAt
  };
}
