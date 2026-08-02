import { describe, expect, test } from "bun:test";
import { decideAccess, parseAllowedEmails } from "@/lib/accessControl";

describe("parseAllowedEmails", () => {
  test("splits on commas and whitespace and lowercases", () => {
    expect(parseAllowedEmails("A@b.co, C@d.co\nE@f.co")).toEqual([
      "a@b.co",
      "c@d.co",
      "e@f.co"
    ]);
  });

  test("treats an unset or blank value as an empty allowlist", () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails("   ")).toEqual([]);
  });
});

describe("decideAccess", () => {
  const allowedEmails = ["jacob@mergerai.co"];

  test("allows an allowlisted address", () => {
    expect(
      decideAccess({ email: "jacob@mergerai.co", emailVerified: true, allowedEmails })
    ).toEqual({ allowed: true });
  });

  test("ignores case and surrounding whitespace", () => {
    expect(
      decideAccess({ email: "  Jacob@MergerAI.co ", allowedEmails })
    ).toEqual({ allowed: true });
  });

  test("denies a signed-in stranger", () => {
    expect(decideAccess({ email: "someone@else.com", allowedEmails })).toEqual({
      allowed: false,
      reason: "not-allowlisted"
    });
  });

  test("denies everyone when the allowlist is unset, rather than opening up", () => {
    expect(
      decideAccess({ email: "jacob@mergerai.co", allowedEmails: [] })
    ).toEqual({ allowed: false, reason: "not-configured" });
  });

  test("denies an allowlisted address that is not verified", () => {
    expect(
      decideAccess({
        email: "jacob@mergerai.co",
        emailVerified: false,
        allowedEmails
      })
    ).toEqual({ allowed: false, reason: "unverified-email" });
  });

  test("denies a missing address", () => {
    expect(decideAccess({ email: null, allowedEmails })).toEqual({
      allowed: false,
      reason: "not-allowlisted"
    });
  });
});
