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
 * Local only, and fail closed twice over. The flag is off unless set, and it is
 * refused outright on *any* Vercel deployment rather than only in production,
 * because turning the gate off also drops the `STATEMENT_LEDGER_ALLOWED_EMAILS`
 * allowlist: a preview URL is public, is backed by the same `DATABASE_URL`, and
 * can drive `/api/extract` on the shared OpenRouter credential. Refusing one
 * value of `VERCEL_ENV` would also fail open twice - a preview build keeps
 * `VERCEL_ENV=preview` when it is promoted to the production alias, and a host
 * that exposes no Vercel system variables leaves it undefined. `VERCEL` is set
 * on every Vercel build and runtime, so keying on its presence has neither
 * hole. See `Vercel Env Pull Hazard` in AGENTS.md for why a stray copy of this
 * variable onto the Vercel project is a realistic accident.
 */
export const DEMO_MODE_ENV = "STATEMENT_LEDGER_DEMO_MODE";

export const DEMO_USER_ID = "user_demo_headless";

/**
 * Pure so the guard is testable without mutating `process.env`, matching
 * `decideAccess` in `lib/accessControl.ts`.
 */
export function decideDemoMode(input: {
  flag: string | undefined;
  isVercelDeployment: boolean;
}) {
  if (input.isVercelDeployment) {
    return false;
  }

  const flag = (input.flag || "").trim().toLowerCase();

  return flag === "1" || flag === "true";
}

export function isDemoMode() {
  return decideDemoMode({
    flag: process.env[DEMO_MODE_ENV],
    isVercelDeployment: Boolean(process.env.VERCEL)
  });
}
