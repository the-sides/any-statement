import { getSql, toNullableNumber, toNumber, toText } from "@/lib/db";
import {
  isMonthKey,
  listMonths,
  MONTH_DOCUMENT_VERSION,
  type MonthDocument,
  type MonthSummary
} from "@/lib/months";
import { parseReviewContents } from "@/lib/reviewDraft";

type MonthRow = {
  month: string;
  active_statement_id: unknown;
  saved_at: unknown;
};

type StatementRow = {
  month: string;
  id: string;
  source_file_name: unknown;
  imported_at: unknown;
  month_source: unknown;
  institution: unknown;
  account_mask: unknown;
  statement_type: unknown;
  period_start: unknown;
  period_end: unknown;
  currency: unknown;
  opening_balance: unknown;
  closing_balance: unknown;
  confidence: unknown;
};

type ExpenseRow = {
  month: string;
  id: string;
  statement_id: unknown;
  selected: unknown;
  date: unknown;
  posted_date: unknown;
  description: unknown;
  merchant: unknown;
  amount: unknown;
  reimbursed_amount: unknown;
  currency: unknown;
  category: unknown;
  subcategory: unknown;
  payment_method: unknown;
  statement_section: unknown;
  confidence: unknown;
  notes: unknown;
};

export async function listStoredMonths(
  userId: string
): Promise<MonthSummary[]> {
  const sql = getSql();
  const [monthRows, statementRows, expenseRows] = (await Promise.all([
    sql`
      select month, active_statement_id, saved_at from months
      where user_id = ${userId} order by month
    `,
    sql`select * from statements where user_id = ${userId} order by month, position, id`,
    sql`select * from expenses where user_id = ${userId} order by month, position, id`
  ])) as [MonthRow[], StatementRow[], ExpenseRow[]];

  return listMonths(
    assembleDocuments(monthRows, statementRows, expenseRows)
  );
}

export async function readStoredMonth(
  userId: string,
  month: string
): Promise<MonthDocument | null> {
  if (!isMonthKey(month)) {
    return null;
  }

  try {
    const sql = getSql();
    const [monthRows, statementRows, expenseRows] = (await Promise.all([
      sql`
        select month, active_statement_id, saved_at from months
        where user_id = ${userId} and month = ${month}
      `,
      sql`
        select * from statements
        where user_id = ${userId} and month = ${month} order by position, id
      `,
      sql`
        select * from expenses
        where user_id = ${userId} and month = ${month} order by position, id
      `
    ])) as [MonthRow[], StatementRow[], ExpenseRow[]];

    if (monthRows.length === 0) {
      return null;
    }

    return assembleDocuments(monthRows, statementRows, expenseRows)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whole-document replacement, mirroring the file-per-month behaviour the app
 * was built around. A month left without statements is removed rather than
 * stored, so the stepper never walks an empty month.
 */
export async function writeStoredMonth(
  userId: string,
  document: MonthDocument
): Promise<MonthDocument | null> {
  if (!userId) {
    throw new Error("A month document needs an owner.");
  }

  if (!isMonthKey(document.month)) {
    throw new Error("A month document needs a YYYY-MM month key.");
  }

  if (document.statements.length === 0) {
    await deleteStoredMonth(userId, document.month);

    return null;
  }

  const sql = getSql();
  const { month } = document;
  const selected = new Set(document.selectedIds);

  // Replacing children wholesale keeps the write idempotent and avoids having
  // to diff rows the UI already resolved client-side.
  await sql.transaction([
    sql`
      insert into months (user_id, month, active_statement_id, saved_at)
      values (${userId}, ${month}, ${document.activeStatementId}, ${document.savedAt})
      on conflict (user_id, month) do update
        set active_statement_id = excluded.active_statement_id,
            saved_at = excluded.saved_at
    `,
    sql`delete from statements where user_id = ${userId} and month = ${month}`,
    sql`delete from expenses where user_id = ${userId} and month = ${month}`,
    ...document.statements.map((statement, position) =>
      sql`
        insert into statements (
          user_id, month, id, position, source_file_name, imported_at, month_source,
          institution, account_mask, statement_type, period_start, period_end,
          currency, opening_balance, closing_balance, confidence
        ) values (
          ${userId}, ${month}, ${statement.id}, ${position}, ${statement.sourceFileName},
          ${statement.importedAt}, ${statement.monthSource},
          ${statement.statement.institution}, ${statement.statement.accountMask},
          ${statement.statement.statementType}, ${statement.statement.periodStart},
          ${statement.statement.periodEnd}, ${statement.statement.currency},
          ${statement.statement.openingBalance}, ${statement.statement.closingBalance},
          ${statement.statement.confidence}
        )
      `
    ),
    ...document.expenses.map((expense, position) =>
      sql`
        insert into expenses (
          user_id, month, id, position, statement_id, selected, date, posted_date,
          description, merchant, amount, reimbursed_amount, currency, category,
          subcategory, payment_method, statement_section, confidence, notes
        ) values (
          ${userId}, ${month}, ${expense.id}, ${position}, ${expense.statementId || ""},
          ${selected.has(expense.id)}, ${expense.date}, ${expense.postedDate},
          ${expense.description}, ${expense.merchant}, ${expense.amount},
          ${expense.reimbursedAmount}, ${expense.currency}, ${expense.category},
          ${expense.subcategory}, ${expense.paymentMethod}, ${expense.statementSection},
          ${expense.confidence}, ${expense.notes}
        )
      `
    )
  ]);

  return document;
}

async function deleteStoredMonth(userId: string, month: string) {
  if (!isMonthKey(month)) {
    return;
  }

  // Statements and expenses cascade.
  await getSql()`delete from months where user_id = ${userId} and month = ${month}`;
}

function assembleDocuments(
  monthRows: readonly MonthRow[],
  statementRows: readonly StatementRow[],
  expenseRows: readonly ExpenseRow[]
): MonthDocument[] {
  const statementsByMonth = groupBy(statementRows, (row) => row.month);
  const expensesByMonth = groupBy(expenseRows, (row) => row.month);

  return monthRows.flatMap((monthRow) => {
    const month = monthRow.month;

    if (!isMonthKey(month)) {
      return [];
    }

    const expenses = expensesByMonth.get(month) || [];
    // Rebuilding through parseReviewContents keeps the persisted shape subject
    // to the same normalization as every other entry point.
    const contents = parseReviewContents({
      statements: (statementsByMonth.get(month) || []).map(toReviewStatement),
      expenses: expenses.map(toExpenseItem),
      selectedIds: expenses.filter((row) => row.selected === true).map((row) => row.id),
      activeStatementId: toText(monthRow.active_statement_id)
    });

    return [
      {
        version: MONTH_DOCUMENT_VERSION,
        month,
        ...contents,
        savedAt: toText(monthRow.saved_at)
      } satisfies MonthDocument
    ];
  });
}

function toReviewStatement(row: StatementRow) {
  return {
    id: row.id,
    sourceFileName: toText(row.source_file_name),
    importedAt: toText(row.imported_at),
    monthSource: toText(row.month_source),
    statement: {
      institution: toText(row.institution),
      accountMask: toText(row.account_mask),
      statementType: toText(row.statement_type),
      periodStart: toText(row.period_start),
      periodEnd: toText(row.period_end),
      currency: toText(row.currency),
      openingBalance: toNullableNumber(row.opening_balance),
      closingBalance: toNullableNumber(row.closing_balance),
      confidence: toNumber(row.confidence)
    }
  };
}

function toExpenseItem(row: ExpenseRow) {
  return {
    id: row.id,
    statementId: toText(row.statement_id),
    date: toText(row.date),
    postedDate: toText(row.posted_date),
    description: toText(row.description),
    merchant: toText(row.merchant),
    amount: toNumber(row.amount),
    reimbursedAmount: toNumber(row.reimbursed_amount),
    currency: toText(row.currency),
    category: toText(row.category),
    subcategory: toText(row.subcategory),
    paymentMethod: toText(row.payment_method),
    statementSection: toText(row.statement_section),
    confidence: toNumber(row.confidence),
    notes: toText(row.notes)
  };
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key);

    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  return grouped;
}
