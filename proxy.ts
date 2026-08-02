import { authkitProxy } from "@workos-inc/authkit-nextjs";

/**
 * Secure by default: everything the matcher covers requires a WorkOS session,
 * so no page or API route serves statement data to an anonymous request. The
 * ledger is personal financial history on a public URL — opting routes in one
 * at a time would make an omission silently public.
 */
export default authkitProxy({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: []
  }
});

export const config = {
  // `callback` and `sign-in` drive the sign-in flow itself and must stay
  // reachable while signed out; the rest are static assets with nothing private.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|callback|sign-in).*)"
  ]
};
