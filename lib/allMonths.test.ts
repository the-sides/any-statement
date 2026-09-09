import { describe, expect, test } from "bun:test";

import { summarizeMonthsTimeline } from "@/lib/allMonths";
import { MONTH_DOCUMENT_VERSION, type MonthDocument } from "@/lib/months";
import type { ExpenseItem, IncomeItem } from "@/lib/types";

function expense(overrides: Partial<ExpenseItem>): ExpenseItem {
  return {
    id: "expense-1",
    date: "2026-06-04",
    postedDate: "2026-06-05",
    description: "Charge",
    merchant: "Merchant",
    amount: 100,
    reimbursedAmount: 0,
    currency: "USD",
    category: "Groceries",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.9,
    notes: "",
    ...overrides
  };
}

function income(overrides: Partial<IncomeItem>): IncomeItem {
  return {
    id: "income-1",
    date: "2026-06-01",
    source: "Payroll",
    amount: 1000,
    currency: "USD",
    kind: "paycheck",
    confidence: 0.9,
    notes: "",
    ...overrides
  };
}

function monthDocument(
  month: string,
  contents: Partial<Pick<MonthDocument, "expenses" | "incomes" | "statements">>
): MonthDocument {
  return {
    version: MONTH_DOCUMENT_VERSION,
    month,
    savedAt: "2026-06-30T00:00:00.000Z",
    statements: contents.statements ?? [
      {
        id: `statement-${month}`,
        sourceFileName: `${month}.pdf`,
        importedAt: "2026-06-30T00:00:00.000Z",
        monthSource: "period",
        statement: {
          institution: "Bank",
          accountMask: "1234",
          statementType: "bank",
          periodStart: `${month}-01`,
          periodEnd: `${month}-28`,
          currency: "USD",
          openingBalance: null,
          closingBalance: null,
          confidence: 0.9
        }
      }
    ],
    expenses: contents.expenses ?? [],
    incomes: contents.incomes ?? [],
    selectedIds: [],
    activeStatementId: `statement-${month}`
  };
}

describe("summarizeMonthsTimeline", () => {
  test("orders months and summarizes each like the single-month view", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-07", {
        expenses: [expense({ id: "e3", amount: 50, category: "Travel" })],
        incomes: [income({ id: "i2", amount: 400 })]
      }),
      monthDocument("2026-06", {
        expenses: [
          expense({ id: "e1", amount: 100 }),
          expense({ id: "e2", amount: 30, category: "Travel" })
        ],
        incomes: [income({ amount: 200 })]
      })
    ]);

    expect(timeline.months.map((month) => month.month)).toEqual([
      "2026-06",
      "2026-07"
    ]);

    const june = timeline.months[0];

    expect(june.statementCount).toBe(1);
    expect(june.expenseCount).toBe(2);
    expect(june.summary.incomeTotal).toBe(200);
    expect(june.summary.categorySpendTotal).toBe(130);
    expect(june.summary.savedAmount).toBe(70);
    expect(june.summary.allocations[0].source).toBe("saved");
    expect(june.summary.allocations[0].amount).toBe(70);

    expect(timeline.incomeTotal).toBe(600);
    expect(timeline.spendTotal).toBe(180);
    expect(timeline.savedTotal).toBe(420);
    expect(timeline.savedMonths).toBe(2);
    expect(timeline.overspentMonths).toBe(0);
  });

  test("counts a month spending more than it took in as overspent", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-06", {
        expenses: [expense({ amount: 500 })],
        incomes: [income({ amount: 300 })]
      }),
      monthDocument("2026-07", {
        expenses: [expense({ id: "e2", amount: 100 })],
        incomes: [income({ id: "i2", amount: 900 })]
      })
    ]);

    expect(timeline.months[0].summary.savedAmount).toBe(-200);
    expect(timeline.months[0].summary.allocations[0].source).toBe("overspent");
    expect(timeline.months[0].summary.allocations[0].amount).toBe(200);
    expect(timeline.overspentMonths).toBe(1);
    expect(timeline.savedMonths).toBe(1);
    expect(timeline.savedTotal).toBe(600);
  });

  test("skips months with no statements and takes the currency from statements", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-05", {
        statements: [],
        expenses: [expense({ amount: 999 })]
      }),
      monthDocument("2026-06", {
        expenses: [expense({ amount: 10 })]
      })
    ]);

    expect(timeline.months.map((month) => month.month)).toEqual(["2026-06"]);
    expect(timeline.spendTotal).toBe(10);
    expect(timeline.currency).toBe("USD");
  });

  test("has no months and a default currency when nothing is filed", () => {
    const timeline = summarizeMonthsTimeline([]);

    expect(timeline.months).toEqual([]);
    expect(timeline.currency).toBe("USD");
    expect(timeline.savedTotal).toBe(0);
  });
});

describe("year rollups", () => {
  test("merges a year's rows into one summary, one category per ribbon", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-06", {
        expenses: [
          expense({ id: "e1", amount: 100, category: "Groceries" }),
          expense({ id: "e2", amount: 30, category: "Travel" })
        ],
        incomes: [income({ amount: 200 })]
      }),
      monthDocument("2026-07", {
        expenses: [expense({ id: "e3", amount: 20, category: "Groceries" })],
        incomes: [income({ id: "i2", amount: 400 })]
      })
    ]);

    expect(timeline.years.map((year) => year.year)).toEqual(["2026"]);

    const [year] = timeline.years;

    expect(year.monthCount).toBe(2);
    expect(year.statementCount).toBe(2);
    expect(year.expenseCount).toBe(3);
    expect(year.summary.incomeTotal).toBe(600);
    expect(year.summary.categorySpendTotal).toBe(150);
    expect(year.summary.savedAmount).toBe(450);

    const groceries = year.summary.allocations.find(
      (allocation) => allocation.label === "Groceries"
    );

    expect(groceries?.amount).toBe(120);
  });

  test("keeps years apart and orders them oldest first", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-01", {
        expenses: [expense({ id: "e2", amount: 40 })],
        incomes: [income({ id: "i2", amount: 10 })]
      }),
      monthDocument("2025-12", {
        expenses: [expense({ id: "e1", amount: 25 })],
        incomes: [income({ amount: 500 })]
      })
    ]);

    expect(timeline.years.map((year) => year.year)).toEqual(["2025", "2026"]);
    expect(timeline.years[0].summary.savedAmount).toBe(475);
    expect(timeline.years[1].summary.savedAmount).toBe(-30);
    expect(timeline.years[1].summary.allocations[0].source).toBe("overspent");
  });

  test("leaves out months with no statements, like the month series does", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-05", {
        statements: [],
        expenses: [expense({ amount: 999 })]
      }),
      monthDocument("2026-06", {
        expenses: [expense({ amount: 10 })]
      })
    ]);

    expect(timeline.years).toHaveLength(1);
    expect(timeline.years[0].monthCount).toBe(1);
    expect(timeline.years[0].summary.categorySpendTotal).toBe(10);
  });
});

describe("timeline transactions", () => {
  test("flattens every filed month's rows newest first, undated rows last", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-07", {
        expenses: [
          expense({ id: "e3", date: "2026-07-02", amount: 50 }),
          expense({ id: "e4", date: "", amount: 5 })
        ]
      }),
      monthDocument("2026-06", {
        expenses: [
          expense({
            id: "e1",
            date: "2026-06-04",
            amount: 100,
            reimbursedAmount: 40,
            merchant: "Hotel",
            category: "Travel"
          })
        ]
      })
    ]);

    expect(timeline.transactions.map((row) => row.id)).toEqual([
      "e3",
      "e1",
      "e4"
    ]);
    expect(timeline.transactions[1]).toEqual({
      id: "e1",
      month: "2026-06",
      date: "2026-06-04",
      description: "Charge",
      merchant: "Hotel",
      category: "Travel",
      amount: 100,
      reimbursedAmount: 40
    });
  });

  test("leaves out rows from months with no statements", () => {
    const timeline = summarizeMonthsTimeline([
      monthDocument("2026-05", {
        statements: [],
        expenses: [expense({ id: "unfiled", amount: 999 })]
      }),
      monthDocument("2026-06", {
        expenses: [expense({ id: "filed", amount: 10 })]
      })
    ]);

    expect(timeline.transactions.map((row) => row.id)).toEqual(["filed"]);
  });
});
