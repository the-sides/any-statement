import type {
  ExpenseCategory,
  IncomeKind,
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
  statementId?: string;
  date: string;
  postedDate: string;
  description: string;
  merchant: string;
  amount: number;
  reimbursedAmount: number;
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
  incomes: IncomeItem[];
};


export type IncomeItem = {
  id: string;
  statementId?: string;
  date: string;
  source: string;
  amount: number;
  currency: string;
  kind: IncomeKind;
  confidence: number;
  notes: string;
};

export type SaveExpensesPayload = {
  sourceFileName?: string;
  statement?: StatementSummary;
  statements?: SaveStatementSource[];
  expenses: ExpenseItem[];
};

export type SaveStatementSource = {
  id: string;
  statement: StatementSummary;
  sourceFileName: string;
};

export type SaveExpensesResult = {
  saved: number;
  pages: Array<{
    id: string;
    url: string;
  }>;
  unmatchedCategories?: string[];
};
