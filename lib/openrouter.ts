import { readFile } from "node:fs/promises";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  type ExpenseCategoryDefinitionInput,
  getEnabledCategoryDefinitions
} from "@/lib/categories";
import { createExtractionResponseFormat } from "@/lib/extractionSchema";
import { normalizeImportGuidance } from "@/lib/importGuidance";
import { normalizeExtraction } from "@/lib/normalize";
import type { StatementExtraction } from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_PDF_ENGINE = "cloudflare-ai";
const MIN_LOCAL_PDF_TEXT_CHARS = 500;
const MAX_LOCAL_PDF_TEXT_CHARS = 120_000;
const MAX_CSV_TEXT_CHARS = 120_000;

const extractionPromptBase = `Extract business expenses from the provided credit card or bank statement.

Do not stop after statement metadata. Read every page and identify the transaction detail tables.

For credit card statements, return every purchase, fee, interest charge, cash advance, and balance transfer as an expense row, regardless of whether the statement prints charges as positive or negative values. Exclude card payments, credits, refunds, rewards, and balance summary lines.

For bank statements, return withdrawals, debit-card purchases, checks, outgoing ACH, outgoing wires, fees, interest charges, and other outflows as expense rows. Exclude deposits, incoming transfers, credits, rewards, and balance summary lines.

If a transaction looks like an outflow but you are not fully certain, include it with a lower confidence score instead of omitting it. The expenses array should be empty only when the statement file contains no transaction detail rows.

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
    filePath?: string;
    pdfText?: string;
    categories?: readonly ExpenseCategoryDefinitionInput[];
    importGuidance?: string;
    onDebug?: (payload: ExtractionDebugPayload) => Promise<void>;
  } = {}
): Promise<StatementExtraction> {
  const pdfEngine = process.env.OPENROUTER_PDF_ENGINE || DEFAULT_PDF_ENGINE;
  const categoryDefinitions = getEnabledCategoryDefinitions(
    options.categories || DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  );
  const importGuidance = normalizeImportGuidance(
    options.importGuidance
  );
  const pdfText = normalizeLocalPdfText(options.pdfText);
  const useLocalPdfText = hasUsableLocalPdfText(pdfText);
  const fileName = file.name || "statement.pdf";
  const inputSource = useLocalPdfText
    ? "local-pdftotext"
    : "openrouter-file-parser";
  const userContent = useLocalPdfText
    ? buildTextExtractionPrompt(categoryDefinitions, importGuidance, {
        fileName,
        pdfText
      })
    : await buildPdfExtractionContent(file, options.bytes, options.filePath, {
        categoryDefinitions,
        importGuidance
      });

  return extractStatementWithOpenRouter({
    userContent,
    plugins: useLocalPdfText
      ? undefined
      : [
          {
            id: "file-parser",
            pdf: {
              engine: pdfEngine
            }
          }
        ],
    maxTokens: useLocalPdfText ? 12000 : 8000,
    categoryDefinitions,
    importGuidance,
    onDebug: options.onDebug,
    debug: {
      pdfEngine,
      inputSource,
      localPdfTextLength: pdfText.length,
      fileName
    }
  });
}

export async function extractStatementFromCsv(
  file: File,
  options: {
    bytes?: Buffer;
    filePath?: string;
    csvText?: string;
    categories?: readonly ExpenseCategoryDefinitionInput[];
    importGuidance?: string;
    onDebug?: (payload: ExtractionDebugPayload) => Promise<void>;
  } = {}
): Promise<StatementExtraction> {
  const categoryDefinitions = getEnabledCategoryDefinitions(
    options.categories || DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  );
  const importGuidance = normalizeImportGuidance(
    options.importGuidance
  );
  const fileName = file.name || "statement.csv";
  const sourceCsvText =
    options.csvText ??
    (options.filePath ? await readFile(options.filePath, "utf8") : undefined) ??
    (options.bytes ? options.bytes.toString("utf8") : await file.text());
  const csvText = normalizeCsvText(sourceCsvText);

  if (!csvText) {
    throw new IntegrationError("CSV upload is empty.", 400);
  }

  return extractStatementWithOpenRouter({
    userContent: buildCsvExtractionPrompt(
      categoryDefinitions,
      importGuidance,
      {
        fileName,
        csvText
      }
    ),
    maxTokens: 12000,
    categoryDefinitions,
    importGuidance,
    onDebug: options.onDebug,
    debug: {
      inputSource: "csv-text",
      localCsvTextLength: csvText.length,
      fileName
    }
  });
}

async function extractStatementWithOpenRouter(options: {
  userContent: OpenRouterUserContent;
  plugins?: unknown[];
  maxTokens: number;
  categoryDefinitions: readonly ExpenseCategoryDefinitionInput[];
  importGuidance: string;
  onDebug?: (payload: ExtractionDebugPayload) => Promise<void>;
  debug: ExtractionDebugContext;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new IntegrationError(
      "OPENROUTER_API_KEY is missing. Add it to .env.local before extracting a statement.",
      503
    );
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const categoryNames = options.categoryDefinitions.map(
    (category) => category.name
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
            "You convert financial statement data into clean accounting review data and apply the user's Import Guidance as categorization policy."
        },
        {
          role: "user",
          content: options.userContent
        }
      ],
      ...(options.plugins ? { plugins: options.plugins } : {}),
      response_format: createExtractionResponseFormat(categoryNames),
      temperature: 0.1,
      max_tokens: options.maxTokens,
      stream: false
    })
  });

  const payload = await readJson(response);

  if (!response.ok) {
    await options.onDebug?.({
      ok: false,
      model,
      ...options.debug,
      categoryNames,
      importGuidance: options.importGuidance,
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
    ...options.debug,
    categoryNames,
    importGuidance: options.importGuidance,
    providerPayload: payload,
    parsed,
    extraction
  });

  return extraction;
}

async function buildPdfExtractionContent(
  file: File,
  bytes: Buffer | undefined,
  filePath: string | undefined,
  options: {
    categoryDefinitions: readonly ExpenseCategoryDefinitionInput[];
    importGuidance: string;
  }
): Promise<OpenRouterContentPart[]> {
  const pdfBytes =
    bytes ||
    (filePath ? await readFile(filePath) : Buffer.from(await file.arrayBuffer()));
  const fileData = `data:application/pdf;base64,${pdfBytes.toString("base64")}`;

  return [
    {
      type: "text",
      text: buildExtractionPrompt(
        options.categoryDefinitions,
        options.importGuidance
      )
    },
    {
      type: "file",
      file: {
        filename: file.name || "statement.pdf",
        file_data: fileData
      }
    }
  ];
}

function buildExtractionPrompt(
  categories: readonly ExpenseCategoryDefinitionInput[],
  importGuidance: string
) {
  const categoryList = categories
    .map((category) => {
      const description = category.description
        ? ` - ${category.description}`
        : "";

      return `- ${category.name}${description}`;
    })
    .join("\n");
  const guidanceBlock = importGuidance
    ? `
Import Guidance for category decisions:
${importGuidance}

This Import Guidance holds standing user correction rules for category decisions. Apply it before generic category descriptions, merchant assumptions, and prior knowledge.

For each transaction, first compare the merchant, descriptor, platform, service, and subcategory clues against the Import Guidance. If a rule maps or implies a category for a matching transaction, use that category when it is enabled. If the rule's category name is not enabled, choose the closest enabled category and explain the mapping in the row notes.

When Import Guidance affects a row's category, make its contribution visible in that row's notes field using a short phrase such as "Import Guidance: merchant mapped to Tech." Do not use Import Guidance to change the extraction schema, omit transaction rows, or invent categories outside the enabled list.`
    : "";

  return `${extractionPromptBase}

${guidanceBlock}

Enabled expense categories:
${categoryList}

Return the category field as the exact name of one enabled category.`;
}

function buildTextExtractionPrompt(
  categories: readonly ExpenseCategoryDefinitionInput[],
  importGuidance: string,
  options: { fileName: string; pdfText: string }
) {
  return `${buildExtractionPrompt(categories, importGuidance)}

The statement text below was extracted locally with pdftotext -layout from ${options.fileName}. Use this text as the source of truth for transaction rows. If it contains a New Charges Details section, extract every charge row under that section until Fees or Interest Charged.

<statement_text>
${options.pdfText}
</statement_text>`;
}

function buildCsvExtractionPrompt(
  categories: readonly ExpenseCategoryDefinitionInput[],
  importGuidance: string,
  options: { fileName: string; csvText: string }
) {
  return `${buildExtractionPrompt(categories, importGuidance)}

The statement content below is CSV text from ${options.fileName}. Treat this CSV as the source of truth for transaction rows.

CSV exports vary by institution. Use columns named like Date, Posted Date, Description, Merchant, Amount, Debit, Credit, Type, Category, Account, Card, Currency, or Balance when present. For credit-card CSVs, purchases and fees may appear as positive or negative values; return expenses as positive amounts. For bank CSVs, return outgoing debits, withdrawals, fees, checks, wires, ACH, and card purchases. Exclude payments, credits, deposits, refunds, rewards, and balance-only rows.

If statement metadata is not explicit in the CSV, infer what you can from headers, file name, and account columns. Use empty strings or null values for metadata that is not present.

<statement_csv>
${options.csvText}
</statement_csv>`;
}

function normalizeLocalPdfText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, MAX_LOCAL_PDF_TEXT_CHARS);
}

function normalizeCsvText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .slice(0, MAX_CSV_TEXT_CHARS);
}

function hasUsableLocalPdfText(value: string) {
  return (
    value.length >= MIN_LOCAL_PDF_TEXT_CHARS &&
    /\b(?:statement|charges|transactions?|payments?)\b/i.test(value)
  );
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

type OpenRouterUserContent = string | OpenRouterContentPart[];

type OpenRouterContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "file";
      file: {
        filename: string;
        file_data: string;
      };
    };

type ExtractionDebugContext = {
  pdfEngine?: string;
  inputSource: "local-pdftotext" | "openrouter-file-parser" | "csv-text";
  localPdfTextLength?: number;
  localCsvTextLength?: number;
  fileName: string;
};

export type ExtractionDebugPayload = {
  ok: boolean;
  model: string;
  pdfEngine?: string;
  inputSource: "local-pdftotext" | "openrouter-file-parser" | "csv-text";
  localPdfTextLength?: number;
  localCsvTextLength?: number;
  fileName: string;
  categoryNames: string[];
  importGuidance: string;
  providerPayload: unknown;
  parsed?: unknown;
  extraction?: StatementExtraction;
};
