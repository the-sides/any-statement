import { isMonthKey, parseMonthDocument, summarizeMonthDocument } from "@/lib/months";
import {
  deleteStoredMonth,
  readStoredMonth,
  writeStoredMonth
} from "@/lib/monthStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ month: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { month } = await context.params;

  if (!isMonthKey(month)) {
    return Response.json({ error: "Unknown month." }, { status: 400 });
  }

  try {
    const document = await readStoredMonth(month);

    return Response.json({ month, document });
  } catch {
    return Response.json({ error: "Loading the month failed." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { month } = await context.params;

  if (!isMonthKey(month)) {
    return Response.json({ error: "Unknown month." }, { status: 400 });
  }

  try {
    const document = parseMonthDocument(await request.json());

    if (!document || document.month !== month) {
      return Response.json(
        { error: "A month document for this month is required." },
        { status: 400 }
      );
    }

    const stored = await writeStoredMonth(document);

    return Response.json({
      month,
      document: stored,
      summary: stored ? summarizeMonthDocument(stored) : null
    });
  } catch {
    return Response.json({ error: "Saving the month failed." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { month } = await context.params;

  if (!isMonthKey(month)) {
    return Response.json({ error: "Unknown month." }, { status: 400 });
  }

  try {
    await deleteStoredMonth(month);

    return Response.json({ month, document: null });
  } catch {
    return Response.json({ error: "Removing the month failed." }, { status: 500 });
  }
}
