import {
  normalizeReviewContents,
  parseReviewContents,
  type ReviewContents,
  type ReviewStatement,
  type StatementMonthSource
} from "@/lib/reviewDraft";
import type { ExpenseItem, IncomeItem, StatementSummary } from "@/lib/types";

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
  incomeCount: number;
  incomeTotal: number;
};

export type MonthDeterminationSource = "period" | "rows" | "none";

export type MonthDetermination = {
  month: string | null;
  source: MonthDeterminationSource;
};

/**
 * One month's share of a statement. A statement covering a single billing
 * cycle produces exactly one; a multi-month export produces one per calendar
 * month its rows fall in.
 */
export type StatementFilingSegment = {
  month: string;
  statement: ReviewStatement;
  expenses: ExpenseItem[];
  incomes: IncomeItem[];
  selectedIds: string[];
};

export type StatementFilingPlan = {
  segments: StatementFilingSegment[];
  /** Where the workspace should land; null when nothing could be determined. */
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
  const period = parsePeriod(input.statement);
  const fromPeriod = period
    ? pickBusiestMonth(countPeriodDaysByMonth(period.start, period.end))
    : null;

  if (fromPeriod) {
    return { month: fromPeriod, source: "period" };
  }

  const fromRows = monthFromRowDates(input.expenses);

  if (fromRows) {
    return { month: fromRows, source: "rows" };
  }

  return { month: null, source: "none" };
}

export function statementMonthSourceOf(
  determination: MonthDetermination
): StatementMonthSource {
  return determination.source === "rows" ? "rows" : "period";
}

/**
 * A billing cycle is about a month long, so a period no longer than this is one
 * statement of one month even when it straddles two calendar months - that is
 * what keeps a Jun 12 - Jul 11 card cycle filed beside the calendar-month bank
 * statement. Anything materially longer (a bank export covering Jan - May, say)
 * is not a cycle at all, and filing all of it under its busiest month buries
 * four months of rows in the fifth.
 */
const SINGLE_CYCLE_DAYS = 45;

/**
 * Decides which month or months a statement's rows belong to, and splits the
 * rows accordingly. Callers file every returned segment; `month` is the one to
 * show afterwards.
 */
export function planStatementFiling(input: {
  statement: ReviewStatement;
  expenses: readonly ExpenseItem[];
  incomes?: readonly IncomeItem[];
  selectedIds?: Iterable<string>;
}): StatementFilingPlan {
  const expenses = [...input.expenses];
  const incomes = [...(input.incomes || [])];
  const selectedIds = new Set(
    input.selectedIds
      ? [...input.selectedIds]
      : expenses.map((expense) => expense.id)
  );
  const period = parsePeriod(input.statement.statement);
  const rowMonths = countRowsByMonth(expenses, incomes);
  const determined = determineStatementMonth({
    statement: input.statement.statement,
    expenses
  });

  if (!spansMultipleCycles(period, expenses, incomes) || rowMonths.size < 2) {
    if (!determined.month) {
      return { segments: [], month: null, source: "none" };
    }

    return {
      segments: [
        {
          month: determined.month,
          statement: {
            ...input.statement,
            monthSource: statementMonthSourceOf(determined)
          },
          expenses,
          incomes,
          selectedIds: expenses
            .map((expense) => expense.id)
            .filter((id) => selectedIds.has(id))
        }
      ],
      month: determined.month,
      source: determined.source
    };
  }

  // Rows carry their own dates here, so they decide the months rather than the
  // period. Undated rows fall to the busiest month instead of being dropped.
  const primaryMonth = pickBusiestMonth(rowMonths) || determined.month;

  if (!primaryMonth) {
    return { segments: [], month: null, source: "none" };
  }

  const segments = [...rowMonths.keys()]
    .sort()
    .map((month) => {
      const monthExpenses = expenses.filter(
        (expense) => rowMonth(expense.date, expense.postedDate, primaryMonth) === month
      );
      const monthIncomes = incomes.filter(
        (income) => rowMonth(income.date, "", primaryMonth) === month
      );
      const id = `${input.statement.id}-${month}`;

      return {
        month,
        statement: {
          ...input.statement,
          id,
          monthSource: "rows" as const,
          statement: clampStatementPeriod(
            input.statement.statement,
            month,
            period,
            [...monthExpenses.map((expense) => expense.date), ...monthIncomes.map((income) => income.date)]
          )
        },
        expenses: monthExpenses.map((expense) => ({ ...expense, statementId: id })),
        incomes: monthIncomes.map((income) => ({ ...income, statementId: id })),
        selectedIds: monthExpenses
          .map((expense) => expense.id)
          .filter((expenseId) => selectedIds.has(expenseId))
      };
    });

  return { segments, month: primaryMonth, source: "rows" };
}

export function createMonthDocument(input: {
  month: string;
  statements: readonly ReviewStatement[];
  expenses: readonly ExpenseItem[];
  incomes?: readonly IncomeItem[];
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
    incomes?: readonly IncomeItem[];
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
  const incomes = [
    ...(document?.incomes || []).filter(
      (income) => income.statementId !== input.statement.id
    ),
    ...(input.incomes || [])
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
    incomes,
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
  const movedIncomes = input.source.incomes.filter(
    (income) => income.statementId === input.statementId
  );
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
        incomes: input.source.incomes.filter(
          (income) => !movedExpenseIds.has(income.id)
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
      statement: { ...statement, monthSource: "manual" },
      expenses: movedExpenses,
      incomes: movedIncomes,
      selectedIds: movedSelectedIds
    })
  };
}

/**
 * Folds one month document into another, statement by statement, so a document
 * arriving from elsewhere joins what is already filed instead of replacing it.
 */
export function mergeMonthDocuments(
  base: MonthDocument | null,
  incoming: MonthDocument
): MonthDocument {
  const selectedIds = new Set(incoming.selectedIds);
  const merged = incoming.statements.reduce<MonthDocument | null>(
    (document, statement) => {
      const expenses = expensesForStatement(incoming, statement.id);
      const incomes = incoming.incomes.filter(
        (income) => income.statementId === statement.id
      );

      return fileStatementIntoMonth(document, {
        month: incoming.month,
        statement,
        expenses,
        incomes,
        selectedIds: expenses
          .map((expense) => expense.id)
          .filter((id) => selectedIds.has(id))
      });
    },
    base
  );

  return merged || incoming;
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
    amount: document.expenses.reduce((sum, expense) => sum + expense.amount, 0),
    incomeCount: document.incomes.length,
    incomeTotal: document.incomes.reduce((sum, income) => sum + income.amount, 0)
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
    const plan = planStatementFiling({
      statement,
      expenses: expensesForStatement(draft, statement.id),
      incomes: incomesForStatement(draft, statement.id),
      selectedIds
    });

    if (plan.segments.length === 0) {
      unresolvedStatementIds.push(statement.id);
      continue;
    }

    for (const segment of plan.segments) {
      documents.set(
        segment.month,
        fileStatementIntoMonth(documents.get(segment.month) || null, segment)
      );
    }
  }

  return {
    months: [...documents.values()].sort((first, second) =>
      first.month.localeCompare(second.month)
    ),
    unresolvedStatementIds
  };
}

function expensesForStatement(
  contents: Pick<ReviewContents, "expenses">,
  statementId: string
) {
  return contents.expenses.filter(
    (expense) => expense.statementId === statementId
  );
}

function incomesForStatement(
  contents: Pick<ReviewContents, "incomes">,
  statementId: string
) {
  return contents.incomes.filter(
    (income) => income.statementId === statementId
  );
}

type StatementPeriod = { start: CalendarDate; end: CalendarDate } | null;

function parsePeriod(statement: StatementSummary): StatementPeriod {
  const start = parseCalendarDate(statement.periodStart);
  const end = parseCalendarDate(statement.periodEnd);

  if (!start || !end || compareCalendarDates(start, end) > 0) {
    return null;
  }

  return { start, end };
}

/**
 * True when the statement covers materially more than one billing cycle, judged
 * by its period, or by the span of its own row dates when the period is
 * unusable.
 */
function spansMultipleCycles(
  period: StatementPeriod,
  expenses: readonly ExpenseItem[],
  incomes: readonly IncomeItem[]
) {
  if (period) {
    return inclusiveDays(period.start, period.end) > SINGLE_CYCLE_DAYS;
  }

  const dates = [
    ...expenses.map((expense) => expense.date || expense.postedDate),
    ...incomes.map((income) => income.date)
  ]
    .map(parseCalendarDate)
    .filter((date): date is CalendarDate => Boolean(date))
    .sort(compareCalendarDates);

  if (dates.length < 2) {
    return false;
  }

  return inclusiveDays(dates[0], dates[dates.length - 1]) > SINGLE_CYCLE_DAYS;
}

function countRowsByMonth(
  expenses: readonly ExpenseItem[],
  incomes: readonly IncomeItem[]
) {
  const counts = new Map<string, number>();

  for (const key of [
    ...expenses.map((expense) => rowMonth(expense.date, expense.postedDate, "")),
    ...incomes.map((income) => rowMonth(income.date, "", ""))
  ]) {
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return counts;
}

/** A row's own month, falling back to `fallbackMonth` when it carries no date. */
function rowMonth(date: string, postedDate: string, fallbackMonth: string) {
  const parsed = parseCalendarDate(date) || parseCalendarDate(postedDate);

  return parsed ? monthKeyOf(parsed.year, parsed.month) : fallbackMonth;
}

/**
 * Narrows a split statement's period to the part of it that lands in one month,
 * so each month's copy describes that month rather than the whole export.
 */
function clampStatementPeriod(
  statement: StatementSummary,
  month: string,
  period: StatementPeriod,
  rowDates: readonly string[]
): StatementSummary {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart: CalendarDate = { year, month: monthNumber, day: 1 };
  const monthEnd: CalendarDate = {
    year,
    month: monthNumber,
    day: daysInMonth(year, monthNumber)
  };

  if (period) {
    return {
      ...statement,
      periodStart: formatCalendarDate(
        compareCalendarDates(period.start, monthStart) > 0 ? period.start : monthStart
      ),
      periodEnd: formatCalendarDate(
        compareCalendarDates(period.end, monthEnd) < 0 ? period.end : monthEnd
      )
    };
  }

  const dates = rowDates
    .map(parseCalendarDate)
    .filter((date): date is CalendarDate => Boolean(date))
    .sort(compareCalendarDates);

  return {
    ...statement,
    periodStart: formatCalendarDate(dates[0] || monthStart),
    periodEnd: formatCalendarDate(dates[dates.length - 1] || monthEnd)
  };
}

function inclusiveDays(start: CalendarDate, end: CalendarDate) {
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);

  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function formatCalendarDate(date: CalendarDate) {
  return `${monthKeyOf(date.year, date.month)}-${String(date.day).padStart(2, "0")}`;
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
