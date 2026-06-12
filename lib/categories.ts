export const EXPENSE_CATEGORIES = [
  "Meals",
  "Travel",
  "Software",
  "Office",
  "Utilities",
  "Bank Fees",
  "Payroll",
  "Rent",
  "Taxes",
  "Insurance",
  "Marketing",
  "Professional Services",
  "Supplies",
  "Transfer",
  "Other"
] as const;

export const PAYMENT_METHODS = [
  "card",
  "ach",
  "wire",
  "check",
  "cash",
  "unknown"
] as const;

export const STATEMENT_SECTIONS = [
  "purchase",
  "payment",
  "fee",
  "interest",
  "transfer",
  "withdrawal",
  "deposit",
  "other"
] as const;

export const STATEMENT_TYPES = ["credit_card", "bank", "other"] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type StatementSection = (typeof STATEMENT_SECTIONS)[number];
export type StatementType = (typeof STATEMENT_TYPES)[number];
