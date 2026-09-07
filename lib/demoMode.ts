/**
 * Auth-less demo mode, for a headless browser that has to reach the UI without
 * a WorkOS round trip. A browser driver cannot complete AuthKit's redirect
 * flow, so without this the only reachable page is the sign-in bounce.
 *
 * It is a *tenant swap*, not an authorization hole widened over the real data:
 * every request runs as `DEMO_USER_ID`, whose rows are seeded by
 * `scripts/seed-demo.ts`. The signed-in owner's statements stay unreachable
 * because `user_id` is part of every primary key.
 *
 * Guarded twice on purpose. The env var is off unless set, and production is
 * refused outright, so a leaked flag on the deployed project cannot serve the
 * ledger anonymously. Preview deployments are allowed: that is where a headless
 * UI check would run against a real build.
 */
export const DEMO_MODE_ENV = "STATEMENT_LEDGER_DEMO_MODE";

export const DEMO_USER_ID = "user_demo_headless";

export function isDemoMode() {
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }

  const raw = (process.env[DEMO_MODE_ENV] || "").trim().toLowerCase();

  return raw === "1" || raw === "true";
}
