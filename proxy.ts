import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import {
  ALLOWED_EMAILS_ENV,
  accessDenialMessage,
  decideAccess,
  parseAllowedEmails
} from "@/lib/accessControl";
import { isDemoMode } from "@/lib/demoMode";

/**
 * Secure by default: everything the matcher covers requires a WorkOS session
 * *and* an allowlisted address, so no page or API route serves statement data to
 * an anonymous request or to a stranger who simply signed themselves up. The
 * ledger is personal financial history on a public URL, so opting routes in one
 * at a time would make an omission silently public.
 *
 * The single exemption is local demo mode, which drops both checks together and
 * is therefore refused on every Vercel deployment, not just production -- see
 * `lib/demoMode.ts`.
 */
export default async function proxy(request: NextRequest) {
  // Demo build: no session exists to check, and `requireUserId()` answers with
  // the demo tenant instead of the owner's. Calling authkit here would still
  // 503 on a missing WORKOS_API_KEY, so it is skipped outright.
  if (isDemoMode()) {
    return NextResponse.next();
  }

  const { session, headers, authorizationUrl } = await authkit(request);

  if (!session.user) {
    return authorizationUrl
      ? handleAuthkitHeaders(request, headers, { redirect: authorizationUrl })
      : new Response("Authentication is unavailable.", { status: 503 });
  }

  const decision = decideAccess({
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    allowedEmails: parseAllowedEmails(process.env[ALLOWED_EMAILS_ENV])
  });

  if (!decision.allowed) {
    return new Response(accessDenialMessage(decision.reason), {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  return handleAuthkitHeaders(request, headers);
}

export const config = {
  // `callback` and `sign-in` drive the sign-in flow itself and must stay
  // reachable while signed out; the rest are static assets with nothing private.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|callback|sign-in).*)"
  ]
};
