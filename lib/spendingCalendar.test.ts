import { describe, expect, test } from "bun:test";
import { calendarCategoryColor, calendarDate, summarizeCalendar } from "./spendingCalendar";

describe("spending calendar", () => {
  test("excludes Rent from daily stacks, counts, totals, and height scaling", () => {
    const calendar = summarizeCalendar("2026-08", [
      { date: "2026-08-01", category: "Rent", amount: 2500 },
      { date: "2026-08-02", category: " rent ", amount: 100 },
      { date: "2026-08-01", category: "Food", amount: 25 }
    ])!;
    expect(calendar.total).toBe(25);
    expect(calendar.peak).toBe(25);
    expect(calendar.days[0].count).toBe(1);
    expect(calendar.days[1].total).toBe(0);
    expect(calendar.categories).toEqual([["Food", 25]]);
    expect(calendar.excluded).toBe(0);
  });
  test("stacks categories on the actual day, using gross charges", () => {
    const calendar = summarizeCalendar("2026-08", [
      { date: "2026-08-04", category: "Food", amount: 20 },
      { date: "2026-08-04", category: "Food", amount: 30 },
      { date: "2026-08-04", category: "Travel", amount: 50 },
      { date: "2026-08-05", category: "Food", amount: 200 }
    ])!;
    expect(calendar.days[3].total).toBe(100);
    expect([...calendar.days[3].categories]).toEqual([["Food", 50], ["Travel", 50]]);
    expect(calendar.days[3].count).toBe(3);
    expect(calendar.peak).toBe(200);
    expect(calendar.total).toBe(300);
    expect(calendar.offset).toBe(6);
    expect(calendar.weeks).toBe(6);
  });
  test("invalid dates, other months, credits, and non-finite values never gain a tower", () => {
    const calendar = summarizeCalendar("2026-02", [
      { date: "2026-02-30", category: "Food", amount: 10 },
      { date: "", category: "Food", amount: 20 },
      { date: "2026-01-31", category: "Food", amount: 30 },
      { date: "2026-02-02", category: "Food", amount: -10 },
      { date: "2026-02-02", category: "Food", amount: NaN }
    ])!;
    expect(calendar.excluded).toBe(5);
    expect(calendar.total).toBe(0);
    expect(calendar.peak).toBe(0);
    expect(calendar.days).toHaveLength(28);
    expect(calendarDate("2026-02-29")).toBe(null);
    expect(summarizeCalendar("2026-13", [])).toBe(null);
  });
  test("leap days and empty days remain addressable", () => {
    const calendar = summarizeCalendar("2024-02", [{ date: "2024-02-29", category: "", amount: 0.01 }])!;
    expect(calendar.days).toHaveLength(29);
    expect(calendar.days[0].total).toBe(0);
    expect(calendar.days[28].categories.get("Uncategorized")).toBe(0.01);
    expect(calendarCategoryColor("Food")).toBe(calendarCategoryColor("Food"));
  });
});
