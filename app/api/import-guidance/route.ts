import { commonErrorResponse } from "@/lib/apiErrors";
import { requireUserId } from "@/lib/currentUser";
import {
  readImportGuidance,
  saveImportGuidance
} from "@/lib/importGuidanceStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const stored = await readImportGuidance(userId);

    return Response.json(stored);
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Loading import guidance failed." },
        { status: 500 }
      )
    );
  }
}

export async function PUT(request: Request) {
  return save(request);
}

/**
 * `navigator.sendBeacon` can only POST, and the unload flush is the one write
 * that must not be lost, so POST is an alias for the same save.
 */
export async function POST(request: Request) {
  return save(request);
}

async function save(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = (await request.json()) as { guidance?: unknown };

    if (typeof payload.guidance !== "string") {
      return Response.json(
        { error: "Import guidance text is required." },
        { status: 400 }
      );
    }

    const stored = await saveImportGuidance(userId, payload.guidance);

    return Response.json(stored);
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Saving import guidance failed." }, { status: 500 })
    );
  }
}
