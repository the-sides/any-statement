import { commonErrorResponse } from "@/lib/apiErrors";
import { loadCategoryCatalog } from "@/lib/categoryStore";
import { requireUserId } from "@/lib/currentUser";
import { NotionSaveError, saveExpensesToNotion } from "@/lib/notion";
import { readNotionConnection } from "@/lib/notionConnection";
import type { SaveExpensesPayload } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = (await request.json()) as SaveExpensesPayload;

    if (
      !Array.isArray(payload.expenses) ||
      (!payload.statement && !Array.isArray(payload.statements))
    ) {
      return Response.json(
        { error: "Statement and expense rows are required." },
        { status: 400 }
      );
    }

    const [connection, categoryCatalog] = await Promise.all([
      readNotionConnection(userId),
      loadCategoryCatalog(userId)
    ]);
    const result = await saveExpensesToNotion(payload, {
      connection,
      categoryCatalog
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof NotionSaveError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Saving expenses to Notion failed." },
        { status: 500 }
      )
    );
  }
}
