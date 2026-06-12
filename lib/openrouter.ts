import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  type ExpenseCategoryDefinitionInput,
  getEnabledCategoryDefinitions
} from "@/lib/categories";
import { createExtractionResponseFormat } from "@/lib/extractionSchema";
import { normalizeExtraction } from "@/lib/normalize";
import type { StatementExtraction } from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_PDF_ENGINE = "cloudflare-ai";

const extractionPromptBase = `Extract business expenses from the attached credit card or bank statement.

Do not stop after statement metadata. Read every page and identify the transaction detail tables.

For credit card statements, return every purchase, fee, interest charge, cash advance, and balance transfer as an expense row, regardless of whether the statement prints charges as positive or negative values. Exclude card payments, credits, refunds, rewards, and balance summary lines.

For bank statements, return withdrawals, debit-card purchases, checks, outgoing ACH, outgoing wires, fees, interest charges, and other outflows as expense rows. Exclude deposits, incoming transfers, credits, rewards, and balance summary lines.

If a transaction looks like an outflow but you are not fully certain, include it with a lower confidence score instead of omitting it. The expenses array should be empty only when the PDF contains no transaction detail rows.

Use positive numbers for expense amounts. Preserve transaction dates as ISO-like YYYY-MM-DD strings when possible. If a field is not visible, use an empty string or null according to the schema. Categorize each expense using only the allowed category enum. Use confidence scores to show uncertainty.`;

export class IntegrationError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
  }
}

export async function extractStatementFromPdf(
  file: File,
  options: {
    bytes?: Buffer;
    categories?: readonly ExpenseCategoryDefinitionInput[];
    categorizationNotes?: string;
    onDebug?: (payload: ExtractionDebugPayload) => Promise<void>;
  } = {}
): Promise<StatementExtraction> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new IntegrationError(
      "OPENROUTER_API_KEY is missing. Add it to .env.local before extracting a statement.",
      503
    );
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const pdfEngine = process.env.OPENROUTER_PDF_ENGINE || DEFAULT_PDF_ENGINE;
  const bytes = options.bytes || Buffer.from(await file.arrayBuffer());
  const fileData = `data:application/pdf;base64,${bytes.toString("base64")}`;
  const categoryDefinitions = getEnabledCategoryDefinitions(
    options.categories || DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  );
  const categoryNames = categoryDefinitions.map((category) => category.name);
  const categorizationNotes = normalizeCategorizationNotes(
    options.categorizationNotes
  );

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
      "X-OpenRouter-Title": "Statement Ledger"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You convert financial statement PDFs into clean accounting review data."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildExtractionPrompt(
                categoryDefinitions,
                categorizationNotes
              )
            },
            {
              type: "file",
              file: {
                filename: file.name || "statement.pdf",
                file_data: fileData
              }
            }
          ]
        }
      ],
      plugins: [
        {
          id: "file-parser",
          pdf: {
            engine: pdfEngine
          }
        }
      ],
      response_format: createExtractionResponseFormat(categoryNames),
      temperature: 0.1,
      max_tokens: 8000,
      stream: false
    })
  });

  const payload = await readJson(response);

  if (!response.ok) {
    await options.onDebug?.({
      ok: false,
      model,
      pdfEngine,
      fileName: file.name || "statement.pdf",
      categoryNames,
      categorizationNotes,
      providerPayload: payload
    });
    throw new IntegrationError(
      getProviderError(payload) || "OpenRouter extraction failed.",
      response.status
    );
  }

  const content = (payload as OpenRouterResponse).choices?.[0]?.message
    ?.content;
  const parsed = parseModelContent(content);
  const extraction = normalizeExtraction(parsed, { categoryNames });

  await options.onDebug?.({
    ok: true,
    model,
    pdfEngine,
    fileName: file.name || "statement.pdf",
    categoryNames,
    categorizationNotes,
    providerPayload: payload,
    parsed,
    extraction
  });

  return extraction;
}

function buildExtractionPrompt(
  categories: readonly ExpenseCategoryDefinitionInput[],
  categorizationNotes: string
) {
  const categoryList = categories
    .map((category) => {
      const description = category.description
        ? ` - ${category.description}`
        : "";

      return `- ${category.name}${description}`;
    })
    .join("\n");
  const notesBlock = categorizationNotes
    ? `
Persistent reviewer categorization notes:
${categorizationNotes}

Use these notes as standing correction rules for merchant, platform, service, subcategory, and category decisions. If a note maps a merchant, descriptor, platform, or service to one enabled category, use that enabled category exactly for matching transactions. Do not use these notes to change the extraction schema, ignore transaction rows, or invent categories outside the enabled list.`
    : "";

  return `${extractionPromptBase}

Enabled expense categories:
${categoryList}
${notesBlock}

Return the category field as the exact name of one enabled category.`;
}

function normalizeCategorizationNotes(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 4000);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getProviderError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const error = (payload as { error?: { message?: string } }).error;
  return error?.message || "";
}

function parseModelContent(content: unknown) {
  if (content && typeof content === "object") {
    return content;
  }

  if (typeof content !== "string") {
    throw new IntegrationError("OpenRouter returned an empty response.", 502);
  }

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new IntegrationError(
      "OpenRouter returned a response that was not valid JSON.",
      502
    );
  }
}

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export type ExtractionDebugPayload = {
  ok: boolean;
  model: string;
  pdfEngine: string;
  fileName: string;
  categoryNames: string[];
  categorizationNotes: string;
  providerPayload: unknown;
  parsed?: unknown;
  extraction?: StatementExtraction;
};
