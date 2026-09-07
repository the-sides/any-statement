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

export type MonthsTimeline = {
  months: MonthTimelineEntry[];
  currency: string;
  incomeTotal: number;
  spendTotal: number;
  savedTotal: number;
  savedMonths: number;
  overspentMonths: number;
};

export const EMPTY_MONTHS_TIMELINE: MonthsTimeline = {
  months: [],
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
  const months = documents
    .filter((document) => document.statements.length > 0)
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
    currency: pickCurrency(documents),
    incomeTotal,
    spendTotal,
    savedTotal: incomeTotal - spendTotal,
    savedMonths: months.filter((month) => month.summary.savedAmount > 0).length,
    overspentMonths: months.filter((month) => month.summary.savedAmount < 0)
      .length
  };
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
