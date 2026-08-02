import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

/**
 * The dashboard's configured Sign-in URL. WorkOS-initiated flows start here so
 * they can complete the PKCE check the callback enforces.
 */
export const GET = async () => {
  redirect(await getSignInUrl());
};
