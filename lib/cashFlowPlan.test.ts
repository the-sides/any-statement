import { describe, expect, test } from "bun:test";
import {
  createCashFlowPlan,
  parseCashFlowPlan,
  summarizeCashFlow,
  type CashFlowEntry
} from "@/lib/cashFlowPlan";
import type { ExpenseItem, IncomeItem } from "@/lib/types";

const entries: CashFlowEntry[] = [
  {
    id: "paychecks",
    kind: "input",
    label: "Paychecks",
    amount: 4200,
    enabled: true
  },
  {
    id: "rent",
    kind: "output",
    label: "Rent",
    amount: 1593,
    enabled: true
  },
  {
    id: "disabled-output",
    kind: "output",
    label: "Ignore me",
    amount: 100,
    enabled: false
  }
];

const expenses: ExpenseItem[] = [
  {
    id: "tx-1",
    date: "2026-06-01",
    postedDate: "2026-06-01",
    description: "FOOD CITY",
    merchant: "Food City",
    amount: 72.5,
    reimbursedAmount: 0,
    currency: "USD",
    category: "Food",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.95,
    notes: ""
  },
  {
    id: "tx-2",
    date: "2026-06-02",
    postedDate: "2026-06-02",
    description: "Insurance",
    merchant: "Insurance Co",
    amount: 201.45,
    reimbursedAmount: 0,
    currency: "USD",
    category: "Insurance",
    subcategory: "",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.95,
    notes: ""
  }
];

describe("cash flow plan", () => {
  test("parses persisted cash flow entries", () => {
    const plan = createCashFlowPlan(entries);
    const parsed = parseCashFlowPlan(JSON.parse(JSON.stringify(plan)));

    expect(parsed?.entries.length).toBe(3);
    expect(parsed?.entries[0]?.label).toBe("Paychecks");
    expect(parsed?.entries[2]?.enabled).toBe(false);
  });

  test("summarizes manual outputs with statement category spending", () => {
    const summary = summarizeCashFlow(entries, expenses);

    expect(summary.incomeTotal).toBe(4200);
    expect(summary.manualOutputTotal).toBe(1593);
    expect(summary.categorySpendTotal).toBe(273.95);
    expect(summary.savedAmount).toBe(2333.05);
    expect(summary.allocations[0]?.label).toBe("Saved");
    expect(summary.allocations.some((item) => item.label === "Rent")).toBe(
      true
    );
    expect(summary.allocations.some((item) => item.label === "Food")).toBe(
      true
    );
  });

  test("recognized income replaces planned inputs and groups by source", () => {
    const incomes: IncomeItem[] = [
      incomeItem("MergerAI payroll", 3000),
      incomeItem("MergerAI payroll", 1800),
      incomeItem("Vicki White", 860)
    ];
    const summary = summarizeCashFlow(entries, expenses, incomes);

    expect(summary.inputs.map((input) => input.label)).toEqual([
      "MergerAI payroll",
      "Vicki White"
    ]);
    expect(summary.inputs[0]?.amount).toBe(4800);
    expect(summary.incomeTotal).toBe(5660);
    expect(summary.allocations[0]?.label).toBe("Saved");
  });

  test("falls back to planned inputs without recognized income", () => {
    expect(summarizeCashFlow(entries, expenses, []).incomeTotal).toBe(4200);
  });
});

function incomeItem(source: string, amount: number): IncomeItem {
  return {
    id: `${source}-${amount}`,
    date: "2026-08-05",
    source,
    amount,
    currency: "USD",
    kind: "other",
    confidence: 0.9,
    notes: ""
  };
}
