import { describe, expect, test } from "bun:test";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  normalizeThemePreference,
  resolveTheme
} from "@/lib/theme";

describe("normalizeThemePreference", () => {
  test("keeps the three known preferences", () => {
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
  });

  test("falls back to system for missing or unknown values", () => {
    expect(normalizeThemePreference(null)).toBe("system");
    expect(normalizeThemePreference(undefined)).toBe("system");
    expect(normalizeThemePreference("sepia")).toBe("system");
  });
});

describe("resolveTheme", () => {
  test("follows the system setting when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  test("an explicit preference overrides the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  test("reads the same storage key the toggle writes", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  test("cannot break the page if storage throws", () => {
    expect(THEME_INIT_SCRIPT).toContain("catch");
  });
});
