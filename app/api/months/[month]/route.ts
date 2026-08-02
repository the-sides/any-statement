import { commonErrorResponse } from "@/lib/apiErrors";
import { requireUserId } from "@/lib/currentUser";
import { isMonthKey, parseMonthDocument, summarizeMonthDocument } from "@/lib/months";
import { readStoredMonth, writeStoredMonth } from "@/lib/monthStore";

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
    const document = await readStoredMonth(await requireUserId(), month);

    return Response.json({ month, document });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Loading the month failed." }, { status: 500 })
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { month } = await context.params;

  if (!isMonthKey(month)) {
    return Response.json({ error: "Unknown month." }, { status: 400 });
  }

  try {
    const userId = await requireUserId();
    const document = parseMonthDocument(await request.json());

    if (!document || document.month !== month) {
      return Response.json(
        { error: "A month document for this month is required." },
        { status: 400 }
      );
    }

    const stored = await writeStoredMonth(userId, document);

    return Response.json({
      month,
      document: stored,
      summary: stored ? summarizeMonthDocument(stored) : null
    });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Saving the month failed." }, { status: 500 })
    );
  }
}

/** `navigator.sendBeacon` can only POST, so unload flushes land here. */
export async function POST(request: Request, context: RouteContext) {
  return PUT(request, context);
}
