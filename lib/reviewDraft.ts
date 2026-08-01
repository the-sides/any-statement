import {
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES
} from "@/lib/categories";
import type {
  ExpenseItem,
  SaveStatementSource,
  StatementExtraction,
  StatementSummary
} from "@/lib/types";

export const REVIEW_DRAFT_STORAGE_KEY = "statement-ledger.review-draft";

const REVIEW_DRAFT_VERSION = 2;
const LEGACY_REVIEW_DRAFT_VERSION = 1;

export const STATEMENT_MONTH_SOURCES = ["period", "rows", "manual"] as const;

/** How a statement's month was decided. Empty for statements filed before this. */
export type StatementMonthSource =
  | (typeof STATEMENT_MONTH_SOURCES)[number]
  | "";

export type ReviewStatement = SaveStatementSource & {
  importedAt: string;
  monthSource: StatementMonthSource;
};

export type ReviewContents = {
  statements: ReviewStatement[];
  expenses: ExpenseItem[];
  selectedIds: string[];
  activeStatementId: string;
};

export type ReviewDraft = ReviewContents & {
  version: typeof REVIEW_DRAFT_VERSION;
  savedAt: string;
};

export function createReviewDraft(input: {
  statements: readonly ReviewStatement[];
  expenses: readonly ExpenseItem[];
  selectedIds: Iterable<string>;
  activeStatementId?: string;
}): ReviewDraft {
  return {
    version: REVIEW_DRAFT_VERSION,
    ...normalizeReviewContents(input),
    savedAt: new Date().toISOString()
  };
}

export function normalizeReviewContents(input: {
  statements: readonly ReviewStatement[];
  expenses: readonly ExpenseItem[];
  selectedIds: Iterable<string>;
  activeStatementId?: string;
}): ReviewContents {
  const statements = input.statements.map((statement, index) =>
    normalizeReviewStatement(statement, index)
  );
  const statementIds = new Set(statements.map((statement) => statement.id));
  const fallbackStatementId = statements[0]?.id || "";
  const expenses = input.expenses.flatMap((expense) => {
    const normalized = normalizeExpense(expense, fallbackStatementId);

    if (!normalized) {
      return [];
    }

    if (statementIds.size > 0 && !statementIds.has(normalized.statementId || "")) {
      return [];
    }

    return [normalized];
  });
  const itemIds = new Set(expenses.map((item) => item.id));
  const selectedIds = [...input.selectedIds].filter((id) => itemIds.has(id));
  const activeStatementId = statementIds.has(input.activeStatementId || "")
    ? input.activeStatementId || ""
    : fallbackStatementId;

  return {
    statements,
    expenses,
    selectedIds,
    activeStatementId
  };
}

export function parseReviewContents(value: unknown): ReviewContents {
  const record = asRecord(value);

  if (!record) {
    return {
      statements: [],
      expenses: [],
      selectedIds: [],
      activeStatementId: ""
    };
  }

  const statements = Array.isArray(record.statements)
    ? record.statements.flatMap((statement, index) => {
        const parsed = parseReviewStatement(statement, index);

        return parsed ? [parsed] : [];
      })
    : [];
  const statementIds = new Set(statements.map((statement) => statement.id));
  const fallbackStatementId = statements[0]?.id || "";
  const expenses = Array.isArray(record.expenses)
    ? record.expenses.flatMap((item) => {
        const expense = parseExpense(item, fallbackStatementId);

        if (!expense) {
          return [];
        }

        if (statementIds.size > 0 && !statementIds.has(expense.statementId || "")) {
          return [];
        }

        return [expense];
      })
    : [];
  const itemIds = new Set(expenses.map((item) => item.id));
  const selectedIds = Array.isArray(record.selectedIds)
    ? record.selectedIds.filter(
        (id): id is string => typeof id === "string" && itemIds.has(id)
      )
    : expenses.map((item) => item.id);
  const activeStatementId = statementIds.has(asString(record.activeStatementId))
    ? asString(record.activeStatementId)
    : fallbackStatementId;

  return {
    statements,
    expenses,
    selectedIds,
    activeStatementId
  };
}

export function createReviewStatement(input: {
  id: string;
  statement: StatementSummary;
  sourceFileName: string;
  importedAt?: string;
  monthSource?: StatementMonthSource;
}): ReviewStatement {
  return normalizeReviewStatement(
    {
      id: input.id,
      statement: input.statement,
      sourceFileName: input.sourceFileName,
      importedAt: input.importedAt || new Date().toISOString(),
      monthSource: input.monthSource || ""
    },
    0
  );
}

export function createStatementExpenses(
  statementId: string,
  expenses: readonly ExpenseItem[]
): ExpenseItem[] {
  return expenses.map((expense, index) => ({
    ...expense,
    id: createStatementExpenseId(statementId, expense.id, index),
    statementId
  }));
}

export function statementSourceForSave(
  statement: ReviewStatement
): SaveStatementSource {
  return {
    id: statement.id,
    statement: statement.statement,
    sourceFileName: statement.sourceFileName
  };
}

export function parseReviewDraft(value: unknown): ReviewDraft | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  if (record.version === LEGACY_REVIEW_DRAFT_VERSION) {
    return parseLegacyReviewDraft(record);
  }

  if (record.version !== REVIEW_DRAFT_VERSION) {
    return null;
  }

  return {
    version: REVIEW_DRAFT_VERSION,
    ...parseReviewContents(record),
    savedAt: asString(record.savedAt)
  };
}

function parseLegacyReviewDraft(record: Record<string, unknown>) {
  const extraction = parseExtraction(record.extraction, "");

  if (!extraction) {
    return null;
  }

  const statementId = "statement-1";
  const sourceFileName = asString(record.sourceFileName);
  const statement = createReviewStatement({
    id: statementId,
    statement: extraction.statement,
    sourceFileName,
    importedAt: asString(record.savedAt) || new Date().toISOString()
  });
  const expenses = extraction.expenses.map((expense) => ({
    ...expense,
    statementId
  }));
  const itemIds = new Set(expenses.map((item) => item.id));
  const selectedIds = Array.isArray(record.selectedIds)
    ? record.selectedIds.filter(
        (id): id is string => typeof id === "string" && itemIds.has(id)
      )
    : expenses.map((item) => item.id);

  return createReviewDraft({
    statements: [statement],
    expenses,
    selectedIds,
    activeStatementId: statementId
  });
}

function parseExtraction(
  value: unknown,
  fallbackStatementId: string
): StatementExtraction | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const statement = parseStatement(record.statement);

  if (!statement) {
    return null;
  }

  const expenses = Array.isArray(record.expenses)
    ? record.expenses.flatMap((item) => {
        const expense = parseExpense(item, fallbackStatementId);

        return expense ? [expense] : [];
      })
    : [];

  return {
    statement,
    expenses
  };
}

function parseReviewStatement(
  value: unknown,
  index: number
): ReviewStatement | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const statement = parseStatement(record.statement);

  if (!statement) {
    return null;
  }

  return normalizeReviewStatement(
    {
      id: asString(record.id, `statement-${index + 1}`),
      statement,
      sourceFileName: asString(record.sourceFileName),
      importedAt: asString(record.importedAt),
      monthSource: parseEnum(record.monthSource, STATEMENT_MONTH_SOURCES) || ""
    },
    index
  );
}

function normalizeReviewStatement(
  statement: ReviewStatement,
  index: number
): ReviewStatement {
  return {
    id: statement.id.trim() || `statement-${index + 1}`,
    statement: statement.statement,
    sourceFileName: statement.sourceFileName.trim(),
    importedAt: statement.importedAt || new Date().toISOString(),
    monthSource: statement.monthSource || ""
  };
}

function parseStatement(value: unknown): StatementSummary | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const statementType = parseEnum(record.statementType, STATEMENT_TYPES);
  const openingBalance = parseNullableNumber(record.openingBalance);
  const closingBalance = parseNullableNumber(record.closingBalance);
  const confidence = parseNumber(record.confidence);

  if (!statementType || confidence === null) {
    return null;
  }

  return {
    institution: asString(record.institution),
    accountMask: asString(record.accountMask),
    statementType,
    periodStart: asString(record.periodStart),
    periodEnd: asString(record.periodEnd),
    currency: asString(record.currency, "USD"),
    openingBalance,
    closingBalance,
    confidence
  };
}

function parseExpense(
  value: unknown,
  fallbackStatementId: string
): ExpenseItem | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const expense = normalizeExpense(
    {
      id: asString(record.id),
      statementId: asString(record.statementId, fallbackStatementId),
      date: asString(record.date),
      postedDate: asString(record.postedDate),
      description: asString(record.description),
      merchant: asString(record.merchant),
      amount: parseNumber(record.amount) ?? Number.NaN,
      currency: asString(record.currency, "USD"),
      category: asString(record.category),
      subcategory: asString(record.subcategory),
      paymentMethod: parseEnum(record.paymentMethod, PAYMENT_METHODS) || "unknown",
      statementSection:
        parseEnum(record.statementSection, STATEMENT_SECTIONS) || "purchase",
      confidence: parseNumber(record.confidence) ?? Number.NaN,
      notes: asString(record.notes)
    },
    fallbackStatementId
  );

  return expense;
}

function normalizeExpense(
  expense: ExpenseItem,
  fallbackStatementId: string
): ExpenseItem | null {
  if (
    !expense.id ||
    expense.amount === null ||
    !Number.isFinite(expense.amount) ||
    !PAYMENT_METHODS.includes(expense.paymentMethod) ||
    !STATEMENT_SECTIONS.includes(expense.statementSection) ||
    expense.confidence === null ||
    !Number.isFinite(expense.confidence)
  ) {
    return null;
  }

  return {
    ...expense,
    statementId: expense.statementId || fallbackStatementId
  };
}

function createStatementExpenseId(
  statementId: string,
  expenseId: string,
  index: number
) {
  const sourceId = expenseId.trim() || `row-${index + 1}`;
  const safeSourceId = sourceId.replace(/[^a-zA-Z0-9_-]+/g, "-");

  return `${statementId}-${index + 1}-${safeSourceId}`;
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseNullableNumber(value: unknown) {
  return value === null ? null : parseNumber(value);
}

function parseEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T
) {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : null;
}
