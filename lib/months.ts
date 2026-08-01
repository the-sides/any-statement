import {
  normalizeReviewContents,
  parseReviewContents,
  type ReviewContents,
  type ReviewStatement
} from "@/lib/reviewDraft";
import type { ExpenseItem, StatementSummary } from "@/lib/types";

export const MONTH_DOCUMENT_VERSION = 1;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

export type MonthDocument = ReviewContents & {
  version: typeof MONTH_DOCUMENT_VERSION;
  month: string;
  savedAt: string;
};

export type MonthSummary = {
  month: string;
  statementCount: number;
  expenseCount: number;
  amount: number;
};

export type MonthDeterminationSource = "period" | "rows" | "none";

export type MonthDetermination = {
  month: string | null;
  source: MonthDeterminationSource;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

export function formatMonthLabel(month: string) {
  if (!isMonthKey(month)) {
    return month;
  }

  const [year, monthNumber] = month.split("-");

  return `${MONTH_NAMES[Number(monthNumber) - 1]} ${year}`;
}

export function determineStatementMonth(input: {
  statement: StatementSummary;
  expenses: readonly ExpenseItem[];
}): MonthDetermination {
  const fromPeriod = monthFromPeriod(
    input.statement.periodStart,
    input.statement.periodEnd
  );

  if (fromPeriod) {
    return { month: fromPeriod, source: "period" };
  }

  const fromRows = monthFromRowDates(input.expenses);

  if (fromRows) {
    return { month: fromRows, source: "rows" };
  }

  return { month: null, source: "none" };
}

export function createMonthDocument(input: {
  month: string;
  statements: readonly ReviewStatement[];
  expenses: readonly ExpenseItem[];
  selectedIds: Iterable<string>;
  activeStatementId?: string;
}): MonthDocument {
  return {
    version: MONTH_DOCUMENT_VERSION,
    month: input.month,
    ...normalizeReviewContents(input),
    savedAt: new Date().toISOString()
  };
}

export function parseMonthDocument(value: unknown): MonthDocument | null {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;

  if (!record || record.version !== MONTH_DOCUMENT_VERSION) {
    return null;
  }

  if (!isMonthKey(record.month)) {
    return null;
  }

  return {
    version: MONTH_DOCUMENT_VERSION,
    month: record.month,
    ...parseReviewContents(record),
    savedAt: typeof record.savedAt === "string" ? record.savedAt : ""
  };
}

export function fileStatementIntoMonth(
  document: MonthDocument | null,
  input: {
    month: string;
    statement: ReviewStatement;
    expenses: readonly ExpenseItem[];
    selectedIds?: Iterable<string>;
  }
): MonthDocument {
  const existingStatements = document?.statements || [];
  const replaces = existingStatements.some(
    (statement) => statement.id === input.statement.id
  );
  const statements = replaces
    ? existingStatements.map((statement) =>
        statement.id === input.statement.id ? input.statement : statement
      )
    : [...existingStatements, input.statement];
  const expenses = [
    ...(document?.expenses || []).filter(
      (expense) => expense.statementId !== input.statement.id
    ),
    ...input.expenses
  ];
  const keptSelectedIds = (document?.selectedIds || []).filter((id) =>
    expenses.some((expense) => expense.id === id)
  );
  const addedSelectedIds = input.selectedIds
    ? [...input.selectedIds]
    : input.expenses.map((expense) => expense.id);

  return createMonthDocument({
    month: input.month,
    statements,
    expenses,
    selectedIds: new Set([...keptSelectedIds, ...addedSelectedIds]),
    activeStatementId: input.statement.id
  });
}

export function reassignStatementMonth(input: {
  statementId: string;
  source: MonthDocument;
  target: MonthDocument | null;
  month: string;
}): { source: MonthDocument | null; target: MonthDocument } {
  const statement = input.source.statements.find(
    (candidate) => candidate.id === input.statementId
  );

  if (!statement) {
    return {
      source: input.source,
      target:
        input.target ||
        createMonthDocument({
          month: input.month,
          statements: [],
          expenses: [],
          selectedIds: []
        })
    };
  }

  const movedExpenses = input.source.expenses.filter(
    (expense) => expense.statementId === input.statementId
  );
  const movedExpenseIds = new Set(movedExpenses.map((expense) => expense.id));
  const movedSelectedIds = input.source.selectedIds.filter((id) =>
    movedExpenseIds.has(id)
  );
  const remainingStatements = input.source.statements.filter(
    (candidate) => candidate.id !== input.statementId
  );
  const remainingSource = remainingStatements.length
    ? createMonthDocument({
        month: input.source.month,
        statements: remainingStatements,
        expenses: input.source.expenses.filter(
          (expense) => !movedExpenseIds.has(expense.id)
        ),
        selectedIds: input.source.selectedIds.filter(
          (id) => !movedExpenseIds.has(id)
        ),
        activeStatementId: input.source.activeStatementId
      })
    : null;

  return {
    source: remainingSource,
    target: fileStatementIntoMonth(input.target, {
      month: input.month,
      statement,
      expenses: movedExpenses,
      selectedIds: movedSelectedIds
    })
  };
}

export function listMonths(
  documents: readonly MonthDocument[]
): MonthSummary[] {
  return documents
    .filter((document) => document.statements.length > 0)
    .map(summarizeMonthDocument)
    .sort((first, second) => first.month.localeCompare(second.month));
}

export function summarizeMonthDocument(document: MonthDocument): MonthSummary {
  return {
    month: document.month,
    statementCount: document.statements.length,
    expenseCount: document.expenses.length,
    amount: document.expenses.reduce((sum, expense) => sum + expense.amount, 0)
  };
}

export function migrateReviewDraftToMonths(draft: ReviewContents): {
  months: MonthDocument[];
  unresolvedStatementIds: string[];
} {
  const selectedIds = new Set(draft.selectedIds);
  const unresolvedStatementIds: string[] = [];
  const documents = new Map<string, MonthDocument>();

  for (const statement of draft.statements) {
    const expenses = draft.expenses.filter(
      (expense) => expense.statementId === statement.id
    );
    const determined = determineStatementMonth({
      statement: statement.statement,
      expenses
    });

    if (!determined.month) {
      unresolvedStatementIds.push(statement.id);
      continue;
    }

    documents.set(
      determined.month,
      fileStatementIntoMonth(documents.get(determined.month) || null, {
        month: determined.month,
        statement,
        expenses,
        selectedIds: expenses
          .map((expense) => expense.id)
          .filter((id) => selectedIds.has(id))
      })
    );
  }

  return {
    months: [...documents.values()].sort((first, second) =>
      first.month.localeCompare(second.month)
    ),
    unresolvedStatementIds
  };
}

function monthFromPeriod(periodStart: string, periodEnd: string) {
  const start = parseCalendarDate(periodStart);
  const end = parseCalendarDate(periodEnd);

  if (!start || !end || compareCalendarDates(start, end) > 0) {
    return null;
  }

  return pickBusiestMonth(countPeriodDaysByMonth(start, end));
}

function monthFromRowDates(expenses: readonly ExpenseItem[]) {
  const counts = new Map<string, number>();

  for (const expense of expenses) {
    const date =
      parseCalendarDate(expense.date) || parseCalendarDate(expense.postedDate);

    if (!date) {
      continue;
    }

    const key = monthKeyOf(date.year, date.month);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return pickBusiestMonth(counts);
}

function countPeriodDaysByMonth(start: CalendarDate, end: CalendarDate) {
  const counts = new Map<string, number>();
  let year = start.year;
  let month = start.month;

  while (year < end.year || (year === end.year && month <= end.month)) {
    const firstDay =
      year === start.year && month === start.month ? start.day : 1;
    const lastDay =
      year === end.year && month === end.month ? end.day : daysInMonth(year, month);

    counts.set(monthKeyOf(year, month), lastDay - firstDay + 1);

    month += 1;

    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return counts;
}

function pickBusiestMonth(counts: Map<string, number>) {
  let bestMonth: string | null = null;
  let bestCount = 0;

  for (const month of [...counts.keys()].sort()) {
    const count = counts.get(month) || 0;

    if (count > bestCount) {
      bestMonth = month;
      bestCount = count;
    }
  }

  return bestMonth;
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = CALENDAR_DATE_PATTERN.exec((value || "").trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

function compareCalendarDates(first: CalendarDate, second: CalendarDate) {
  return (
    first.year - second.year || first.month - second.month || first.day - second.day
  );
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthKeyOf(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}
