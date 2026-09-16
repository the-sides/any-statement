"use client";

import { LoaderCircle, LogIn, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
    <button className="user-menu-action" type="submit" disabled={pending}>
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
 * Whose ledger this is, behind one button. The address and the sign-out
 * control used to sit in the header bar permanently, which on a laptop ran the
 * brand lockup into the month stepper and on a phone cost a whole row; neither
 * is something the reviewer reads more than once a session.
 *
 * Display only - the proxy still owns access and `requireUserId()` still owns
 * the tenant key.
 */
export function AuthStatus({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node | null)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // No session to end, so the menu would hold nothing but its own label.
  if (viewer.status === "signed-out") {
    return (
      <Link className="icon-button user-button" href="/sign-in" title="Sign in">
        <LogIn size={16} {...iconProps} />
      </Link>
    );
  }

  const label =
    viewer.status === "demo" ? "Demo tenant" : viewer.email || "Signed in";

  return (
    <div className="user-menu" ref={rootRef} data-open={open ? "true" : "false"}>
      <button
        className="icon-button user-button"
        type="button"
        title={label}
        aria-label={`Account: ${label}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <UserRound size={16} {...iconProps} />
      </button>

      {open ? (
        <div className="user-menu-panel" role="menu">
          <p className="user-menu-identity">
            <span>{viewer.status === "demo" ? "Signed in as" : "Account"}</span>
            <strong>{label}</strong>
          </p>
          {viewer.status === "demo" ? (
            <p className="user-menu-note">
              Local demo build: a separate tenant, and no session to end.
            </p>
          ) : (
            <form action={signOutAction}>
              <SignOutButton />
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
