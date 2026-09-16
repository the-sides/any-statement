"use server";

import { signOut } from "@workos-inc/authkit-nextjs";

/**
 * A server action, not a `GET /sign-out` route, for two reasons: a GET would be
 * fired by any prefetch or link crawler and sign the user out behind their
 * back, and `redirect()` inside a POST route handler answers 307, which would
 * replay the POST against the WorkOS logout URL. Actions redirect with 303.
 */
export async function signOutAction() {
  await signOut({ returnTo: "/" });
}
