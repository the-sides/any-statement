import { describe, expect, test } from "bun:test";
import {
  createMonthDocument,
  determineStatementMonth,
  fileStatementIntoMonth,
  formatMonthLabel,
  listMonths,
  mergeMonthDocuments,
  migrateReviewDraftToMonths,
  parseMonthDocument,
  reassignStatementMonth
} from "@/lib/months";
import {
  createReviewDraft,
  createReviewStatement,
  createStatementExpenses
} from "@/lib/reviewDraft";
import type { ExpenseItem, StatementSummary } from "@/lib/types";

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

function summaryWithPeriod(
  periodStart: string,
  periodEnd: string
): StatementSummary {
  return { ...statementSummary, periodStart, periodEnd };
}

function expense(id: string, date: string, amount = 10): ExpenseItem {
  return {
    id,
    date,
    postedDate: date,
    description: `Charge ${id}`,
    merchant: "Food City",
    amount,
    currency: "USD",
    category: "Food",
    subcategory: "Grocery",
    paymentMethod: "card",
    statementSection: "purchase",
    confidence: 0.95,
    notes: ""
  };
}

function statementWith(
  id: string,
  summary: StatementSummary,
  dates: readonly string[]
) {
  const statement = createReviewStatement({
    id,
    statement: summary,
    sourceFileName: `${id}.pdf`
  });
  const expenses = createStatementExpenses(
    id,
    dates.map((date, index) => expense(`tx-${index + 1}`, date))
  );

  return { statement, expenses };
}

describe("statement month determination", () => {
  test("files a period inside one calendar month under that month", () => {
    const determined = determineStatementMonth({
      statement: summaryWithPeriod("2026-06-01", "2026-06-30"),
      expenses: []
    });

    expect(determined.month).toBe("2026-06");
    expect(determined.source).toBe("period");
  });

  test("files a straddling period under the month holding more days", () => {
    expect(
      determineStatementMonth({
        statement: summaryWithPeriod("2026-06-12", "2026-07-11"),
        expenses: []
      }).month
    ).toBe("2026-06");
    expect(
      determineStatementMonth({
        statement: summaryWithPeriod("2026-06-25", "2026-07-24"),
        expenses: []
      }).month
    ).toBe("2026-07");
  });

  test("files a mid-month card cycle and a calendar bank month together", () => {
    const card = determineStatementMonth({
      statement: summaryWithPeriod("2026-06-12", "2026-07-11"),
      expenses: []
    });
    const bank = determineStatementMonth({
      statement: summaryWithPeriod("2026-06-01", "2026-06-30"),
      expenses: []
    });

    expect(card.month).toBe(bank.month);
    expect(card.month).toBe("2026-06");
  });

  test("resolves a tie to the earlier month", () => {
    expect(
      determineStatementMonth({
        statement: summaryWithPeriod("2026-06-16", "2026-07-15"),
        expenses: []
      }).month
    ).toBe("2026-06");
  });

  test("falls back to row dates when the period is unusable", () => {
    const rows = [
      expense("tx-1", "2026-06-04"),
      expense("tx-2", "2026-06-19"),
      expense("tx-3", "2026-07-02")
    ];

    for (const [start, end] of [
      ["", ""],
      ["not-a-date", "also-not-a-date"],
      ["2026-07-31", "2026-06-01"]
    ]) {
      const determined = determineStatementMonth({
        statement: summaryWithPeriod(start, end),
        expenses: rows
      });

      expect(determined.month).toBe("2026-06");
      expect(determined.source).toBe("rows");
    }
  });

  test("reports an undeterminable statement rather than guessing", () => {
    const determined = determineStatementMonth({
      statement: summaryWithPeriod("", ""),
      expenses: [expense("tx-1", ""), { ...expense("tx-2", ""), postedDate: "" }]
    });

    expect(determined.month).toBe(null);
    expect(determined.source).toBe("none");
  });
});

describe("month documents", () => {
  test("files a second statement into an existing month without replacing the first", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04"
    ]);
    const bank = statementWith(
      "statement-bank",
      summaryWithPeriod("2026-06-01", "2026-06-30"),
      ["2026-06-09", "2026-06-18"]
    );
    const firstDocument = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: card.statement,
      expenses: card.expenses
    });
    const secondDocument = fileStatementIntoMonth(firstDocument, {
      month: "2026-06",
      statement: bank.statement,
      expenses: bank.expenses
    });

    expect(secondDocument.month).toBe("2026-06");
    expect(secondDocument.statements.map((statement) => statement.id)).toEqual([
      "statement-card",
      "statement-bank"
    ]);
    expect(secondDocument.expenses.length).toBe(3);
    expect(secondDocument.selectedIds).toContain(card.expenses[0].id);
    expect(secondDocument.selectedIds.length).toBe(3);
    expect(secondDocument.activeStatementId).toBe("statement-bank");
  });

  test("keeps an unselected row unselected when a second statement is filed", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04",
      "2026-06-05"
    ]);
    const bank = statementWith("statement-bank", statementSummary, [
      "2026-06-09"
    ]);
    const firstDocument = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: card.statement,
      expenses: card.expenses,
      selectedIds: [card.expenses[0].id]
    });
    const secondDocument = fileStatementIntoMonth(firstDocument, {
      month: "2026-06",
      statement: bank.statement,
      expenses: bank.expenses
    });

    expect(secondDocument.selectedIds).toContain(card.expenses[0].id);
    expect(secondDocument.selectedIds).not.toContain(card.expenses[1].id);
    expect(secondDocument.selectedIds).toContain(bank.expenses[0].id);
  });

  test("reassigning a statement moves its rows, creates the target, and empties the source", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04"
    ]);
    const source = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: card.statement,
      expenses: card.expenses
    });
    const moved = reassignStatementMonth({
      statementId: "statement-card",
      source,
      target: null,
      month: "2026-07"
    });

    expect(moved.source).toBe(null);
    expect(moved.target.month).toBe("2026-07");
    expect(moved.target.statements.map((statement) => statement.id)).toEqual([
      "statement-card"
    ]);
    expect(moved.target.expenses.length).toBe(1);
    expect(moved.target.selectedIds).toEqual([card.expenses[0].id]);
  });

  test("reassigning one of two statements leaves the source month intact", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04"
    ]);
    const bank = statementWith("statement-bank", statementSummary, [
      "2026-06-09"
    ]);
    const source = fileStatementIntoMonth(
      fileStatementIntoMonth(null, {
        month: "2026-06",
        statement: card.statement,
        expenses: card.expenses
      }),
      {
        month: "2026-06",
        statement: bank.statement,
        expenses: bank.expenses
      }
    );
    const target = createMonthDocument({
      month: "2026-07",
      statements: [],
      expenses: [],
      selectedIds: []
    });
    const moved = reassignStatementMonth({
      statementId: "statement-bank",
      source,
      target,
      month: "2026-07"
    });

    expect(moved.source?.statements.map((statement) => statement.id)).toEqual([
      "statement-card"
    ]);
    expect(moved.source?.expenses.length).toBe(1);
    expect(moved.target.statements.map((statement) => statement.id)).toEqual([
      "statement-bank"
    ]);
    expect(moved.target.expenses.length).toBe(1);
  });

  test("marks a reassigned statement's month as chosen by hand", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04"
    ]);
    const source = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: { ...card.statement, monthSource: "period" },
      expenses: card.expenses
    });
    const moved = reassignStatementMonth({
      statementId: "statement-card",
      source,
      target: null,
      month: "2026-07"
    });

    expect(moved.target.statements[0].monthSource).toBe("manual");
  });

  test("merges an incoming month document into what is already filed", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04"
    ]);
    const bank = statementWith("statement-bank", statementSummary, [
      "2026-06-09"
    ]);
    const base = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: card.statement,
      expenses: card.expenses,
      selectedIds: []
    });
    const incoming = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: bank.statement,
      expenses: bank.expenses
    });
    const merged = mergeMonthDocuments(base, incoming);

    expect(merged.statements.map((statement) => statement.id)).toEqual([
      "statement-card",
      "statement-bank"
    ]);
    expect(merged.expenses.length).toBe(2);
    expect(merged.selectedIds).toEqual([bank.expenses[0].id]);
    expect(mergeMonthDocuments(null, incoming).expenses.length).toBe(1);
  });

  test("round-trips a month document through parse unchanged", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04",
      "2026-06-11"
    ]);
    const document = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: card.statement,
      expenses: card.expenses
    });
    const parsed = parseMonthDocument(JSON.parse(JSON.stringify(document)));

    expect(parsed).toEqual(document);
  });

  test("discards malformed rows, orphans, and unknown versions without throwing", () => {
    const card = statementWith("statement-card", statementSummary, [
      "2026-06-04"
    ]);
    const document = fileStatementIntoMonth(null, {
      month: "2026-06",
      statement: card.statement,
      expenses: card.expenses
    });
    const damaged = JSON.parse(JSON.stringify(document)) as Record<
      string,
      unknown
    >;
    damaged.expenses = [
      ...(damaged.expenses as unknown[]),
      { id: "broken", amount: "ten" },
      { ...(document.expenses[0] as object), id: "orphan", statementId: "gone" }
    ];

    const parsed = parseMonthDocument(damaged);

    expect(parsed?.expenses.length).toBe(1);
    expect(parsed?.expenses[0].id).toBe(document.expenses[0].id);
    expect(parseMonthDocument({ version: 999, month: "2026-06" })).toBe(null);
    expect(parseMonthDocument({ version: 1, month: "nope" })).toBe(null);
    expect(parseMonthDocument(null)).toBe(null);

    const emptied = parseMonthDocument({ version: 1, month: "2026-06" });

    expect(emptied?.statements.length).toBe(0);
    expect(emptied?.expenses.length).toBe(0);
    expect(emptied?.selectedIds.length).toBe(0);
    expect(emptied?.activeStatementId).toBe("");
  });

  test("lists months chronologically and omits months without statements", () => {
    const june = statementWith("statement-june", statementSummary, [
      "2026-06-04"
    ]);
    const august = statementWith(
      "statement-august",
      summaryWithPeriod("2026-08-01", "2026-08-31"),
      ["2026-08-04", "2026-08-06"]
    );
    const documents = [
      fileStatementIntoMonth(null, {
        month: "2026-08",
        statement: august.statement,
        expenses: august.expenses
      }),
      createMonthDocument({
        month: "2026-07",
        statements: [],
        expenses: [],
        selectedIds: []
      }),
      fileStatementIntoMonth(null, {
        month: "2026-06",
        statement: june.statement,
        expenses: june.expenses
      })
    ];
    const listed = listMonths(documents);

    expect(listed.map((entry) => entry.month)).toEqual(["2026-06", "2026-08"]);
    expect(listed[1].statementCount).toBe(1);
    expect(listed[1].expenseCount).toBe(2);
    expect(listed[1].amount).toBe(20);
  });
});

describe("legacy review draft migration", () => {
  test("distributes a single-month draft into its month", () => {
    const card = statementWith(
      "statement-card",
      summaryWithPeriod("2026-06-12", "2026-07-11"),
      ["2026-06-14", "2026-07-02"]
    );
    const draft = createReviewDraft({
      statements: [card.statement],
      expenses: card.expenses,
      selectedIds: [card.expenses[0].id],
      activeStatementId: card.statement.id
    });
    const migrated = migrateReviewDraftToMonths(draft);

    expect(migrated.months.length).toBe(1);
    expect(migrated.months[0].month).toBe("2026-06");
    expect(migrated.months[0].expenses.length).toBe(2);
    expect(migrated.months[0].selectedIds).toEqual([card.expenses[0].id]);
    expect(migrated.unresolvedStatementIds.length).toBe(0);
  });

  test("splits a draft holding two months into two documents", () => {
    const june = statementWith(
      "statement-june",
      summaryWithPeriod("2026-06-01", "2026-06-30"),
      ["2026-06-14"]
    );
    const august = statementWith(
      "statement-august",
      summaryWithPeriod("2026-08-01", "2026-08-31"),
      ["2026-08-14", "2026-08-15"]
    );
    const draft = createReviewDraft({
      statements: [june.statement, august.statement],
      expenses: [...june.expenses, ...august.expenses],
      selectedIds: [...june.expenses, ...august.expenses].map(
        (item) => item.id
      ),
      activeStatementId: august.statement.id
    });
    const migrated = migrateReviewDraftToMonths(draft);

    expect(migrated.months.map((document) => document.month)).toEqual([
      "2026-06",
      "2026-08"
    ]);
    expect(migrated.months[0].statements.length).toBe(1);
    expect(migrated.months[1].expenses.length).toBe(2);
  });

  test("records whether each migrated month came from the period or the rows", () => {
    const dated = statementWith(
      "statement-dated",
      summaryWithPeriod("2026-06-01", "2026-06-30"),
      ["2026-06-14"]
    );
    const guessed = statementWith(
      "statement-guessed",
      summaryWithPeriod("", ""),
      ["2026-08-14"]
    );
    const draft = createReviewDraft({
      statements: [dated.statement, guessed.statement],
      expenses: [...dated.expenses, ...guessed.expenses],
      selectedIds: [],
      activeStatementId: dated.statement.id
    });
    const migrated = migrateReviewDraftToMonths(draft);

    expect(migrated.months[0].statements[0].monthSource).toBe("period");
    expect(migrated.months[1].statements[0].monthSource).toBe("rows");
  });

  test("reports statements whose month cannot be determined", () => {
    const unknown = statementWith("statement-unknown", summaryWithPeriod("", ""), [
      ""
    ]);
    const draft = createReviewDraft({
      statements: [unknown.statement],
      expenses: unknown.expenses,
      selectedIds: [],
      activeStatementId: unknown.statement.id
    });
    const migrated = migrateReviewDraftToMonths(draft);

    expect(migrated.months.length).toBe(0);
    expect(migrated.unresolvedStatementIds).toEqual(["statement-unknown"]);
  });
});

describe("month labels", () => {
  test("formats a month key for the stepper", () => {
    expect(formatMonthLabel("2026-06")).toBe("June 2026");
    expect(formatMonthLabel("nope")).toBe("nope");
  });
});
