import type { MonthDocument } from "@/lib/months";
import type { StatementMonthSource } from "@/lib/reviewDraft";

const DEFAULT_CURRENCY = "USD";

const MONTH_SUFFIX_PATTERN = /-(\d{4}-\d{2})$/;

/**
 * One uploaded file's share of a single month. A statement covering one
 * billing cycle has exactly one segment; a multi-month export has one per
 * calendar month, because `planStatementFiling` splits it and files each part
 * under its own statement id.
 */
export type DocumentSegment = {
  /** The statement id as filed: `<documentId>` or `<documentId>-<YYYY-MM>`. */
  statementId: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  expenseCount: number;
  incomeCount: number;
  grossTotal: number;
  reimbursedTotal: number;
  netTotal: number;
  incomeTotal: number;
};

/** An expense row as the manager lists it, plus the month that owns it. */
export type DocumentTransaction = {
  id: string;
  month: string;
  date: string;
  postedDate: string;
  merchant: string;
  description: string;
  category: string;
  amount: number;
  reimbursedAmount: number;
};

export type DocumentIncome = {
  id: string;
  month: string;
  date: string;
  source: string;
  kind: string;
  amount: number;
};

/**
 * One uploaded statement file, with every month its rows landed in folded back
 * together. The split that files a January-May export as five month documents
 * is a storage detail; the reviewer uploaded one file and looks for one entry.
 */
export type LedgerDocument = {
  /** Stable across segments: the statement id with any month suffix removed. */
  id: string;
  sourceFileName: string;
  institution: string;
  accountMask: string;
  statementType: string;
  currency: string;
  importedAt: string;
  monthSource: StatementMonthSource;
  /** Every month the rows were filed into, ascending. */
  months: string[];
  /** Widest period across segments, so a split export reads as one span. */
  periodStart: string;
  periodEnd: string;
  segments: DocumentSegment[];
  expenseCount: number;
  incomeCount: number;
  grossTotal: number;
  reimbursedTotal: number;
  netTotal: number;
  incomeTotal: number;
  transactions: DocumentTransaction[];
  incomes: DocumentIncome[];
};

export type DocumentsIndex = {
  documents: LedgerDocument[];
  currency: string;
  monthCount: number;
  expenseCount: number;
  grossTotal: number;
  netTotal: number;
  incomeTotal: number;
};

export const EMPTY_DOCUMENTS_INDEX: DocumentsIndex = {
  documents: [],
  currency: DEFAULT_CURRENCY,
  monthCount: 0,
  expenseCount: 0,
  grossTotal: 0,
  netTotal: 0,
  incomeTotal: 0
};

/**
 * The id shared by every segment of one upload. A split statement is filed as
 * `<id>-<YYYY-MM>`, so the suffix is only stripped when it names the month the
 * segment was filed into - an unsplit id that merely ends in digits is left
 * alone.
 */
export function documentIdOf(statementId: string, month: string) {
  const suffix = MONTH_SUFFIX_PATTERN.exec(statementId);

  return suffix && suffix[1] === month
    ? statementId.slice(0, -suffix[0].length)
    : statementId;
}

/** Every uploaded statement, newest period first, with its rows and totals. */
export function listLedgerDocuments(
  documents: readonly MonthDocument[]
): DocumentsIndex {
  // Rows always point at a statement the month holds: `normalizeReviewContents`
  // drops any that do not, so every stored row belongs to exactly one document.
  const byId = new Map<string, LedgerDocument>();

  for (const month of documents) {
    for (const statement of month.statements) {
      const id = documentIdOf(statement.id, month.month);
      const expenses = month.expenses.filter(
        (expense) => expense.statementId === statement.id
      );
      const incomes = month.incomes.filter(
        (income) => income.statementId === statement.id
      );
      const grossTotal = sum(expenses.map((expense) => expense.amount));
      const reimbursedTotal = sum(
        expenses.map((expense) => expense.reimbursedAmount)
      );
      const incomeTotal = sum(incomes.map((income) => income.amount));
      const segment: DocumentSegment = {
        statementId: statement.id,
        month: month.month,
        periodStart: statement.statement.periodStart,
        periodEnd: statement.statement.periodEnd,
        expenseCount: expenses.length,
        incomeCount: incomes.length,
        grossTotal,
        reimbursedTotal,
        netTotal: grossTotal - reimbursedTotal,
        incomeTotal
      };

      const existing = byId.get(id);
      const entry: LedgerDocument = existing || {
        id,
        sourceFileName: statement.sourceFileName,
        institution: statement.statement.institution,
        accountMask: statement.statement.accountMask,
        statementType: statement.statement.statementType,
        currency: statement.statement.currency || DEFAULT_CURRENCY,
        importedAt: statement.importedAt,
        monthSource: statement.monthSource,
        months: [],
        periodStart: "",
        periodEnd: "",
        segments: [],
        expenseCount: 0,
        incomeCount: 0,
        grossTotal: 0,
        reimbursedTotal: 0,
        netTotal: 0,
        incomeTotal: 0,
        transactions: [],
        incomes: []
      };

      entry.segments.push(segment);
      entry.months.push(month.month);
      entry.expenseCount += segment.expenseCount;
      entry.incomeCount += segment.incomeCount;
      entry.grossTotal += segment.grossTotal;
      entry.reimbursedTotal += segment.reimbursedTotal;
      entry.netTotal += segment.netTotal;
      entry.incomeTotal += segment.incomeTotal;
      entry.transactions.push(
        ...expenses.map((expense) => ({
          id: expense.id,
          month: month.month,
          date: expense.date,
          postedDate: expense.postedDate,
          merchant: expense.merchant,
          description: expense.description,
          category: expense.category,
          amount: expense.amount,
          reimbursedAmount: expense.reimbursedAmount
        }))
      );
      entry.incomes.push(
        ...incomes.map((income) => ({
          id: income.id,
          month: month.month,
          date: income.date,
          source: income.source,
          kind: income.kind,
          amount: income.amount
        }))
      );

      if (!existing) {
        byId.set(id, entry);
      }
    }
  }

  const entries = [...byId.values()];

  for (const entry of entries) {
    entry.months.sort();
    entry.segments.sort((first, second) =>
      first.month.localeCompare(second.month)
    );
    entry.transactions.sort(compareByDateDescending);
    entry.incomes.sort(compareByDateDescending);

    // Widest span across segments, ignoring segments whose period is blank.
    const starts = entry.segments
      .map((segment) => segment.periodStart)
      .filter(Boolean)
      .sort();
    const ends = entry.segments
      .map((segment) => segment.periodEnd)
      .filter(Boolean)
      .sort();

    entry.periodStart = starts[0] || "";
    entry.periodEnd = ends[ends.length - 1] || "";
  }

  entries.sort((first, second) => {
    if (first.periodEnd !== second.periodEnd) {
      return second.periodEnd.localeCompare(first.periodEnd);
    }

    if (first.importedAt !== second.importedAt) {
      return second.importedAt.localeCompare(first.importedAt);
    }

    return first.sourceFileName.localeCompare(second.sourceFileName);
  });

  const coveredMonths = new Set(entries.flatMap((entry) => entry.months));

  return {
    documents: entries,
    currency: entries[0]?.currency || DEFAULT_CURRENCY,
    monthCount: coveredMonths.size,
    expenseCount: sum(entries.map((entry) => entry.expenseCount)),
    grossTotal: sum(entries.map((entry) => entry.grossTotal)),
    netTotal: sum(entries.map((entry) => entry.netTotal)),
    incomeTotal: sum(entries.map((entry) => entry.incomeTotal))
  };
}

/** Newest first, with undated rows last rather than sorted to the top. */
function compareByDateDescending(
  first: { date: string; month: string },
  second: { date: string; month: string }
) {
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
}


function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}
