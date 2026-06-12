import { extractionResponseFormat } from "@/lib/extractionSchema";
import { normalizeExtraction } from "@/lib/normalize";
import type { StatementExtraction } from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_PDF_ENGINE = "cloudflare-ai";

const extractionPrompt = `Extract business expenses from the attached credit card or bank statement.

Return only charges, debits, fees, interest, withdrawals, checks, ACH outflows, and transfers that represent money leaving the account. Do not include payments, deposits, rewards, balance summaries, or statement metadata as expenses.

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
  file: File
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
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileData = `data:application/pdf;base64,${bytes.toString("base64")}`;

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
              text: extractionPrompt
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
      response_format: extractionResponseFormat,
      temperature: 0.1,
      max_tokens: 8000,
      stream: false
    })
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw new IntegrationError(
      getProviderError(payload) || "OpenRouter extraction failed.",
      response.status
    );
  }

  const content = (payload as OpenRouterResponse).choices?.[0]?.message
    ?.content;
  const parsed = parseModelContent(content);

  return normalizeExtraction(parsed);
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
