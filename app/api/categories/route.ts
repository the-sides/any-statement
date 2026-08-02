import { commonErrorResponse } from "@/lib/apiErrors";
import { ensureCategoryCatalog, setCategoryEnabled } from "@/lib/categoryStore";
import { requireUserId } from "@/lib/currentUser";
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
      categories: catalog.categories,
      enabledCategories: catalog.enabledCategories,
      sourceConfigured: Boolean(connection.categoryDataSourceId),
      imported,
      importError,
      importedAt: catalog.importedAt,
      updatedAt: catalog.updatedAt
    });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Loading categories failed." }, { status: 500 })
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = (await request.json()) as {
      name?: unknown;
      enabled?: unknown;
    };

    if (typeof payload.name !== "string" || typeof payload.enabled !== "boolean") {
      return Response.json(
        { error: "Category name and enabled flag are required." },
        { status: 400 }
      );
    }

    const catalog = await setCategoryEnabled(
      userId,
      payload.name,
      payload.enabled
    );

    return Response.json({
      categories: catalog.categories,
      enabledCategories: catalog.enabledCategories,
      updatedAt: catalog.updatedAt
    });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Updating categories failed." }, { status: 500 })
    );
  }
}
