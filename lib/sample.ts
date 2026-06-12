import type { StatementExtraction } from "@/lib/types";

export const sampleExtraction: StatementExtraction = {
  statement: {
    institution: "Northstar Business Card",
    accountMask: "8842",
    statementType: "credit_card",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    currency: "USD",
    openingBalance: 1432.18,
    closingBalance: 2206.77,
    confidence: 0.92
  },
  expenses: [
    {
      id: "sample-1",
      date: "2026-05-03",
      postedDate: "2026-05-04",
      description: "ADOBE CREATIVE CLOUD 800-833-6687 CA",
      merchant: "Adobe",
      amount: 59.99,
      currency: "USD",
      category: "Software",
      subcategory: "Creative tools",
      paymentMethod: "card",
      statementSection: "purchase",
      confidence: 0.96,
      notes: "Recurring software subscription"
    },
    {
      id: "sample-2",
      date: "2026-05-09",
      postedDate: "2026-05-10",
      description: "DELTA AIR 006421771",
      merchant: "Delta Air Lines",
      amount: 418.2,
      currency: "USD",
      category: "Travel",
      subcategory: "Airfare",
      paymentMethod: "card",
      statementSection: "purchase",
      confidence: 0.91,
      notes: ""
    },
    {
      id: "sample-3",
      date: "2026-05-14",
      postedDate: "2026-05-15",
      description: "NOTION LABS INC SAN FRANCISCO CA",
      merchant: "Notion",
      amount: 18,
      currency: "USD",
      category: "Software",
      subcategory: "Workspace",
      paymentMethod: "card",
      statementSection: "purchase",
      confidence: 0.94,
      notes: "Team workspace"
    },
    {
      id: "sample-4",
      date: "2026-05-18",
      postedDate: "2026-05-19",
      description: "WIRE TRANSFER FEE",
      merchant: "Northstar Bank",
      amount: 25,
      currency: "USD",
      category: "Bank Fees",
      subcategory: "Wire fee",
      paymentMethod: "wire",
      statementSection: "fee",
      confidence: 0.89,
      notes: ""
    }
  ]
};
