import { CallbackError, handleAuth } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

/**
 * A callback can arrive without a usable PKCE pair for reasons that are not the
 * user's fault and are not permanent: the one-shot PKCE cookie expired while the
 * sign-in page sat open, the flow finished in a different browser than it
 * started in, or the URL was reloaded/bookmarked after the cookie was consumed.
 * AuthKit's default response to all of those is a bare JSON 500, which strands
 * the user on a dead end with no way back into the flow.
 *
 * These cases are recoverable by simply starting a fresh flow, so we do that
 * instead. Anything else - a failed code exchange, missing tokens - is a real
 * fault and must stay visible rather than be retried into a loop.
 */
const RECOVERABLE_CALLBACK_CODES: Record<string, true> = {
  missing_auth_params: true,
  missing_pkce_cookie: true,
  oauth_state_mismatch: true
};

/**
 * `/sign-in` bounces to WorkOS, which returns here with fresh params, so a retry
 * marker cannot ride along in the query string. A short-lived cookie survives
 * that round trip and bounds the retry to exactly one, turning a genuinely
 * broken flow into a readable message instead of an endless redirect.
 */
const RETRY_COOKIE = "statement_ledger_auth_retry";
const RETRY_WINDOW_SECONDS = 120;

function onError({ error, request }: { error?: unknown; request: NextRequest }) {
  const url = new URL(request.url);
  // A cookie set over plain http is dropped by `Secure`, which would silently
  // disable the retry bound in local development.
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const recoverable = error instanceof CallbackError && RECOVERABLE_CALLBACK_CODES[error.code];

  if (!recoverable || request.cookies.get(RETRY_COOKIE)) {
    return new Response(
      "Sign-in could not be completed. Close this tab and start again from the app.",
      {
        status: 400,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          // Clear the marker so a later attempt still gets its own retry.
          "set-cookie": `${RETRY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
        }
      }
    );
  }

  return new Response(null, {
    status: 307,
    headers: {
      location: new URL("/sign-in", url.origin).toString(),
      "set-cookie": `${RETRY_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${RETRY_WINDOW_SECONDS}${secure}`
    }
  });
}

export const GET = handleAuth({ onError });
