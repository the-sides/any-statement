// Rows that only move money between the user's own accounts (checking,
// savings, shares) are balance movements: not expenses and not income. The
// extraction prompts ask the model to skip them; this predicate is the
// deterministic backstop for when the model returns them anyway.
//
// The patterns are deliberately narrow because a match silently drops a row.
// "NFCU ACH P2P VICKI WHITE" (third-party money) and "WIRE TRANSFER FEE"
// (a real fee) must survive; "USAA FUNDS TRANSFER CR/DB" (the exact leak this
// guards) must not.
const INTERNAL_TRANSFER_PATTERNS: readonly RegExp[] = [
  // "USAA FUNDS TRANSFER CR", "USAA Funds Transfer DB"
  /\bfunds\s+transfer\b/i,
  // "Internal Transfer"
  /\binternal\s+transfer\b/i,
  // "TRANSFER TO SAVINGS *1234", "TRANSFER FROM CHK", "ONLINE TRANSFER TO SHARE"
  /\btransfer\s+(?:to|from)\s+(?:own\s+)?(?:sav(?:e|ing)s?|chk|checkings?|share|shares|deposit)\b/i,
  // "Savings Transfer", "Checking Transfer" (overdraft-protection style rows)
  /\b(?:sav(?:e|ing)s?|chk|checkings?|share|shares)\s+transfer\b/i
];

/**
 * Returns true when any of the row's identifying text fields describe a
 * transfer between the user's own accounts.
 *
 * Only fields copied from the statement row are scanned. Model-authored notes
 * are deliberately excluded: the model writes negated mentions there ("not an
 * internal transfer") that a text match would misread, and a genuinely
 * internal row carries the transfer descriptor in its source or description.
 */
export function isInternalTransferRow(
  ...parts: readonly (string | null | undefined)[]
): boolean {
  const text = parts.filter(Boolean).join(" ");

  return INTERNAL_TRANSFER_PATTERNS.some((pattern) => pattern.test(text));
}
