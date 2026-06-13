import { NotionSaveError, saveExpensesToNotion } from "@/lib/notion";
import type { SaveExpensesPayload } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
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

    const result = await saveExpensesToNotion(payload);
    return Response.json(result);
  } catch (error) {
    if (error instanceof NotionSaveError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json(
      { error: "Saving expenses to Notion failed." },
      { status: 500 }
    );
  }
}
