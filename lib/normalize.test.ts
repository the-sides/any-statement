import { describe, expect, test } from "bun:test";
import { normalizeExtraction } from "@/lib/normalize";
import type { ExpenseItem } from "@/lib/types";

type ExpenseSeed = Partial<ExpenseItem> & { section: ExpenseItem["statementSection"] };

function seedExtraction(statementType: "bank" | "credit_card" | "other", seeds: ExpenseSeed[]) {
  return {
    statement: {
      institution: "Test Bank",
      accountMask: "1234",
      statementType,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: "USD",
      openingBalance: 0,
      closingBalance: 0,
      confidence: 0.9
    },
    expenses: seeds.map((seed, index) => ({
      id: `tx-${index + 1}`,
      date: "2026-08-05",
      postedDate: "2026-08-05",
      description: `Row ${index + 1}`,
      merchant: `Merchant ${index + 1}`,
      amount: 10 + index,
      currency: "USD",
      category: "Other",
      subcategory: "",
      paymentMethod: "unknown",
      statementSection: seed.section,
      confidence: 0.9,
      notes: "",
      ...seed
    }))
  };
}

describe("normalizeExtraction section filtering", () => {
  test("drops bank payments, transfers, and deposits; keeps withdrawals", () => {
    const { expenses } = normalizeExtraction(
      seedExtraction("bank", [
        { section: "withdrawal", merchant: "EPB Fiber" },
        { section: "payment", merchant: "American Express" },
        { section: "transfer", merchant: "Jacob Sides" },
        { section: "deposit", merchant: "Payroll" },
        { section: "purchase", merchant: "Hardware Store" }
      ])
    );

    expect(expenses.map((expense) => expense.merchant)).toEqual([
      "EPB Fiber",
      "Hardware Store"
    ]);
  });

  test("drops card payments but keeps balance transfers on credit cards", () => {
    const { expenses } = normalizeExtraction(
      seedExtraction("credit_card", [
        { section: "purchase", merchant: "Food City" },
        { section: "payment", merchant: "Thank You" },
        { section: "transfer", merchant: "Balance Transfer" }
      ])
    );

    expect(expenses.map((expense) => expense.merchant)).toEqual([
      "Food City",
      "Balance Transfer"
    ]);
  });

  test("leaves unknown statement types unfiltered", () => {
    const { expenses } = normalizeExtraction(
      seedExtraction("other", [
        { section: "payment", merchant: "Mystery" },
        { section: "transfer", merchant: "Moved" }
      ])
    );

    expect(expenses).toHaveLength(2);
  });
});
