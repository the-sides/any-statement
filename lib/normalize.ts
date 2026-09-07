import {
  coerceCategoryName,
  getEnabledCategoryNames,
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES
} from "@/lib/categories";
import type {
  ExpenseItem,
  StatementExtraction,
  StatementSummary
} from "@/lib/types";

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function asNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return asNumber(value, 0);
}

function asEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number]
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : fallback;
}

function asConfidence(value: unknown) {
  const number = asNumber(value, 0.7);
  return Math.max(0, Math.min(1, number));
}

export function normalizeExtraction(
  input: unknown,
  options: { categoryNames?: readonly string[] } = {}
): StatementExtraction {
  const categoryNames =
    options.categoryNames ||
    getEnabledCategoryNames(DEFAULT_EXPENSE_CATEGORY_DEFINITIONS);
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const rawStatement =
    record.statement && typeof record.statement === "object"
      ? (record.statement as Record<string, unknown>)
      : {};

  const statement: StatementSummary = {
    institution: asString(rawStatement.institution, "Unknown institution"),
    accountMask: asString(rawStatement.accountMask),
    statementType: asEnum(rawStatement.statementType, STATEMENT_TYPES, "other"),
    periodStart: asString(rawStatement.periodStart),
    periodEnd: asString(rawStatement.periodEnd),
    currency: asString(rawStatement.currency, "USD").toUpperCase(),
    openingBalance: asNullableNumber(rawStatement.openingBalance),
    closingBalance: asNullableNumber(rawStatement.closingBalance),
    confidence: asConfidence(rawStatement.confidence)
  };

  const rawExpenses = Array.isArray(record.expenses) ? record.expenses : [];
  const expenses: ExpenseItem[] = rawExpenses.map((rawExpense, index) => {
    const item =
      rawExpense && typeof rawExpense === "object"
        ? (rawExpense as Record<string, unknown>)
        : {};

    return {
      id: asString(item.id, `item-${index + 1}`),
      date: asString(item.date),
      postedDate: asString(item.postedDate),
      description: asString(item.description),
      merchant: asString(item.merchant),
      amount: Math.abs(asNumber(item.amount, 0)),
      reimbursedAmount: asNumber(item.reimbursedAmount, 0),
      currency: asString(item.currency, statement.currency).toUpperCase(),
      category: coerceCategoryName(item.category, categoryNames),
      subcategory: asString(item.subcategory),
      paymentMethod: asEnum(item.paymentMethod, PAYMENT_METHODS, "unknown"),
      statementSection: asEnum(
        item.statementSection,
        STATEMENT_SECTIONS,
        "other"
      ),
      confidence: asConfidence(item.confidence),
      notes: asString(item.notes)
    };
  });

  // Balance movements are not spending. Card payments settle charges that are
  // already itemized on the card statement, and bank transfers only move money
  // between the user's own accounts. The prompts ask the model to skip these
  // rows; this filter is the backstop when it returns them anyway.
  const excludedSections: ReadonlySet<ExpenseItem["statementSection"]> =
    statement.statementType === "bank"
      ? new Set(["payment", "transfer", "deposit"])
      : statement.statementType === "credit_card"
        ? new Set(["payment"])
        : new Set();
  const filteredExpenses = expenses.filter(
    (expense) => !excludedSections.has(expense.statementSection)
  );

  return { statement, expenses: filteredExpenses };
}
