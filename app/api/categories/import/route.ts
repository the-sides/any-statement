import { commonErrorResponse } from "@/lib/apiErrors";
import { importCategoryCatalog } from "@/lib/categoryStore";
import { requireUserId } from "@/lib/currentUser";
import {
  fetchCategoryDefinitionsFromNotion,
  NotionSaveError
} from "@/lib/notion";
import { readNotionConnection } from "@/lib/notionConnection";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST() {
  try {
    const userId = await requireUserId();
    const connection = await readNotionConnection(userId);
    const importedCategories = await fetchCategoryDefinitionsFromNotion(
      connection
    );
    const catalog = await importCategoryCatalog(
      userId,
      importedCategories,
      connection.categoryDataSourceId
    );

    return Response.json({
      categories: catalog.categories,
      enabledCategories: catalog.enabledCategories,
      imported: importedCategories.length,
      updatedAt: catalog.updatedAt
    });
  } catch (error) {
    if (error instanceof NotionSaveError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Importing categories from Notion failed." },
        { status: 500 }
      )
    );
  }
}
