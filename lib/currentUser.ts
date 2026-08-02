import { withAuth } from "@workos-inc/authkit-nextjs";

/**
 * The ledger's tenant key. `proxy.ts` already refuses anonymous and
 * non-allowlisted requests, so a route reaching this without a user means the
 * matcher stopped covering it -- which would be a route serving another user's
 * statements. It throws rather than falling back to a shared scope.
 */
export class UnauthorizedError extends Error {
  status = 401;

  constructor(message = "Sign in to use this ledger.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function getCurrentUserId(): Promise<string | null> {
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
