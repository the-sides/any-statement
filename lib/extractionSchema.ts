import {
  EXPENSE_CATEGORIES,
  INCOME_KINDS,
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES
} from "@/lib/categories";

const confidenceSchema = {
  type: "number",
  description: "Confidence score from 0 to 1. Values are clamped after parsing."
} as const;

export function createStatementExtractionSchema(
  categoryNames: readonly string[] = EXPENSE_CATEGORIES
) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["statement", "expenses", "incomes"],
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
          confidence: confidenceSchema
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
            category: { type: "string", enum: categoryNames },
            subcategory: { type: "string" },
            paymentMethod: { type: "string", enum: PAYMENT_METHODS },
            statementSection: { type: "string", enum: STATEMENT_SECTIONS },
            confidence: confidenceSchema,
            notes: { type: "string" }
          }
        }
      },
      incomes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "date",
            "source",
            "amount",
            "currency",
            "kind",
            "confidence",
            "notes"
          ],
          properties: {
            id: { type: "string" },
            date: { type: "string" },
            source: { type: "string" },
            amount: { type: "number" },
            currency: { type: "string" },
            kind: { type: "string", enum: INCOME_KINDS },
            confidence: confidenceSchema,
            notes: { type: "string" }
          }
        }
      }
    }
  } as const;
}

export const statementExtractionSchema = createStatementExtractionSchema();

export function createExtractionResponseFormat(
  categoryNames: readonly string[] = EXPENSE_CATEGORIES
) {
  return {
    type: "json_schema",
    json_schema: {
      name: "statement_expense_extraction",
      strict: true,
      schema: createStatementExtractionSchema(categoryNames)
    }
  } as const;
}

export const extractionResponseFormat = createExtractionResponseFormat();
