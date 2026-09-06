import { commonErrorResponse } from "@/lib/apiErrors";
import { requireUserId } from "@/lib/currentUser";
import { loadUserSettings, saveUserSettings } from "@/lib/userSettingsStore";
import { parseUserSettings } from "@/lib/userSettings";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await loadUserSettings(userId);

    return Response.json({ settings });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Loading settings failed." }, { status: 500 })
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = parseUserSettings(await request.json());
    const settings = await saveUserSettings(userId, payload);

    return Response.json({ settings: { ...settings, configured: true } });
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Saving settings failed." }, { status: 500 })
    );
  }
}
