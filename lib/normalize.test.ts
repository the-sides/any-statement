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

describe("normalizeExtraction amount floor", () => {
  test("drops rows under $0.50 and keeps the boundary", () => {
    const { expenses } = normalizeExtraction(
      seedExtraction("credit_card", [
        { section: "purchase", merchant: "Penny Auth", amount: 0.01 },
        { section: "purchase", merchant: "Rounding Fee", amount: 0.49 },
        { section: "purchase", merchant: "Half Dollar", amount: 0.5 },
        { section: "purchase", merchant: "Coffee", amount: 4.25 }
      ])
    );

    expect(expenses.map((expense) => expense.merchant)).toEqual([
      "Half Dollar",
      "Coffee"
    ]);
  });

  test("drops sub-$0.50 income such as fractional interest", () => {
    const { incomes } = normalizeExtraction({
      statement: { institution: "USAA", statementType: "bank" },
      expenses: [],
      incomes: [
        { id: "in-1", date: "2026-08-01", source: "Interest Paid", amount: 0.07, kind: "interest" },
        { id: "in-2", date: "2026-08-15", source: "Payroll", amount: 2100, kind: "payroll" }
      ]
    });

    expect(incomes.map((income) => income.source)).toEqual(["Payroll"]);
  });
});

describe("normalizeExtraction internal transfer filtering", () => {
  const bankStatement = {
    institution: "USAA",
    accountMask: "1234",
    statementType: "bank" as const,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    currency: "USD",
    openingBalance: null,
    closingBalance: null,
    confidence: 0.9
  };

  test("drops own-account transfer rows the model returned anyway", () => {
    const { expenses, incomes } = normalizeExtraction({
      statement: bankStatement,
      expenses: [
        {
          id: "tx-1",
          date: "2026-07-20",
          description: "USAA FUNDS TRANSFER DB",
          merchant: "USAA Funds Transfer DB",
          amount: 2000,
          currency: "USD",
          category: "Other",
          subcategory: "",
          paymentMethod: "unknown",
          statementSection: "other",
          confidence: 0.6,
          notes: ""
        },
        {
          id: "tx-2",
          date: "2026-07-03",
          description: "Second Story Pro WEB PMTS",
          merchant: "Second Story Pro",
          amount: 2294,
          currency: "USD",
          category: "Work",
          subcategory: "",
          paymentMethod: "unknown",
          statementSection: "other",
          confidence: 0.75,
          notes: ""
        },
        {
          id: "tx-3",
          date: "2026-07-05",
          description: "WIRE TRANSFER FEE",
          merchant: "Wire Transfer Fee",
          amount: 25,
          currency: "USD",
          category: "Other",
          subcategory: "",
          paymentMethod: "unknown",
          statementSection: "other",
          confidence: 0.9,
          notes: ""
        }
      ],
      incomes: [
        {
          id: "income-1",
          date: "2026-07-20",
          source: "USAA Funds Transfer",
          amount: 2000,
          currency: "USD",
          kind: "other",
          confidence: 0.4,
          notes:
            "Incoming USAA funds transfer; likely an internal transfer between own accounts, included with low confidence as source is ambiguous."
        },
        {
          id: "income-2",
          date: "2026-08-11",
          source: "NFCU ACH P2P VICKI WHITE",
          amount: 860,
          currency: "USD",
          kind: "other",
          confidence: 0.85,
          notes: ""
        },
        {
          id: "income-3",
          date: "2026-07-19",
          source: "MergerAI, Inc. Payroll",
          amount: 5161.71,
          currency: "USD",
          kind: "paycheck",
          confidence: 0.98,
          notes: ""
        }
      ]
    });

    expect(expenses.map((expense) => expense.merchant)).toEqual([
      "Second Story Pro",
      "Wire Transfer Fee"
    ]);

    expect(incomes.map((income) => income.source)).toEqual([
      "NFCU ACH P2P VICKI WHITE",
      "MergerAI, Inc. Payroll"
    ]);
  });

  test("keeps third-party income whose notes merely mention transfers", () => {
    // Regression: CSFloat was dropped because its model note said "not an
    // internal transfer"; notes are model commentary and are not scanned.
    const { incomes } = normalizeExtraction({
      statement: bankStatement,
      expenses: [],
      incomes: [
        {
          id: "income-1",
          date: "2026-07-08",
          source: "CSFloat",
          amount: 170.62,
          currency: "USD",
          kind: "other",
          confidence: 0.85,
          notes: "Income from CSFloat; third-party platform, not an internal transfer"
        }
      ]
    });

    expect(incomes.map((income) => income.source)).toEqual(["CSFloat"]);
  });
});
