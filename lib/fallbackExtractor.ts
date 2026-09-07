import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  getDefaultCategoryName,
  getEnabledCategoryNames,
} from "@/lib/categories";
import { extractPdfText } from "@/lib/pdfText";
import type { ExpenseItem, StatementSummary } from "@/lib/types";

export type FallbackExtractionResult = {
  source: "pdftotext-new-charges";
  expenses: ExpenseItem[];
  textLength: number;
};

type CategorizationNoteRule = {
  term: string;
  category: string;
};

type CategoryResolution = {
  category: string;
  note?: string;
};

export async function extractFallbackExpensesFromPdf(
  pdfPath: string,
  statement: StatementSummary,
  categoryNames: readonly string[] = getEnabledCategoryNames(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  ),
  options: { categorizationNotes?: string } = {}
): Promise<FallbackExtractionResult> {
  const text = await extractPdfText(pdfPath);
  const noteRules = parseCategorizationNoteRules(
    options.categorizationNotes || "",
    categoryNames
  );
  const expenses = extractNewCharges(text, statement, categoryNames, noteRules);

  return {
    source: "pdftotext-new-charges",
    expenses,
    textLength: text.length
  };
}

function extractNewCharges(
  text: string,
  statement: StatementSummary,
  categoryNames: readonly string[],
  noteRules: readonly CategorizationNoteRule[]
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

    const parsed = parseChargeLine(line, statement, categoryNames, noteRules);
    if (parsed) {
      expenses.push(parsed);
    }
  }

  return expenses;
}

function parseChargeLine(
  line: string,
  statement: StatementSummary,
  categoryNames: readonly string[],
  noteRules: readonly CategorizationNoteRule[]
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
  const category = categorize(rawDescription, categoryNames, noteRules);

  return {
    id: `fallback-${date}-${merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${rawAmount.replace(/[^0-9]/g, "")}`,
    date,
    postedDate: date,
    description: rawDescription.trim(),
    merchant,
    amount,
    reimbursedAmount: 0,
    currency: statement.currency || "USD",
    category: category.category,
    subcategory: "",
    paymentMethod: "card",
    statementSection: type === "Cash Advance" ? "withdrawal" : "purchase",
    confidence: 0.78,
    notes: category.note
      ? `Parsed from statement text fallback. ${category.note}`
      : "Parsed from statement text fallback"
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

function categorize(
  description: string,
  categoryNames: readonly string[],
  noteRules: readonly CategorizationNoteRule[]
): CategoryResolution {
  const value = description.toLowerCase();
  const noteCategory = categoryFromNotes(description, noteRules);

  if (noteCategory) {
    return {
      category: noteCategory.category,
      note: `AI Notes: ${noteCategory.term} mapped to ${noteCategory.category}.`
    };
  }

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
    return {
      category: preferredCategory(categoryNames, [
        "Entertainments",
        "Subscription",
        "Tech",
        "Software"
      ])
    };
  }

  if (
    includesAny(value, ["adobe", "openai", "notion", "google", "discord"])
  ) {
    return {
      category: preferredCategory(categoryNames, [
        "Tech",
        "Subscription",
        "Software"
      ])
    };
  }

  if (includesAny(value, ["uber eats", "tst*", "restaurant", "resy"])) {
    return { category: preferredCategory(categoryNames, ["Food", "Meals"]) };
  }

  if (
    includesAny(value, [
      "food city",
      "grocery",
      "supermarket",
      "whole foods",
      "trader joe",
      "kroger",
      "publix",
      "safeway",
      "aldi",
      "instacart"
    ])
  ) {
    return {
      category: preferredCategory(categoryNames, [
        "Food",
        "Groceries",
        "Meals",
        "Shopping",
        "Supplies"
      ])
    };
  }

  if (includesAny(value, ["uber trip", "parkmobile", "exxonmobil"])) {
    return {
      category: preferredCategory(categoryNames, ["Transport", "Travel"])
    };
  }

  if (includesAny(value, ["amazon", "amzn.com"])) {
    return {
      category: preferredCategory(categoryNames, [
        "Shopping",
        "Supplies",
        "Office"
      ])
    };
  }

  if (includesAny(value, ["dds", "dill"])) {
    return {
      category: preferredCategory(categoryNames, [
        "Work",
        "Professional Services"
      ])
    };
  }

  if (includesAny(value, ["barber", "grooming", "salon", "vapor"])) {
    return {
      category: preferredCategory(categoryNames, [
        "Health & Wellness",
        "Shopping"
      ])
    };
  }

  return { category: getDefaultCategoryName(categoryNames) };
}

export function categorizeFallbackDescription(
  description: string,
  categoryNames: readonly string[],
  categorizationNotes = ""
) {
  return categorize(
    description,
    categoryNames,
    parseCategorizationNoteRules(categorizationNotes, categoryNames)
  );
}

function categoryFromNotes(
  description: string,
  noteRules: readonly CategorizationNoteRule[]
) {
  const normalizedDescription = normalizeRuleText(description);

  return noteRules.find((rule) =>
    normalizedDescription.includes(normalizeRuleText(rule.term))
  );
}

function parseCategorizationNoteRules(
  notes: string,
  categoryNames: readonly string[]
): CategorizationNoteRule[] {
  return notes
    .split(/\r?\n/)
    .flatMap((line) => rulesFromNoteLine(line, categoryNames));
}

function rulesFromNoteLine(
  line: string,
  categoryNames: readonly string[]
): CategorizationNoteRule[] {
  const normalizedLine = line.trim().replace(/[.]+$/g, "");

  if (!normalizedLine || /\b(?:avoid|do not|don't|not to use)\b/i.test(normalizedLine)) {
    return [];
  }

  const mapping =
    normalizedLine.match(/^(.+?)\s+.*?\btherefore\s+(?:is|are)\s+(.+)$/i) ||
    normalizedLine.match(/^(.+?)\s+(?:is|are)\s+also\s+(.+)$/i) ||
    normalizedLine.match(/^(.+?)\s+(?:is|are)\s+(.+)$/i);

  if (!mapping) {
    return [];
  }

  const [, rawTerms, rawCategory] = mapping;
  const category = matchCategoryName(rawCategory, categoryNames);

  if (!category) {
    return [];
  }

  return rawTerms
    .split(/\s+(?:and|or)\s+|[,/]/i)
    .map((term) => term.trim())
    .filter((term) => normalizeRuleText(term).length >= 3)
    .map((term) => ({
      term,
      category
    }));
}

function matchCategoryName(
  value: string,
  categoryNames: readonly string[]
) {
  const normalizedValue = normalizeRuleText(value);

  return categoryNames.find((categoryName) => {
    const normalizedCategory = normalizeRuleText(categoryName);

    return (
      normalizedCategory === normalizedValue ||
      normalizedCategory === `${normalizedValue}s` ||
      `${normalizedCategory}s` === normalizedValue
    );
  });
}

function normalizeRuleText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
