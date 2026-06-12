import type {
  ExpenseCategory,
  PaymentMethod,
  StatementSection,
  StatementType
} from "@/lib/categories";

export type StatementSummary = {
  institution: string;
  accountMask: string;
  statementType: StatementType;
  periodStart: string;
  periodEnd: string;
  currency: string;
  openingBalance: number | null;
  closingBalance: number | null;
  confidence: number;
};

export type ExpenseItem = {
  id: string;
  date: string;
  postedDate: string;
  description: string;
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  subcategory: string;
  paymentMethod: PaymentMethod;
  statementSection: StatementSection;
  confidence: number;
  notes: string;
};

export type StatementExtraction = {
  statement: StatementSummary;
  expenses: ExpenseItem[];
};

export type SaveExpensesPayload = {
  dataSourceId?: string;
  sourceFileName?: string;
  statement: StatementSummary;
  expenses: ExpenseItem[];
};

export type SaveExpensesResult = {
  saved: number;
  pages: Array<{
    id: string;
    url: string;
  }>;
};
