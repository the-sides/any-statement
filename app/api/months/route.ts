import { listStoredMonths } from "@/lib/monthStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const months = await listStoredMonths();

    return Response.json({ months });
  } catch {
    return Response.json({ error: "Loading months failed." }, { status: 500 });
  }
}
