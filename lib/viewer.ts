import { withAuth } from "@workos-inc/authkit-nextjs";
import { isDemoMode } from "@/lib/demoMode";

/**
 * Who the UI is rendering for, so the header can say it out loud. This is a
 * *display* fact only - authorization still lives in `proxy.ts` and the tenant
 * key still comes from `requireUserId()` in `lib/currentUser.ts`. Nothing here
 * is allowed to widen access.
 */
export type ViewerStatus = "signed-in" | "demo" | "signed-out";

export type Viewer = {
  status: ViewerStatus;
  /** Empty unless a real session carries one. */
  email: string;
};

/**
 * Pure so the demo branch is testable without a WorkOS round trip. Demo mode
 * wins over any session: `getCurrentUserId()` answers with `DEMO_USER_ID` in
 * that build, so reporting the signed-in owner's address would name a tenant
 * whose rows the page cannot see.
 */
export function describeViewer(input: {
  demo: boolean;
  email: string | null | undefined;
}): Viewer {
  if (input.demo) {
    return { status: "demo", email: "" };
  }

  const email = (input.email || "").trim();

  return email
    ? { status: "signed-in", email }
    : { status: "signed-out", email: "" };
}

export async function getViewer(): Promise<Viewer> {
  // No session exists in the demo build, and `withAuth()` needs WorkOS
  // configuration this build is allowed to be missing.
  if (isDemoMode()) {
    return describeViewer({ demo: true, email: null });
  }

  const { user } = await withAuth();

  return describeViewer({ demo: false, email: user?.email });
}
