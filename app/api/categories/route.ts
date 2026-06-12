import { loadCategoryCatalog, setCategoryEnabled } from "@/lib/categoryStore";

export const runtime = "nodejs";

export async function GET() {
  const catalog = await loadCategoryCatalog();

  return Response.json({
    categories: catalog.categories,
    enabledCategories: catalog.enabledCategories,
    sourceConfigured: Boolean(process.env.NOTION_CATEGORY_DATA_SOURCE_ID),
    updatedAt: catalog.updatedAt
  });
}

export async function PATCH(request: Request) {
  try {
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

    const catalog = await setCategoryEnabled(payload.name, payload.enabled);

    return Response.json({
      categories: catalog.categories,
      enabledCategories: catalog.enabledCategories,
      updatedAt: catalog.updatedAt
    });
  } catch {
    return Response.json(
      { error: "Updating categories failed." },
      { status: 500 }
    );
  }
}
