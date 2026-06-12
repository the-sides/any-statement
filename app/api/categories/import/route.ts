import { importCategoryCatalog } from "@/lib/categoryStore";
import {
  fetchCategoryDefinitionsFromNotion,
  NotionSaveError
} from "@/lib/notion";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST() {
  try {
    const dataSourceId = process.env.NOTION_CATEGORY_DATA_SOURCE_ID;
    const importedCategories = await fetchCategoryDefinitionsFromNotion(
      dataSourceId
    );
    const catalog = await importCategoryCatalog(
      importedCategories,
      dataSourceId || ""
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

    return Response.json(
      { error: "Importing categories from Notion failed." },
      { status: 500 }
    );
  }
}
