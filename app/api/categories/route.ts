import { commonErrorResponse } from "@/lib/apiErrors";
import {
  CategoryRequestError,
  createCustomCategory,
  deleteCategoryDefinition,
  ensureCategoryCatalog,
  updateCategoryDefinition,
  type ExpenseCategoryCatalog
} from "@/lib/categoryStore";
import { requireUserId } from "@/lib/currentUser";
import { renameStoredExpenseCategory } from "@/lib/monthStore";
import { readNotionConnectionStatus } from "@/lib/notionConnection";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET() {
  try {
    const userId = await requireUserId();
    const { catalog, imported, importError } = await ensureCategoryCatalog(
      userId
    );
    const connection = await readNotionConnectionStatus(userId);

    return Response.json({
      ...catalogResponse(catalog),
      sourceConfigured: Boolean(connection.categoryDataSourceId),
      imported,
      importError,
      importedAt: catalog.importedAt
    });
  } catch (error) {
    return errorResponse(error, "Loading categories failed.");
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = (await request.json()) as {
      name?: unknown;
      description?: unknown;
    };

    if (typeof payload.name !== "string") {
      return Response.json(
        { error: "A category name is required." },
        { status: 400 }
      );
    }

    const catalog = await createCustomCategory(userId, {
      name: payload.name,
      description:
        typeof payload.description === "string" ? payload.description : ""
    });

    return Response.json(catalogResponse(catalog));
  } catch (error) {
    return errorResponse(error, "Creating the category failed.");
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = (await request.json()) as {
      name?: unknown;
      newName?: unknown;
      description?: unknown;
      enabled?: unknown;
    };

    if (typeof payload.name !== "string") {
      return Response.json(
        { error: "A category name is required." },
        { status: 400 }
      );
    }

    const { catalog, renamedFrom, renamedTo } = await updateCategoryDefinition(
      userId,
      payload.name,
      {
        name: typeof payload.newName === "string" ? payload.newName : undefined,
        description:
          typeof payload.description === "string"
            ? payload.description
            : undefined,
        enabled:
          typeof payload.enabled === "boolean" ? payload.enabled : undefined
      }
    );

    const renamedRows =
      renamedFrom && renamedTo
        ? await renameStoredExpenseCategory(userId, renamedFrom, renamedTo)
        : 0;

    return Response.json({
      ...catalogResponse(catalog),
      renamedFrom,
      renamedTo,
      renamedRows
    });
  } catch (error) {
    return errorResponse(error, "Updating categories failed.");
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const name = new URL(request.url).searchParams.get("name");

    if (!name) {
      return Response.json(
        { error: "A category name is required." },
        { status: 400 }
      );
    }

    const catalog = await deleteCategoryDefinition(userId, name);

    return Response.json(catalogResponse(catalog));
  } catch (error) {
    return errorResponse(error, "Removing the category failed.");
  }
}

function catalogResponse(catalog: ExpenseCategoryCatalog) {
  return {
    categories: catalog.categories,
    enabledCategories: catalog.enabledCategories,
    updatedAt: catalog.updatedAt
  };
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CategoryRequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return (
    commonErrorResponse(error) ?? Response.json({ error: fallback }, { status: 500 })
  );
}
