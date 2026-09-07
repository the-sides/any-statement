import { getSql } from "@/lib/db";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  type ExpenseCategoryDefinition,
  type ExpenseCategoryDefinitionInput,
  getEnabledCategoryDefinitions,
  isEditableCategory,
  MAX_CATEGORY_DESCRIPTION_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
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
  found: boolean;
  categories?: ExpenseCategoryDefinitionInput[];
  sourceDataSourceId?: string;
  importedAt?: string;
  updatedAt?: string;
};

/** Rejected requests the route turns into a 4xx instead of a 500. */
export class CategoryRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CategoryRequestError";
    this.status = status;
  }
}

/**
 * Keyed by user: the catalog is per-user now, so one user's first page load
 * must not de-duplicate another user's pending import away.
 */
const pendingAutoImports = new Map<string, Promise<EnsuredCategoryCatalog>>();

/**
 * The built-in defaults seed a user's first catalog and nothing more. Merging
 * them into a stored catalog on every read would resurrect any default the
 * reviewer deleted, which is exactly what deleting one has to mean.
 */
export async function loadCategoryCatalog(
  userId: string
): Promise<ExpenseCategoryCatalog> {
  const stored = await readStoredCategoryCatalog(userId);
  const categories = stored.found
    ? normalizeCategoryDefinitions(stored.categories || [])
    : normalizeCategoryDefinitions(DEFAULT_EXPENSE_CATEGORY_DEFINITIONS);

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

export async function createCustomCategory(
  userId: string,
  input: { name: string; description?: string; enabled?: boolean }
) {
  const current = await loadCategoryCatalog(userId);
  const name = requireCategoryName(input.name);

  if (findCategory(current.categories, name)) {
    throw new CategoryRequestError(`${name} already exists.`, 409);
  }

  const maxSortOrder = current.categories.reduce(
    (max, category) => Math.max(max, category.sortOrder ?? 0),
    0
  );
  const categories = normalizeCategoryDefinitions([
    ...current.categories,
    {
      name,
      enabled: input.enabled !== false,
      description: requireCategoryDescription(input.description),
      source: "custom",
      sortOrder: maxSortOrder + 10
    }
  ]);

  return saveCategoryCatalog(
    userId,
    categories,
    current.sourceDataSourceId,
    current.importedAt
  );
}

/**
 * Notion owns its own names, so an imported category only accepts `enabled`.
 * Built-in and custom categories accept everything, and a rename reports the
 * old name so the caller can carry existing expense rows over to it.
 */
export async function updateCategoryDefinition(
  userId: string,
  name: string,
  patch: { name?: string; description?: string; enabled?: boolean }
) {
  const current = await loadCategoryCatalog(userId);
  const target = findCategory(current.categories, name);

  if (!target) {
    throw new CategoryRequestError(`${normalizeCategoryName(name)} is not a category.`, 404);
  }

  const renamesOrDescribes =
    patch.name !== undefined || patch.description !== undefined;

  if (renamesOrDescribes && !isEditableCategory(target)) {
    throw new CategoryRequestError(
      `${target.name} comes from Notion, so it can only be turned off or removed.`
    );
  }

  const nextName =
    patch.name === undefined ? target.name : requireCategoryName(patch.name);
  const renamedFrom =
    nextName.toLowerCase() === target.name.toLowerCase() ? undefined : target.name;

  if (renamedFrom && findCategory(current.categories, nextName)) {
    throw new CategoryRequestError(`${nextName} already exists.`, 409);
  }

  const next: ExpenseCategoryDefinition = {
    ...target,
    name: nextName,
    description:
      patch.description === undefined
        ? target.description
        : requireCategoryDescription(patch.description),
    enabled: patch.enabled === undefined ? target.enabled : patch.enabled
  };
  const categories = normalizeCategoryDefinitions(
    current.categories.map((category) =>
      category.name.toLowerCase() === target.name.toLowerCase() ? next : category
    )
  );
  const catalog = await saveCategoryCatalog(
    userId,
    categories,
    current.sourceDataSourceId,
    current.importedAt
  );

  return { catalog, renamedFrom, renamedTo: renamedFrom ? nextName : undefined };
}

/**
 * Removal is allowed for every source. A deleted Notion category comes back on
 * the next `Import`; a deleted built-in stays gone, because the catalog is the
 * stored list rather than the defaults plus edits.
 */
export async function deleteCategoryDefinition(userId: string, name: string) {
  const current = await loadCategoryCatalog(userId);
  const target = findCategory(current.categories, name);

  if (!target) {
    throw new CategoryRequestError(`${normalizeCategoryName(name)} is not a category.`, 404);
  }

  const categories = current.categories.filter(
    (category) => category.name.toLowerCase() !== target.name.toLowerCase()
  );

  return saveCategoryCatalog(
    userId,
    categories,
    current.sourceDataSourceId,
    current.importedAt
  );
}

function findCategory(
  categories: readonly ExpenseCategoryDefinition[],
  name: string
) {
  const key = normalizeCategoryName(name).toLowerCase();

  return categories.find((category) => category.name.toLowerCase() === key);
}

function requireCategoryName(value: string) {
  const name = normalizeCategoryName(value || "");

  if (!name) {
    throw new CategoryRequestError("A category needs a name.");
  }

  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new CategoryRequestError(
      `A category name is limited to ${MAX_CATEGORY_NAME_LENGTH} characters.`
    );
  }

  return name;
}

function requireCategoryDescription(value: string | undefined) {
  const description = normalizeCategoryName(value || "");

  if (description.length > MAX_CATEGORY_DESCRIPTION_LENGTH) {
    throw new CategoryRequestError(
      `A category description is limited to ${MAX_CATEGORY_DESCRIPTION_LENGTH} characters.`
    );
  }

  return description;
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
    return { found: false };
  }

  if (!row) {
    return { found: false };
  }

  return {
    found: true,
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
