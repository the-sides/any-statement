import { commonErrorResponse } from "@/lib/apiErrors";
import { requireUserId } from "@/lib/currentUser";
import { listStoredMonths } from "@/lib/monthStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const months = await listStoredMonths(await requireUserId());

    return Response.json({ months });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Loading months failed." }, { status: 500 })
    );
  }
}
