import { commonErrorResponse } from "@/lib/apiErrors";
import { requireUserId } from "@/lib/currentUser";
import {
  deleteNotionConnection,
  readNotionConnectionStatus,
  writeNotionConnection
} from "@/lib/notionConnection";
import { isSecretKeyConfigured, SECRET_KEY_ENV } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectionRequest = {
  apiKey?: unknown;
  dataSourceId?: unknown;
  categoryDataSourceId?: unknown;
};

export async function GET() {
  try {
    return Response.json(await readNotionConnectionStatus(await requireUserId()));
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Loading the Notion connection failed." },
        { status: 500 }
      )
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = (await request.json()) as ConnectionRequest;

    if (!isSecretKeyConfigured()) {
      return Response.json(
        {
          error: `${SECRET_KEY_ENV} is not set, so an integration token cannot be stored safely.`
        },
        { status: 503 }
      );
    }

    if (
      typeof payload.dataSourceId !== "string" ||
      typeof payload.categoryDataSourceId !== "string"
    ) {
      return Response.json(
        { error: "Both Notion data source IDs are required." },
        { status: 400 }
      );
    }

    // An omitted key keeps the stored one, so the browser never has to hold a
    // token it already saved just to edit a data source ID beside it.
    const status = await writeNotionConnection(userId, {
      apiKey: typeof payload.apiKey === "string" ? payload.apiKey : undefined,
      dataSourceId: payload.dataSourceId,
      categoryDataSourceId: payload.categoryDataSourceId
    });

    return Response.json(status);
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Saving the Notion connection failed." },
        { status: 500 }
      )
    );
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    await deleteNotionConnection(userId);

    return Response.json(await readNotionConnectionStatus(userId));
  } catch (error) {
    return (
      commonErrorResponse(error) ??
      Response.json(
        { error: "Disconnecting Notion failed." },
        { status: 500 }
      )
    );
  }
}
