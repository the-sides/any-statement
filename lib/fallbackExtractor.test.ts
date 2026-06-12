import { describe, expect, test } from "bun:test";
import { categorizeFallbackDescription } from "@/lib/fallbackExtractor";

describe("categorizeFallbackDescription", () => {
  test("maps Food City grocery descriptors to Food when available", () => {
    const result = categorizeFallbackDescription(
      "FOOD CITY #711 000000000018273 CHATTANOOGA TN",
      ["Shopping", "Food", "Other"]
    );

    expect(result.category).toBe("Food");
  });

  test("uses Shopping for grocery descriptors when Food is unavailable", () => {
    const result = categorizeFallbackDescription(
      "FOOD CITY #710 000000000587239 EAST RIDGE TN",
      ["Shopping", "Other"]
    );

    expect(result.category).toBe("Shopping");
  });
});
