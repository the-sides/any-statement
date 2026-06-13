import {
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES
} from "@/lib/categories";
import type { ExpenseItem, StatementExtraction, StatementSummary } from "@/lib/types";

export const REVIEW_DRAFT_STORAGE_KEY = "statement-ledger.review-draft";

const REVIEW_DRAFT_VERSION = 1;

export type ReviewDraft = {
  version: typeof REVIEW_DRAFT_VERSION;
  extraction: StatementExtraction;
  selectedIds: string[];
  sourceFileName: string;
  savedAt: string;
};

export function createReviewDraft(input: {
  extraction: StatementExtraction;
  items: readonly ExpenseItem[];
  selectedIds: Iterable<string>;
  sourceFileName: string;
}): ReviewDraft {
  const items = [...input.items];
  const itemIds = new Set(items.map((item) => item.id));
  const selectedIds = [...input.selectedIds].filter((id) => itemIds.has(id));

  return {
    version: REVIEW_DRAFT_VERSION,
    extraction: {
      ...input.extraction,
      expenses: items
    },
    selectedIds,
    sourceFileName: input.sourceFileName,
    savedAt: new Date().toISOString()
  };
}

export function parseReviewDraft(value: unknown): ReviewDraft | null {
  const record = asRecord(value);

  if (!record || record.version !== REVIEW_DRAFT_VERSION) {
    return null;
  }

  const extraction = parseExtraction(record.extraction);

  if (!extraction) {
    return null;
  }

  const itemIds = new Set(extraction.expenses.map((item) => item.id));
  const selectedIds = Array.isArray(record.selectedIds)
    ? record.selectedIds.filter(
        (id): id is string => typeof id === "string" && itemIds.has(id)
      )
    : extraction.expenses.map((item) => item.id);

  return {
    version: REVIEW_DRAFT_VERSION,
    extraction,
    selectedIds,
    sourceFileName: asString(record.sourceFileName),
    savedAt: asString(record.savedAt)
  };
}

function parseExtraction(value: unknown): StatementExtraction | null {
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
        const expense = parseExpense(item);

        return expense ? [expense] : [];
      })
    : [];

  return {
    statement,
    expenses
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

function parseExpense(value: unknown): ExpenseItem | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const id = asString(record.id);
  const amount = parseNumber(record.amount);
  const paymentMethod = parseEnum(record.paymentMethod, PAYMENT_METHODS);
  const statementSection = parseEnum(
    record.statementSection,
    STATEMENT_SECTIONS
  );
  const confidence = parseNumber(record.confidence);

  if (
    !id ||
    amount === null ||
    !paymentMethod ||
    !statementSection ||
    confidence === null
  ) {
    return null;
  }

  return {
    id,
    date: asString(record.date),
    postedDate: asString(record.postedDate),
    description: asString(record.description),
    merchant: asString(record.merchant),
    amount,
    currency: asString(record.currency, "USD"),
    category: asString(record.category),
    subcategory: asString(record.subcategory),
    paymentMethod,
    statementSection,
    confidence,
    notes: asString(record.notes)
  };
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
