import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES
} from "@/lib/categories";

export const statementExtractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["statement", "expenses"],
  properties: {
    statement: {
      type: "object",
      additionalProperties: false,
      required: [
        "institution",
        "accountMask",
        "statementType",
        "periodStart",
        "periodEnd",
        "currency",
        "openingBalance",
        "closingBalance",
        "confidence"
      ],
      properties: {
        institution: { type: "string" },
        accountMask: { type: "string" },
        statementType: { type: "string", enum: STATEMENT_TYPES },
        periodStart: { type: "string" },
        periodEnd: { type: "string" },
        currency: { type: "string" },
        openingBalance: { type: ["number", "null"] },
        closingBalance: { type: ["number", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    expenses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "date",
          "postedDate",
          "description",
          "merchant",
          "amount",
          "currency",
          "category",
          "subcategory",
          "paymentMethod",
          "statementSection",
          "confidence",
          "notes"
        ],
        properties: {
          id: { type: "string" },
          date: { type: "string" },
          postedDate: { type: "string" },
          description: { type: "string" },
          merchant: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          category: { type: "string", enum: EXPENSE_CATEGORIES },
          subcategory: { type: "string" },
          paymentMethod: { type: "string", enum: PAYMENT_METHODS },
          statementSection: { type: "string", enum: STATEMENT_SECTIONS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          notes: { type: "string" }
        }
      }
    }
  }
} as const;

export const extractionResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "statement_expense_extraction",
    strict: true,
    schema: statementExtractionSchema
  }
} as const;
