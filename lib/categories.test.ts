import { describe, expect, test } from "bun:test";
import {
  coerceCategorySource,
  hasActiveNotionCategories,
  normalizeCategoryDefinitions,
  resolveIncludeAppCategories,
  selectActiveCategories,
  type ExpenseCategoryDefinition
} from "@/lib/categories";

function category(
  name: string,
  source: ExpenseCategoryDefinition["source"],
  enabled = true
): ExpenseCategoryDefinition {
  return { name, enabled, description: "", source };
}

const appOnly = [category("Meals", "app"), category("Other", "app")];
const mixed = [...appOnly, category("Groceries", "notion")];

describe("hasActiveNotionCategories", () => {
  test("ignores disabled Notion categories", () => {
    expect(hasActiveNotionCategories(mixed)).toBe(true);
    expect(
      hasActiveNotionCategories([...appOnly, category("Groceries", "notion", false)])
    ).toBe(false);
    expect(hasActiveNotionCategories(appOnly)).toBe(false);
  });
});

describe("resolveIncludeAppCategories", () => {
  test("hides built-in categories once Notion categories exist", () => {
    expect(resolveIncludeAppCategories(mixed, null)).toBe(false);
    expect(resolveIncludeAppCategories(mixed, undefined)).toBe(false);
  });

  test("shows built-in categories when the reviewer opts in", () => {
    expect(resolveIncludeAppCategories(mixed, true)).toBe(true);
  });

  test("shows built-in categories when no Notion category is active", () => {
    expect(resolveIncludeAppCategories(appOnly, false)).toBe(true);
    expect(
      resolveIncludeAppCategories(
        [...appOnly, category("Groceries", "notion", false)],
        null
      )
    ).toBe(true);
  });
});

describe("selectActiveCategories", () => {
  test("drops app categories when Notion categories are active", () => {
    expect(selectActiveCategories(mixed, null).map((item) => item.name)).toEqual([
      "Groceries"
    ]);
  });

  test("keeps every category when built-ins are included", () => {
    expect(selectActiveCategories(mixed, true).length).toBe(3);
    expect(selectActiveCategories(appOnly, null).length).toBe(2);
  });

  test("keeps disabled Notion categories visible for re-enabling", () => {
    const withDisabledNotion = [
      ...mixed,
      category("Hardware", "notion", false)
    ];

    expect(
      selectActiveCategories(withDisabledNotion, null).map((item) => item.name)
    ).toEqual(["Groceries", "Hardware"]);
  });
});

describe("custom categories", () => {
  test("stay visible while Notion categories hide the built-ins", () => {
    const catalog = [
      ...mixed,
      category("Coffee Gear", "custom"),
      category("Film", "custom", false)
    ];

    expect(selectActiveCategories(catalog, null).map((item) => item.name)).toEqual([
      "Groceries",
      "Coffee Gear",
      "Film"
    ]);
  });

  test("normalize keeps custom sources and coerces unknown ones", () => {
    const normalized = normalizeCategoryDefinitions([
      { name: "Coffee Gear", source: "custom" },
      { name: "Odd", source: "spreadsheet" as never },
      { name: "Imported", source: "notion", enabled: false }
    ]);

    expect(normalized.map((item) => [item.name, item.source, item.enabled])).toEqual([
      ["Coffee Gear", "custom", true],
      ["Odd", "app", true],
      ["Imported", "notion", false]
    ]);
  });

  test("coerceCategorySource falls back to app", () => {
    expect(coerceCategorySource("custom")).toBe("custom");
    expect(coerceCategorySource(undefined)).toBe("app");
  });
});
