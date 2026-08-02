/**
 * A WorkOS session only proves *someone* signed in, not that it is the owner of
 * this ledger. If the WorkOS environment allows public sign-up, any stranger who
 * registers would otherwise pass the proxy and read the statements. Access is
 * therefore restricted to an explicit allowlist.
 */
export const ALLOWED_EMAILS_ENV = "STATEMENT_LEDGER_ALLOWED_EMAILS";

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "not-configured" | "not-allowlisted" | "unverified-email" };

export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fails closed: an unset allowlist denies everyone rather than falling back to
 * "any authenticated user", so a missing env var can never silently open the
 * ledger up.
 */
export function decideAccess(input: {
  email: string | null | undefined;
  emailVerified?: boolean;
  allowedEmails: readonly string[];
}): AccessDecision {
  if (input.allowedEmails.length === 0) {
    return { allowed: false, reason: "not-configured" };
  }

  const email = (input.email || "").trim().toLowerCase();

  if (!email || !input.allowedEmails.includes(email)) {
    return { allowed: false, reason: "not-allowlisted" };
  }

  // An unverified address is only a claim, so it must not satisfy the allowlist.
  if (input.emailVerified === false) {
    return { allowed: false, reason: "unverified-email" };
  }

  return { allowed: true };
}

export function accessDenialMessage(reason: Exclude<AccessDecision, { allowed: true }>["reason"]) {
  switch (reason) {
    case "not-configured":
      return `Access is not configured. Set ${ALLOWED_EMAILS_ENV} to the email addresses allowed to use this ledger.`;
    case "unverified-email":
      return "Verify your email address with WorkOS before using this ledger.";
    default:
      return "This account is not allowed to access this ledger.";
  }
}
