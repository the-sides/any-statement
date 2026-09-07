/**
 * Seeds the auth-less demo tenant with three months of synthetic statements.
 *
 *   STATEMENT_LEDGER_DEMO_MODE=1 bun run scripts/seed-demo.ts
 *
 * A headless UI check needs data that is *stable* - the same rows, totals and
 * chart shapes on every run - so nothing here is random and nothing is copied
 * from the real tenant. `writeStoredMonth` replaces a month wholesale, so
 * re-running this is idempotent.
 *
 * The three months are shaped to cover the states the UI renders differently:
 * a saved month, an overspent month (the Sankey riser pours in from the top
 * instead of climbing out of it), and a month with a reimbursed row.
 */
import type { PaymentMethod, StatementSection } from "@/lib/categories";
import { DEMO_USER_ID, isDemoMode } from "@/lib/demoMode";
import { createMonthDocument, summarizeMonthDocument } from "@/lib/months";
import { writeStoredMonth } from "@/lib/monthStore";
import { createReviewStatement } from "@/lib/reviewDraft";
import type { ExpenseItem, IncomeItem, StatementSummary } from "@/lib/types";

if (!isDemoMode()) {
  console.error(
    "Refusing to seed: STATEMENT_LEDGER_DEMO_MODE is not set, so this checkout " +
      "is not a demo build and the demo tenant would be unreachable anyway."
  );
  process.exit(1);
}

type SeedRow = {
  day: number;
  merchant: string;
  description: string;
  amount: number;
  category: string;
  section?: StatementSection;
  method?: PaymentMethod;
  reimbursed?: number;
};

type SeedIncome = {
  day: number;
  source: string;
  amount: number;
  kind: IncomeItem["kind"];
};

type SeedMonth = {
  month: string;
  /** Scales card spending only, so one month lands overspent. */
  cardScale: number;
  paycheck: number;
};

const CARD_ROWS: SeedRow[] = [
  { day: 2, merchant: "Blue Bottle Coffee", description: "BLUE BOTTLE COFFEE #221", amount: 18.4, category: "Meals" },
  { day: 3, merchant: "Vercel", description: "VERCEL PRO SUBSCRIPTION", amount: 20, category: "Software" },
  { day: 4, merchant: "Whole Foods", description: "WHOLEFDS MKT 10233", amount: 164.82, category: "Supplies" },
  { day: 6, merchant: "Delta Air Lines", description: "DELTA AIR 0062318844", amount: 412.6, category: "Travel" },
  { day: 7, merchant: "Marriott Bonvoy", description: "COURTYARD BY MARRIOTT", amount: 289.14, category: "Travel", reimbursed: 289.14 },
  { day: 9, merchant: "Uber", description: "UBER TRIP 8XK2L", amount: 27.35, category: "Travel" },
  { day: 11, merchant: "OpenRouter", description: "OPENROUTER.AI API CREDIT", amount: 45, category: "Software" },
  { day: 12, merchant: "Chipotle", description: "CHIPOTLE 1884", amount: 31.18, category: "Meals" },
  { day: 14, merchant: "Staples", description: "STAPLES 00194 PRINT", amount: 62.9, category: "Office" },
  { day: 16, merchant: "Google Ads", description: "GOOGLE ADS 9922184", amount: 250, category: "Marketing" },
  { day: 18, merchant: "Shell", description: "SHELL OIL 5744102", amount: 58.11, category: "Travel" },
  { day: 21, merchant: "Notion Labs", description: "NOTION TEAM PLAN", amount: 40, category: "Software" },
  { day: 23, merchant: "Trader Joes", description: "TRADER JOES #182", amount: 96.47, category: "Supplies" },
  { day: 25, merchant: "Amex", description: "ANNUAL MEMBERSHIP FEE", amount: 12.5, category: "Bank Fees", section: "fee" },
  { day: 26, merchant: "Sushi Ran", description: "SUSHI RAN SAUSALITO", amount: 128.6, category: "Meals" },
  { day: 28, merchant: "Apple", description: "APPLE STORE ONLINE", amount: 199, category: "Office" }
];

const BANK_ROWS: SeedRow[] = [
  { day: 1, merchant: "Bay Property Group", description: "RENT ACH BAYPROPGRP", amount: 2150, category: "Rent", method: "ach" },
  { day: 5, merchant: "PG&E", description: "PGANDE WEB PAYMENT", amount: 142.68, category: "Utilities", method: "ach" },
  { day: 8, merchant: "Comcast", description: "COMCAST INTERNET AUTOPAY", amount: 89.99, category: "Utilities", method: "ach" },
  { day: 15, merchant: "State Farm", description: "STATE FARM INSURANCE PREM", amount: 173.25, category: "Insurance", method: "ach" },
  { day: 20, merchant: "Wells Fargo", description: "MONTHLY SERVICE FEE", amount: 12, category: "Bank Fees", section: "fee", method: "unknown" }
];

const BANK_INCOMES: SeedIncome[] = [
  { day: 1, source: "Northwind Systems Payroll", amount: 0, kind: "paycheck" },
  { day: 15, source: "Northwind Systems Payroll", amount: 0, kind: "paycheck" },
  { day: 28, source: "Wells Fargo Savings Interest", amount: 4.36, kind: "interest" }
];

const MONTHS: SeedMonth[] = [
  { month: "2026-06", cardScale: 1, paycheck: 3250 },
  { month: "2026-07", cardScale: 0.72, paycheck: 3250 },
  // Overspent: heavy card month against a single paycheck, so net spend clears
  // income and the Sankey renders the overspending riser.
  { month: "2026-08", cardScale: 1.85, paycheck: 2100 }
];

for (const seed of MONTHS) {
  const cardStatement = createReviewStatement({
    id: `demo-${seed.month}-card`,
    sourceFileName: `amex-platinum-${seed.month}.pdf`,
    importedAt: `${seed.month}-05T12:00:00.000Z`,
    monthSource: "period",
    statement: statementSummary({
      institution: "American Express",
      accountMask: "•••• 41007",
      statementType: "credit_card",
      month: seed.month,
      closingBalance: -total(CARD_ROWS, seed.cardScale)
    })
  });

  const bankStatement = createReviewStatement({
    id: `demo-${seed.month}-bank`,
    sourceFileName: `wells-fargo-checking-${seed.month}.pdf`,
    importedAt: `${seed.month}-05T12:05:00.000Z`,
    monthSource: "period",
    statement: statementSummary({
      institution: "Wells Fargo",
      accountMask: "•••• 8842",
      statementType: "bank",
      month: seed.month,
      closingBalance: 5120.44
    })
  });

  const expenses = [
    ...expenseItems(cardStatement.id, seed.month, CARD_ROWS, seed.cardScale, "card"),
    ...expenseItems(bankStatement.id, seed.month, BANK_ROWS, 1, "ach")
  ];

  const incomes = BANK_INCOMES.map((income, index): IncomeItem => ({
    id: `${bankStatement.id}-income-${index + 1}`,
    statementId: bankStatement.id,
    date: dateOf(seed.month, income.day),
    source: income.source,
    amount: income.kind === "paycheck" ? seed.paycheck : income.amount,
    currency: "USD",
    kind: income.kind,
    confidence: 0.97,
    notes: ""
  }));

  const document = createMonthDocument({
    month: seed.month,
    statements: [cardStatement, bankStatement],
    expenses,
    incomes,
    selectedIds: expenses.map((expense) => expense.id),
    activeStatementId: cardStatement.id
  });

  await writeStoredMonth(DEMO_USER_ID, document);

  const summary = summarizeMonthDocument(document);
  console.log(
    `seeded ${summary.month}: ${summary.statementCount} statements, ` +
      `${summary.expenseCount} expenses, $${summary.amount.toFixed(2)} spend, ` +
      `$${incomes.reduce((sum, income) => sum + income.amount, 0).toFixed(2)} income`
  );
}

console.log(`\nDemo tenant ${DEMO_USER_ID} seeded with ${MONTHS.length} month(s).`);

function expenseItems(
  statementId: string,
  month: string,
  rows: readonly SeedRow[],
  scale: number,
  defaultMethod: PaymentMethod
): ExpenseItem[] {
  return rows.map((row, index) => {
    const amount = round(row.amount * scale);

    return {
      id: `${statementId}-${index + 1}`,
      statementId,
      date: dateOf(month, row.day),
      postedDate: dateOf(month, Math.min(row.day + 1, 28)),
      description: row.description,
      merchant: row.merchant,
      amount,
      reimbursedAmount: row.reimbursed ? round(row.reimbursed * scale) : 0,
      currency: "USD",
      category: row.category,
      subcategory: "",
      paymentMethod: row.method || defaultMethod,
      statementSection: row.section || "purchase",
      confidence: 0.95,
      notes: ""
    };
  });
}

function statementSummary(input: {
  institution: string;
  accountMask: string;
  statementType: StatementSummary["statementType"];
  month: string;
  closingBalance: number;
}): StatementSummary {
  return {
    institution: input.institution,
    accountMask: input.accountMask,
    statementType: input.statementType,
    periodStart: dateOf(input.month, 1),
    periodEnd: dateOf(input.month, daysInMonth(input.month)),
    currency: "USD",
    openingBalance: 0,
    closingBalance: round(input.closingBalance),
    confidence: 0.98
  };
}

function total(rows: readonly SeedRow[], scale: number) {
  return rows.reduce((sum, row) => sum + row.amount * scale, 0);
}

function dateOf(month: string, day: number) {
  return `${month}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(month: string) {
  const [year, index] = month.split("-").map(Number);

  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
