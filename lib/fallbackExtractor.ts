import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  getDefaultCategoryName,
  getEnabledCategoryNames,
} from "@/lib/categories";
import type { ExpenseItem, StatementSummary } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type FallbackExtractionResult = {
  source: "pdftotext-new-charges";
  expenses: ExpenseItem[];
  textLength: number;
};

export async function extractFallbackExpensesFromPdf(
  pdfPath: string,
  statement: StatementSummary,
  categoryNames: readonly string[] = getEnabledCategoryNames(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  )
): Promise<FallbackExtractionResult> {
  const text = await extractPdfText(pdfPath);
  const expenses = extractNewCharges(text, statement, categoryNames);

  return {
    source: "pdftotext-new-charges",
    expenses,
    textLength: text.length
  };
}

async function extractPdfText(pdfPath: string) {
  try {
    const { stdout } = await execFileAsync("pdftotext", [
      "-layout",
      pdfPath,
      "-"
    ]);
    return stdout;
  } catch {
    return "";
  }
}

function extractNewCharges(
  text: string,
  statement: StatementSummary,
  categoryNames: readonly string[]
) {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    line.trim().startsWith("New Charges Details")
  );

  if (startIndex === -1) {
    return [];
  }

  const expenses: ExpenseItem[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === "Fees" || trimmed === "Interest Charged") {
      break;
    }

    const parsed = parseChargeLine(line, statement, categoryNames);
    if (parsed) {
      expenses.push(parsed);
    }
  }

  return expenses;
}

function parseChargeLine(
  line: string,
  statement: StatementSummary,
  categoryNames: readonly string[]
): ExpenseItem | null {
  const match = line.match(
    /^\s*(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s{2,}(Pay Over Time|Pay In Full|Cash Advance).*?\$([0-9,]+\.\d{2})\s*$/
  );

  if (!match) {
    return null;
  }

  const [, rawDate, rawDescription, type, rawAmount] = match;
  const merchant = cleanMerchant(rawDescription);
  const amount = Number(rawAmount.replace(/,/g, ""));
  const date = toIsoDate(rawDate);

  return {
    id: `fallback-${date}-${merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${rawAmount.replace(/[^0-9]/g, "")}`,
    date,
    postedDate: date,
    description: rawDescription.trim(),
    merchant,
    amount,
    currency: statement.currency || "USD",
    category: categorize(rawDescription, categoryNames),
    subcategory: "",
    paymentMethod: "card",
    statementSection: type === "Cash Advance" ? "withdrawal" : "purchase",
    confidence: 0.78,
    notes: "Parsed from statement text fallback"
  };
}

function cleanMerchant(description: string) {
  return description
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function toIsoDate(value: string) {
  const [month, day, year] = value.split("/");
  return `20${year}-${month}-${day}`;
}

function categorize(description: string, categoryNames: readonly string[]) {
  const value = description.toLowerCase();

  if (
    includesAny(value, [
      "youtube",
      "crunchyroll",
      "hulu",
      "netflix",
      "patreon",
      "steam",
      "viz"
    ])
  ) {
    return preferredCategory(categoryNames, [
      "Entertainments",
      "Subscription",
      "Tech",
      "Software"
    ]);
  }

  if (
    includesAny(value, ["adobe", "openai", "notion", "google", "discord"])
  ) {
    return preferredCategory(categoryNames, ["Tech", "Subscription", "Software"]);
  }

  if (includesAny(value, ["uber eats", "tst*", "restaurant", "resy"])) {
    return preferredCategory(categoryNames, ["Food", "Meals"]);
  }

  if (includesAny(value, ["uber trip", "parkmobile", "exxonmobil"])) {
    return preferredCategory(categoryNames, ["Transport", "Travel"]);
  }

  if (includesAny(value, ["amazon", "amzn.com"])) {
    return preferredCategory(categoryNames, ["Shopping", "Supplies", "Office"]);
  }

  if (includesAny(value, ["dds", "dill"])) {
    return preferredCategory(categoryNames, ["Work", "Professional Services"]);
  }

  if (includesAny(value, ["barber", "grooming", "salon", "vapor"])) {
    return preferredCategory(categoryNames, ["Health & Wellness", "Shopping"]);
  }

  return getDefaultCategoryName(categoryNames);
}

function preferredCategory(
  categoryNames: readonly string[],
  preferredNames: readonly string[]
) {
  for (const preferredName of preferredNames) {
    const match = categoryNames.find(
      (categoryName) =>
        categoryName.toLowerCase() === preferredName.toLowerCase()
    );

    if (match) {
      return match;
    }
  }

  return getDefaultCategoryName(categoryNames);
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}
