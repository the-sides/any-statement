import { summarizeMonthsTimeline } from "@/lib/allMonths";
import { commonErrorResponse } from "@/lib/apiErrors";
import { requireUserId } from "@/lib/currentUser";
import { listStoredMonthDocuments } from "@/lib/monthStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const documents = await listStoredMonthDocuments(await requireUserId());

    return Response.json({ timeline: summarizeMonthsTimeline(documents) });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Loading the all-months overview failed." },
        { status: 500 }
      )
    );
  }
}
