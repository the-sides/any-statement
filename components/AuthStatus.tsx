"use client";

import { LoaderCircle, LogIn, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { signOutAction } from "@/app/authActions";
import type { Viewer } from "@/lib/viewer";

const iconProps = {
  "aria-hidden": "true",
  suppressHydrationWarning: true
} as const;

/**
 * Sign-out lives in a form so it POSTs a server action: the session cookie must
 * not be droppable by a prefetched GET. See `app/authActions.ts`.
 */
function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="auth-status-action"
      type="submit"
      disabled={pending}
      title="Sign out"
      aria-label="Sign out"
    >
      {pending ? (
        <LoaderCircle className="spin" size={14} {...iconProps} />
      ) : (
        <LogOut size={14} {...iconProps} />
      )}
      <span>Sign out</span>
    </button>
  );
}

/**
 * Whose ledger this is, and the way in or out of it. Display only - the proxy
 * still owns access and `requireUserId()` still owns the tenant key.
 */
export function AuthStatus({ viewer }: { viewer: Viewer }) {
  if (viewer.status === "demo") {
    return (
      <p
        className="auth-status"
        data-status="demo"
        title="Local demo build: no session, and a separate tenant from the real ledger."
      >
        <UserRound size={14} {...iconProps} />
        <span className="auth-status-name">Demo tenant</span>
      </p>
    );
  }

  if (viewer.status === "signed-out") {
    return (
      <Link
        className="auth-status auth-status-link"
        data-status="signed-out"
        href="/sign-in"
        title="Sign in"
      >
        <LogIn size={14} {...iconProps} />
        <span className="auth-status-name">Sign in</span>
      </Link>
    );
  }

  return (
    <form className="auth-status" data-status="signed-in" action={signOutAction}>
      <UserRound size={14} {...iconProps} />
      <span className="auth-status-name" title={viewer.email}>
        {viewer.email}
      </span>
      <SignOutButton />
    </form>
  );
}
