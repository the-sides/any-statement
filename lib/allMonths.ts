import {
  summarizeCashFlow,
  type CashFlowSummary
} from "@/lib/cashFlowPlan";
import type { MonthDocument } from "@/lib/months";

const DEFAULT_CURRENCY = "USD";

export type MonthTimelineEntry = {
  month: string;
  statementCount: number;
  expenseCount: number;
  /** The same summary the single-month cash flow panel draws, so the
   *  all-months view is the same graph repeated, one per month. */
  summary: CashFlowSummary;
};

export type YearTimelineEntry = {
  /** Calendar year, `YYYY`, taken from the month key. */
  year: string;
  monthCount: number;
  statementCount: number;
  expenseCount: number;
  /** Every one of the year's rows folded through the same summarizer the
   *  single-month panel uses, so the year graph is the month graph with a
   *  year of transactions behind it. */
  summary: CashFlowSummary;
};

/**
 * One expense row, flattened out of its month document so the overview can
 * list the transactions behind the graphs. It is a read-only projection: the
 * fields the table shows and the month key needed to open the row where it is
 * editable, nothing else.
 */
export type TimelineTransaction = {
  id: string;
  month: string;
  date: string;
  merchant: string;
  description: string;
  category: string;
  amount: number;
  reimbursedAmount: number;
};

export type MonthsTimeline = {
  months: MonthTimelineEntry[];
  years: YearTimelineEntry[];
  /** Every filed month's expenses, newest first. */
  transactions: TimelineTransaction[];
  currency: string;
  incomeTotal: number;
  spendTotal: number;
  savedTotal: number;
  savedMonths: number;
  overspentMonths: number;
};

export const EMPTY_MONTHS_TIMELINE: MonthsTimeline = {
  months: [],
  years: [],
  transactions: [],
  currency: DEFAULT_CURRENCY,
  incomeTotal: 0,
  spendTotal: 0,
  savedTotal: 0,
  savedMonths: 0,
  overspentMonths: 0
};

/**
 * Folds every filed month into one series of per-month cash flow summaries —
 * the same numbers the single-month view shows — plus the totals across them.
 * Manual plan entries are deliberately left out: they describe the current
 * month's intent, not what actually happened in past months.
 */
export function summarizeMonthsTimeline(
  documents: readonly MonthDocument[]
): MonthsTimeline {
  const filed = documents.filter(
    (document) => document.statements.length > 0
  );
  const months = filed
    .map((document) => ({
      month: document.month,
      statementCount: document.statements.length,
      expenseCount: document.expenses.length,
      summary: summarizeCashFlow([], document.expenses, document.incomes)
    }))
    .sort((first, second) => first.month.localeCompare(second.month));

  const incomeTotal = months.reduce(
    (total, month) => total + month.summary.incomeTotal,
    0
  );
  const spendTotal = months.reduce(
    (total, month) => total + month.summary.allocatedTotal,
    0
  );

  return {
    months,
    years: summarizeYears(filed),
    transactions: listTransactions(filed),
    currency: pickCurrency(documents),
    incomeTotal,
    spendTotal,
    savedTotal: incomeTotal - spendTotal,
    savedMonths: months.filter((month) => month.summary.savedAmount > 0).length,
    overspentMonths: months.filter((month) => month.summary.savedAmount < 0)
      .length
  };
}

/**
 * Every filed month's expenses as one list, newest first. Rows with no date
 * sort last rather than to the top, where an empty date string would otherwise
 * put them; the month key breaks ties so a month's rows stay together.
 */
function listTransactions(
  documents: readonly MonthDocument[]
): TimelineTransaction[] {
  return documents
    .flatMap((document) =>
      document.expenses.map((expense) => ({
        id: expense.id,
        month: document.month,
        date: expense.date,
        merchant: expense.merchant,
        description: expense.description,
        category: expense.category,
        amount: expense.amount,
        reimbursedAmount: expense.reimbursedAmount
      }))
    )
    .sort((first, second) => {
      if (first.date !== second.date) {
        if (!first.date) {
          return 1;
        }

        if (!second.date) {
          return -1;
        }

        return second.date.localeCompare(first.date);
      }

      return second.month.localeCompare(first.month);
    });
}

/**
 * One entry per calendar year, summarized from the year's *rows* rather than
 * from its month summaries: merging the rows is what makes a category one
 * ribbon across the year instead of twelve stacked slices.
 */
function summarizeYears(
  documents: readonly MonthDocument[]
): YearTimelineEntry[] {
  const byYear = new Map<string, MonthDocument[]>();

  for (const document of documents) {
    const year = document.month.slice(0, 4);
    const bucket = byYear.get(year);

    if (bucket) {
      bucket.push(document);
    } else {
      byYear.set(year, [document]);
    }
  }

  return [...byYear.entries()]
    .map(([year, yearDocuments]) => {
      const expenses = yearDocuments.flatMap((document) => document.expenses);
      const incomes = yearDocuments.flatMap((document) => document.incomes);

      return {
        year,
        monthCount: yearDocuments.length,
        statementCount: yearDocuments.reduce(
          (total, document) => total + document.statements.length,
          0
        ),
        expenseCount: expenses.length,
        summary: summarizeCashFlow([], expenses, incomes)
      };
    })
    .sort((first, second) => first.year.localeCompare(second.year));
}

/** Statements name the currency; expenses only echo it, so they are the fallback. */
function pickCurrency(documents: readonly MonthDocument[]) {
  const counts = new Map<string, number>();

  for (const document of documents) {
    for (const statement of document.statements) {
      const currency = statement.statement.currency.trim().toUpperCase();

      if (currency) {
        counts.set(currency, (counts.get(currency) ?? 0) + 1);
      }
    }
  }

  let picked = DEFAULT_CURRENCY;
  let best = 0;

  for (const [currency, count] of counts) {
    if (count > best) {
      picked = currency;
      best = count;
    }
  }

  return picked;
}
