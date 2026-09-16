import { commonErrorResponse } from "@/lib/apiErrors";
import { requireUserId } from "@/lib/currentUser";
import { listLedgerDocuments } from "@/lib/documents";
import { listStoredMonthDocuments } from "@/lib/monthStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const documents = await listStoredMonthDocuments(await requireUserId());

    return Response.json({ index: listLedgerDocuments(documents) });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Loading the document manager failed." },
        { status: 500 }
      )
    );
  }
}
