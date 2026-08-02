import { UnauthorizedError } from "@/lib/currentUser";
import { SecretKeyError } from "@/lib/secrets";

/**
 * The two failures every data route can hit before it reaches its own logic:
 * no session, and a credential the server cannot read. Both deserve a specific
 * status and message rather than the route's generic 500, which would send a
 * user hunting for a Notion problem that is really a deployment one.
 */
export function commonErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof SecretKeyError) {
    return Response.json({ error: error.message }, { status: 503 });
  }

  return null;
}
