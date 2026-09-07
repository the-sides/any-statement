import { describe, expect, test } from "bun:test";
import { decideDemoMode } from "@/lib/demoMode";

describe("decideDemoMode", () => {
  test("enables the demo for a set flag off Vercel", () => {
    expect(decideDemoMode({ flag: "1", isVercelDeployment: false })).toBe(true);
    expect(decideDemoMode({ flag: " TRUE ", isVercelDeployment: false })).toBe(
      true
    );
  });

  test("stays off when the flag is unset, blank, or switched off", () => {
    expect(decideDemoMode({ flag: undefined, isVercelDeployment: false })).toBe(
      false
    );
    expect(decideDemoMode({ flag: "  ", isVercelDeployment: false })).toBe(false);
    expect(decideDemoMode({ flag: "0", isVercelDeployment: false })).toBe(false);
    expect(decideDemoMode({ flag: "yes", isVercelDeployment: false })).toBe(false);
  });

  test("refuses on any Vercel deployment even with the flag set", () => {
    // Dropping the gate also drops the email allowlist, and a preview URL is
    // public and backed by the real database.
    expect(decideDemoMode({ flag: "1", isVercelDeployment: true })).toBe(false);
    expect(decideDemoMode({ flag: "true", isVercelDeployment: true })).toBe(false);
  });
});
