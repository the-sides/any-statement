import { describe, expect, test } from "bun:test";
import { documentIdOf, listLedgerDocuments } from "@/lib/documents";
import {
  fileStatementIntoMonth,
  planStatementFiling,
  type MonthDocument
} from "@/lib/months";
import {
  createReviewStatement,
  createStatementExpenses
} from "@/lib/reviewDraft";
import type { ExpenseItem, IncomeItem, StatementSummary } from "@/lib/types";

const statementSummary: StatementSummary = {
  institution: "American Express",
  accountMask: "12345",
  statementType: "credit_card",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  currency: "USD",
  openingBalance: 0,
  closingBalance: 10,
  confidence: 0.9
};

function expense(
  id: string,
  date: string,
  amount = 10,
  reimbursedAmount = 0
): ExpenseItem {
  return {
    id,
    date,
    postedDate: date,
    description: `Charge ${id}`,
    merchant: "Food City",
    amount,
    reimbursedAmount,
    currency: "USD",
    category: "Food",
    subcategory: "Grocery",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.95,
    notes: ""
  };
}

function income(id: string, date: string, amount: number): IncomeItem {
  return {
    id,
    date,
    source: "Payroll",
    amount,
    currency: "USD",
    kind: "paycheck",
    confidence: 0.9,
    notes: ""
  };
}

/** Files one upload exactly as the workspace does, so splits are real. */
function fileUpload(input: {
  documents: readonly MonthDocument[];
  id: string;
  summary: StatementSummary;
  expenses: readonly ExpenseItem[];
  incomes?: readonly IncomeItem[];
}) {
  const statement = createReviewStatement({
    id: input.id,
    statement: input.summary,
    sourceFileName: `${input.id}.pdf`
  });
  const plan = planStatementFiling({
    statement,
    expenses: createStatementExpenses(input.id, input.expenses),
    incomes: (input.incomes || []).map((row) => ({
      ...row,
      statementId: input.id
    }))
  });
  const byMonth = new Map(
    input.documents.map((document) => [document.month, document])
  );

  for (const segment of plan.segments) {
    byMonth.set(
      segment.month,
      fileStatementIntoMonth(byMonth.get(segment.month) || null, segment)
    );
  }

  return [...byMonth.values()].sort((first, second) =>
    first.month.localeCompare(second.month)
  );
}

describe("ledger documents", () => {
  test("lists one upload with its rows, totals, and month", () => {
    const months = fileUpload({
      documents: [],
      id: "statement-a",
      summary: statementSummary,
      expenses: [
        expense("tx-1", "2026-06-04", 40, 15),
        expense("tx-2", "2026-06-20", 60)
      ],
      incomes: [income("in-1", "2026-06-15", 500)]
    });

    const index = listLedgerDocuments(months);

    expect(index.documents).toHaveLength(1);

    const [document] = index.documents;

    expect(document.id).toBe("statement-a");
    expect(document.sourceFileName).toBe("statement-a.pdf");
    expect(document.institution).toBe("American Express");
    expect(document.months).toEqual(["2026-06"]);
    expect(document.periodStart).toBe("2026-06-01");
    expect(document.periodEnd).toBe("2026-06-30");
    expect(document.expenseCount).toBe(2);
    expect(document.grossTotal).toBe(100);
    expect(document.netTotal).toBe(85);
    expect(document.incomeTotal).toBe(500);
    expect(document.transactions.map((row) => row.date)).toEqual([
      "2026-06-20",
      "2026-06-04"
    ]);
    expect(index.grossTotal).toBe(100);
    expect(index.monthCount).toBe(1);
  });

  test("folds a split multi-month export back into one document", () => {
    const months = fileUpload({
      documents: [],
      id: "statement-export",
      summary: {
        ...statementSummary,
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31"
      },
      expenses: [
        expense("tx-1", "2026-01-10", 25),
        expense("tx-2", "2026-02-11", 35),
        expense("tx-3", "2026-03-12", 45)
      ]
    });

    expect(months.map((month) => month.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03"
    ]);

    const index = listLedgerDocuments(months);

    expect(index.documents).toHaveLength(1);

    const [document] = index.documents;

    expect(document.id).toBe("statement-export");
    expect(document.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(document.segments.map((segment) => segment.grossTotal)).toEqual([
      25, 35, 45
    ]);
    expect(document.grossTotal).toBe(105);
    expect(document.periodStart).toBe("2026-01-01");
    expect(document.periodEnd).toBe("2026-03-31");
    expect(document.transactions).toHaveLength(3);
    expect(index.monthCount).toBe(3);
  });

  test("keeps separate uploads apart and orders them newest first", () => {
    const june = fileUpload({
      documents: [],
      id: "statement-june",
      summary: statementSummary,
      expenses: [expense("tx-1", "2026-06-04", 40)]
    });
    const months = fileUpload({
      documents: june,
      id: "statement-july",
      summary: {
        ...statementSummary,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31"
      },
      expenses: [expense("tx-1", "2026-07-08", 20)]
    });

    const index = listLedgerDocuments(months);

    expect(index.documents.map((document) => document.id)).toEqual([
      "statement-july",
      "statement-june"
    ]);
    expect(index.expenseCount).toBe(2);
    expect(index.grossTotal).toBe(60);
  });

  test("attributes rows per statement when one month holds two uploads", () => {
    const card = fileUpload({
      documents: [],
      id: "statement-card",
      summary: statementSummary,
      expenses: [expense("tx-1", "2026-06-04", 40)]
    });
    const months = fileUpload({
      documents: card,
      id: "statement-bank",
      summary: { ...statementSummary, institution: "USAA" },
      expenses: [
        expense("tx-1", "2026-06-06", 11),
        expense("tx-2", "2026-06-07", 9)
      ]
    });

    expect(months).toHaveLength(1);

    const index = listLedgerDocuments(months);
    const byId = new Map(
      index.documents.map((document) => [document.id, document])
    );

    expect(index.documents).toHaveLength(2);
    expect(byId.get("statement-card")?.grossTotal).toBe(40);
    expect(byId.get("statement-bank")?.grossTotal).toBe(20);
    expect(byId.get("statement-bank")?.institution).toBe("USAA");
    expect(byId.get("statement-bank")?.expenseCount).toBe(2);
    expect(index.monthCount).toBe(1);
  });
});

describe("documentIdOf", () => {
  test("strips only the suffix naming the filed month", () => {
    expect(documentIdOf("statement-a-2026-06", "2026-06")).toBe("statement-a");
    expect(documentIdOf("statement-a-2026-06", "2026-07")).toBe(
      "statement-a-2026-06"
    );
    expect(documentIdOf("statement-2026-06", "2026-06")).toBe("statement");
    expect(documentIdOf("statement-12345", "2026-06")).toBe("statement-12345");
  });
});
