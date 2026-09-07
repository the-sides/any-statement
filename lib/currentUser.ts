import { withAuth } from "@workos-inc/authkit-nextjs";
import { DEMO_USER_ID, isDemoMode } from "@/lib/demoMode";

/**
 * The ledger's tenant key. Outside demo mode `proxy.ts` already refuses
 * anonymous and non-allowlisted requests, so a route reaching this without a
 * user means the matcher stopped covering it -- which would be a route serving
 * another user's statements. It throws rather than falling back to a shared
 * scope.
 *
 * The one exception is `isDemoMode()` below, which is deliberately a *different
 * tenant*, not a shared one: `DEMO_USER_ID` owns only its own seeded rows, and
 * it is refused on every Vercel deployment (`lib/demoMode.ts`).
 */
export class UnauthorizedError extends Error {
  status = 401;

  constructor(message = "Sign in to use this ledger.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  // The demo tenant is a real user id with seeded rows, so every store call
  // below this stays scoped exactly as it is in the authenticated build.
  if (isDemoMode()) {
    return DEMO_USER_ID;
  }

  const { user } = await withAuth();

  return user?.id || null;
}

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}
