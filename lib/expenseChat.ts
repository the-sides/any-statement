import type { CashFlowSummary } from "@/lib/cashFlowPlan";
import {
  MAX_CATEGORY_DESCRIPTION_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  normalizeCategoryName,
  type ExpenseCategoryDefinition
} from "@/lib/categories";
import {
  EXPENSE_EDIT_FIELDS,
  type CategoryProposal,
  type ExpenseChatEdit,
  type ExpenseEditField
} from "@/lib/expenseEdits";
import type {
  ExpenseItem,
  SaveStatementSource,
  StatementSummary
} from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const MAX_QUESTION_LENGTH = 1200;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_LENGTH = 1600;
const MAX_CONTEXT_ROWS = 400;
const MAX_TOP_GROUPS = 20;
/** A single answer that rewrites more rows than this is a mistake, not a plan. */
const MAX_EDITS = 200;
/**
 * A reply that invents more categories than this is reorganising the catalog
 * rather than answering, and the reviewer would be approving cards blind.
 */
const MAX_NEW_CATEGORIES = 12;

export type ExpenseChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Chat sees every filed row, not just the month on screen, so each row has to
 * carry the month document it belongs to: that is the only way an approved
 * edit can be written back to the right document.
 */
export type ExpenseChatRow = ExpenseItem & { month: string };

export type ExpenseChatView = {
  scope: "month" | "all";
  activeMonth: string;
};

export type ExpenseChatInput = {
  question: string;
  expenses: readonly ExpenseChatRow[];
  statements?: readonly SaveStatementSource[];
  selectedExpenseIds?: readonly string[];
  cashFlowSummary?: CashFlowSummary;
  history?: readonly ExpenseChatMessage[];
  view?: ExpenseChatView;
  /**
   * Names the model may put in a `category` edit. A category it proposes in
   * the same reply counts too, so "make a Pets category and move these rows"
   * is one answer rather than two round trips.
   */
  categoryNames?: readonly string[];
  /**
   * The whole catalog - names, descriptions, sources, and the disabled ones -
   * so the model can tell what an existing category is *for* before deciding a
   * row does not fit any of them. Names alone made every near-duplicate look
   * plausible. It is also the dedupe list for a proposed category: repeating a
   * disabled name would 409 on create, and disabled ones come back by ticking
   * them, not by adding a second copy.
   */
  categories?: readonly ExpenseCategoryDefinition[];
};

export type ExpenseChatAnswer = {
  answer: string;
  edits: ExpenseChatEdit[];
  /** Categories to create, awaiting the same approval as a row edit. */
  categories: CategoryProposal[];
  model: string;
  context: {
    rowCount: number;
    selectedRowCount: number;
    totalSpend: number;
    truncated: boolean;
  };
};

export class ExpenseChatError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ExpenseChatError";
    this.status = status;
  }
}

export async function answerExpenseQuestion(
  input: ExpenseChatInput
): Promise<ExpenseChatAnswer> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new ExpenseChatError(
      "OPENROUTER_API_KEY is missing. Add it to .env.local before using expense chat.",
      503
    );
  }

  const question = normalizeQuestion(input.question);
  if (!question) {
    throw new ExpenseChatError("Ask a question about the current expense rows.", 400);
  }

  if (input.expenses.length === 0) {
    throw new ExpenseChatError("Add expense rows before using expense chat.", 400);
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const prompt = buildExpenseChatPrompt({
    ...input,
    question
  });

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
            "You are an expense-analysis assistant inside Statement Ledger. Use only the supplied expense rows, statement metadata, cash-flow summary, and conversation transcript. Do not invent transactions, balances, vendors, or external facts. When useful, cite exact category or merchant totals from the context. Keep advice concrete and practical, and say when the rows are insufficient. You may also propose row edits and new categories, which are suggestions a human approves or rejects; never claim either has been applied."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: EXPENSE_CHAT_RESPONSE_FORMAT,
      temperature: 0.2,
      max_tokens: 2000,
      stream: false
    })
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw new ExpenseChatError(
      getProviderError(payload) || "OpenRouter expense chat failed.",
      response.status
    );
  }

  const parsed = parseChatReply(
    (payload as OpenRouterChatResponse).choices?.[0]?.message?.content
  );

  const categories = resolveExpenseChatCategories({
    categories: parsed.categories,
    existingCategoryNames: catalogNames(input)
  });

  return {
    answer: parsed.answer,
    edits: resolveExpenseChatEdits({
      rows: input.expenses,
      edits: parsed.edits,
      // A category proposed in this same reply is a legal edit target: the
      // reviewer approves the category card first, and dropping the moves
      // that motivated it would make the proposal pointless.
      categoryNames: [
        ...(input.categoryNames || []),
        ...categories.map((category) => category.name)
      ]
    }),
    categories,
    model,
    context: summarizeChatContext(input)
  };
}

export const EXPENSE_CHAT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "expense_chat_reply",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "edits", "newCategories"],
      properties: {
        answer: {
          type: "string",
          description: "Markdown-free prose answer for the reviewer."
        },
        edits: {
          type: "array",
          description:
            "Proposed row changes awaiting human approval. Empty when the question does not call for edits.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["expenseId", "field", "value", "reason"],
            properties: {
              expenseId: {
                type: "string",
                description: "The exact id= value of the row being changed."
              },
              field: {
                type: "string",
                enum: [...EXPENSE_EDIT_FIELDS]
              },
              value: {
                type: "string",
                description:
                  "New value. Amounts are plain numbers such as 12.34. Categories must be one of the allowed category names or a name from newCategories in this same reply."
              },
              reason: {
                type: "string",
                description: "One short sentence justifying the change."
              }
            }
          }
        },
        newCategories: {
          type: "array",
          description:
            "Categories to add to the catalog, awaiting human approval. Empty unless the rows genuinely do not fit an existing category.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "description", "reason"],
            properties: {
              name: {
                type: "string",
                description:
                  "Short category name, not matching any existing category."
              },
              description: {
                type: "string",
                description: "One line naming what belongs in it."
              },
              reason: {
                type: "string",
                description:
                  "One short sentence on why the existing categories do not cover these rows."
              }
            }
          }
        }
      }
    }
  }
} as const;

export function buildExpenseChatPrompt(input: ExpenseChatInput) {
  const selectedIds = new Set(input.selectedExpenseIds || []);
  const totalSpend = sumExpenses(input.expenses);
  const selectedSpend = sumExpenses(
    input.expenses.filter((expense) => selectedIds.has(expense.id))
  );
  const view = input.view;
  const rows = rowsForPrompt(input.expenses, view?.activeMonth || "");
  const truncated = rows.length < input.expenses.length;
  const currency = input.expenses[0]?.currency || "USD";
  const statementNames = new Map(
    (input.statements || []).map((statement) => [
      statement.id,
      formatStatementLabel(statement.statement, statement.sourceFileName)
    ])
  );

  return [
    "Current review context:",
    `- Expense rows across every filed month: ${input.expenses.length}`,
    `- Selected rows: ${selectedIds.size}`,
    `- Total reviewed spend: ${formatAmount(totalSpend, currency)}`,
    selectedIds.size > 0
      ? `- Selected-row spend: ${formatAmount(selectedSpend, currency)}`
      : "- Selected-row spend: none selected",
    truncated
      ? `- Row detail below is limited to ${rows.length} rows, prioritising the month on screen and then the largest amounts. Category, merchant, and month summaries include all rows.`
      : "- Row detail includes all rows.",
    "",
    "Current view:",
    formatView(view),
    "",
    "Months:",
    formatMonthTotals(input.expenses),
    "",
    "Statements:",
    formatStatements(input.statements),
    "",
    "Cash-flow summary:",
    formatCashFlowSummary(input.cashFlowSummary, currency),
    "",
    "Category totals:",
    formatGroupTotals(groupExpenses(input.expenses, (expense) => expense.category)),
    "",
    "Merchant totals:",
    formatGroupTotals(
      groupExpenses(input.expenses, (expense) =>
        expense.merchant.trim() || expense.description.trim() || "Unknown"
      )
    ),
    "",
    "Category catalog (every category, disabled ones included):",
    formatCategoryCatalog(input),
    "",
    "Allowed category names for a category edit:",
    formatCategoryNames(input.categoryNames),
    "",
    "Expense rows:",
    rows
      .map((expense, index) =>
        formatExpenseRow(index + 1, expense, {
          selected: selectedIds.has(expense.id),
          statementName: statementNames.get(expense.statementId || "") || ""
        })
      )
      .join("\n"),
    "",
    "Conversation so far:",
    formatHistory(input.history),
    "",
    `Current question: ${normalizeQuestion(input.question)}`,
    "",
    "Answer with the most relevant totals, vendors, categories, and next actions. For cost-reduction questions, rank the highest-leverage reductions first. When asked what the categories are, read them off the category catalog above, including each one's description and whether it is disabled.",
    "",
    "Editing rules:",
    `- Return edits only when the question asks for a change. Fields you may edit: ${EXPENSE_EDIT_FIELDS.join(", ")}.`,
    "- Every edit is a suggestion the reviewer approves or rejects. Nothing is written until they do, so describe them as proposals.",
    "- Use the exact id= value of a row. An id that is not listed above is dropped.",
    "- category must be copied exactly from the allowed category names, or from a name you propose in newCategories in this same reply.",
    "- amount and reimbursedAmount are plain non-negative numbers, no currency symbols.",
    "- Rows outside the month on screen are editable too, but if the request could mean either the current view or every month, return no edits and ask which one they mean.",
    "",
    "Category rules:",
    "- Propose a new category only when rows genuinely do not fit an existing one, or the reviewer asks for one. Prefer an existing name over a near-duplicate.",
    `- A proposed name must not match any name in the category catalog above, disabled ones included, and is limited to ${MAX_CATEGORY_NAME_LENGTH} characters.`,
    "- A new category is also a proposal: the reviewer approves it before anything is created, so never say a category now exists.",
    "- When a new category is worth proposing, also propose the category edits that move the rows into it."
  ].join("\n");
}

/**
 * Same contract as the row edits: anything the reviewer could not safely
 * approve - a blank or over-long name, a duplicate of a catalog entry the
 * create route would reject with a 409, a repeat within one reply - is dropped
 * before a card is ever shown.
 */
export function resolveExpenseChatCategories(input: {
  categories: unknown;
  existingCategoryNames?: readonly string[];
}): CategoryProposal[] {
  if (!Array.isArray(input.categories)) {
    return [];
  }

  const taken = new Set(
    (input.existingCategoryNames || []).map((name) =>
      normalizeCategoryName(name).toLowerCase()
    )
  );
  const resolved: CategoryProposal[] = [];

  for (const raw of input.categories) {
    if (resolved.length >= MAX_NEW_CATEGORIES) {
      break;
    }

    if (!raw || typeof raw !== "object") {
      continue;
    }

    // Model output: an object of unknown fields, each checked below.
    const candidate = raw as Record<string, unknown>;
    const name =
      typeof candidate.name === "string"
        ? normalizeCategoryName(candidate.name)
        : "";
    const key = name.toLowerCase();

    if (!name || name.length > MAX_CATEGORY_NAME_LENGTH || taken.has(key)) {
      continue;
    }

    taken.add(key);
    resolved.push({
      id: `category:${key}`,
      name,
      description:
        typeof candidate.description === "string"
          ? sanitizeInline(candidate.description).slice(
              0,
              MAX_CATEGORY_DESCRIPTION_LENGTH
            )
          : "",
      reason:
        typeof candidate.reason === "string"
          ? sanitizeInline(candidate.reason).slice(0, 240)
          : ""
    });
  }

  return resolved;
}

/**
 * Drops anything the model got wrong - unknown row ids, unknown categories,
 * unparseable amounts, no-op changes - rather than handing the reviewer an
 * approval button that would corrupt a row.
 */
export function resolveExpenseChatEdits(input: {
  rows: readonly ExpenseChatRow[];
  edits: unknown;
  categoryNames?: readonly string[];
}): ExpenseChatEdit[] {
  if (!Array.isArray(input.edits)) {
    return [];
  }

  const rowsById = new Map(input.rows.map((row) => [row.id, row]));
  const categoryByKey = new Map(
    (input.categoryNames || []).map((name) => [name.trim().toLowerCase(), name])
  );
  const seen = new Set<string>();
  const resolved: ExpenseChatEdit[] = [];

  for (const raw of input.edits) {
    if (resolved.length >= MAX_EDITS) {
      break;
    }

    if (!raw || typeof raw !== "object") {
      continue;
    }

    // Model output: an object of unknown fields, each checked below.
    const candidate = raw as Record<string, unknown>;
    const field = EXPENSE_EDIT_FIELDS.find(
      (name) => name === candidate.field
    );
    const row =
      typeof candidate.expenseId === "string"
        ? rowsById.get(candidate.expenseId)
        : undefined;

    if (!field || !row || typeof candidate.value !== "string") {
      continue;
    }

    const id = `${row.id}:${field}`;

    if (seen.has(id)) {
      continue;
    }

    const after = resolveEditValue(field, candidate.value, categoryByKey);

    if (after === null || after === row[field]) {
      continue;
    }

    seen.add(id);
    resolved.push({
      id,
      expenseId: row.id,
      month: row.month,
      field,
      before: row[field],
      after,
      rowLabel:
        sanitizeInline(row.merchant) || sanitizeInline(row.description) || "Row",
      date: row.date || "",
      currency: row.currency || "USD",
      reason:
        typeof candidate.reason === "string"
          ? sanitizeInline(candidate.reason).slice(0, 240)
          : ""
    });
  }

  return resolved;
}

function resolveEditValue(
  field: ExpenseEditField,
  value: string,
  categoryByKey: Map<string, string>
): string | number | null {
  if (field === "amount" || field === "reimbursedAmount") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));

    return Number.isFinite(parsed) && parsed >= 0
      ? Math.round(parsed * 100) / 100
      : null;
  }

  const text = sanitizeInline(value);

  if (field === "category") {
    // An unknown category name would render a category the catalog cannot
    // filter or save, so it is dropped rather than invented.
    return categoryByKey.size === 0
      ? text || null
      : categoryByKey.get(text.toLowerCase()) || null;
  }

  return text;
}

function summarizeChatContext(input: ExpenseChatInput) {
  const selectedIds = new Set(input.selectedExpenseIds || []);

  return {
    rowCount: input.expenses.length,
    selectedRowCount: selectedIds.size,
    totalSpend: sumExpenses(input.expenses),
    truncated: input.expenses.length > MAX_CONTEXT_ROWS
  };
}

function normalizeQuestion(value: unknown) {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_QUESTION_LENGTH)
    : "";
}

/**
 * The month on screen is what a question is usually about, so its rows are
 * kept whole before the budget is spent on the largest rows elsewhere.
 */
function rowsForPrompt(
  expenses: readonly ExpenseChatRow[],
  activeMonth: string
) {
  if (expenses.length <= MAX_CONTEXT_ROWS) {
    return expenses;
  }

  const active = activeMonth
    ? expenses.filter((expense) => expense.month === activeMonth)
    : [];
  const rest = [...expenses]
    .filter((expense) => !activeMonth || expense.month !== activeMonth)
    .sort((left, right) => right.amount - left.amount);

  return [...active, ...rest].slice(0, MAX_CONTEXT_ROWS);
}

function formatView(view: ExpenseChatView | undefined) {
  if (!view) {
    return "- Unknown";
  }

  return view.scope === "all"
    ? "- The reviewer is looking at the all-months view: every filed month at once."
    : `- The reviewer is looking at one month: ${view.activeMonth || "none selected"}.`;
}

function formatMonthTotals(expenses: readonly ExpenseChatRow[]) {
  const totals = new Map<string, { amount: number; count: number; currency: string }>();

  for (const expense of expenses) {
    const current = totals.get(expense.month) || {
      amount: 0,
      count: 0,
      currency: expense.currency || "USD"
    };

    current.amount += expense.amount > 0 ? expense.amount : 0;
    current.count += 1;
    totals.set(expense.month, current);
  }

  if (totals.size === 0) {
    return "- None";
  }

  return [...totals.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(
      ([month, total]) =>
        `- ${month}: ${formatAmount(total.amount, total.currency)} across ${
          total.count
        } ${total.count === 1 ? "row" : "rows"}`
    )
    .join("\n");
}

function formatCategoryNames(names: readonly string[] | undefined) {
  return names?.length ? names.map((name) => `- ${name}`).join("\n") : "- Any";
}

/**
 * Every name in the catalog, falling back to the allowed names when a caller
 * supplies no catalog. Callers on the fallback path can only de-duplicate
 * against what they know, which is better than proposing a name that exists.
 */
function catalogNames(input: ExpenseChatInput) {
  return input.categories?.length
    ? input.categories.map((category) => category.name)
    : input.categoryNames;
}

/**
 * A name alone does not say what belongs in a category, so every near-miss
 * looked like grounds for a new one. Description, source, and whether the
 * category is currently selectable are what make "this row does not fit
 * anything here" a judgement rather than a guess.
 */
function formatCategoryCatalog(input: ExpenseChatInput) {
  const categories = input.categories;

  if (!categories?.length) {
    return formatCategoryNames(input.categoryNames);
  }

  const allowed = new Set(
    (input.categoryNames || []).map((name) => name.toLowerCase())
  );

  return categories
    .map((category) => {
      const state = allowed.has(category.name.toLowerCase())
        ? "selectable"
        : category.enabled
          ? "enabled but hidden in this view"
          : "disabled";
      const description = sanitizeInline(category.description || "");

      return `- ${category.name} [${category.source}, ${state}]${
        description ? `: ${description}` : ""
      }`;
    })
    .join("\n");
}

function formatStatements(statements: readonly SaveStatementSource[] | undefined) {
  if (!statements?.length) {
    return "- None supplied";
  }

  return statements
    .map(
      (statement) =>
        `- ${statement.id}: ${formatStatementLabel(
          statement.statement,
          statement.sourceFileName
        )}`
    )
    .join("\n");
}

function formatStatementLabel(statement: StatementSummary, sourceFileName: string) {
  return [
    statement.institution || sourceFileName || "Statement",
    statement.accountMask ? `acct ${statement.accountMask}` : "",
    [statement.periodStart, statement.periodEnd].filter(Boolean).join(" to ")
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatCashFlowSummary(
  summary: CashFlowSummary | undefined,
  currency: string
) {
  if (!summary) {
    return "- None supplied";
  }

  const allocations = summary.allocations
    .slice(0, MAX_TOP_GROUPS)
    .map(
      (allocation) =>
        `  - ${allocation.label}: ${formatAmount(
          allocation.amount,
          currency
        )} (${allocation.percent.toFixed(1)}%)`
    )
    .join("\n");

  return [
    `- Income: ${formatAmount(summary.incomeTotal, currency)}`,
    `- Manual outputs: ${formatAmount(summary.manualOutputTotal, currency)}`,
    `- Statement category spend: ${formatAmount(
      summary.categorySpendTotal,
      currency
    )}`,
    `- Saved or overspent: ${formatAmount(summary.savedAmount, currency)}`,
    allocations ? `- Allocations:\n${allocations}` : "- Allocations: none"
  ].join("\n");
}

function formatGroupTotals(groups: ExpenseGroup[]) {
  if (groups.length === 0) {
    return "- None";
  }

  return groups
    .slice(0, MAX_TOP_GROUPS)
    .map(
      (group) =>
        `- ${group.label}: ${formatAmount(group.amount, group.currency)} across ${
          group.count
        } ${group.count === 1 ? "row" : "rows"}`
    )
    .join("\n");
}

function formatExpenseRow(
  index: number,
  expense: ExpenseChatRow,
  options: { selected: boolean; statementName: string }
) {
  return [
    `${index}.`,
    `id=${expense.id}`,
    `month=${expense.month}`,
    options.selected ? "[selected]" : "[not selected]",
    expense.date || "no date",
    options.statementName ? `statement=${sanitizeInline(options.statementName)}` : "",
    `merchant=${sanitizeInline(expense.merchant || "Unknown")}`,
    `description=${sanitizeInline(expense.description || "")}`,
    `amount=${formatAmount(expense.amount, expense.currency)}`,
    expense.reimbursedAmount > 0
      ? `reimbursed=${formatAmount(expense.reimbursedAmount, expense.currency)}`
      : "",
    `category=${sanitizeInline(expense.category || "Other")}`,
    expense.subcategory ? `subcategory=${sanitizeInline(expense.subcategory)}` : "",
    expense.notes ? `notes=${sanitizeInline(expense.notes)}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function formatHistory(history: readonly ExpenseChatMessage[] | undefined) {
  const messages = (history || [])
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.content.trim()
    )
    .slice(-MAX_HISTORY_MESSAGES);

  if (messages.length === 0) {
    return "- None";
  }

  return messages
    .map(
      (message) =>
        `- ${message.role}: ${sanitizeInline(
          message.content.slice(0, MAX_HISTORY_MESSAGE_LENGTH)
        )}`
    )
    .join("\n");
}

type ExpenseGroup = {
  label: string;
  amount: number;
  count: number;
  currency: string;
};

function groupExpenses(
  expenses: readonly ExpenseItem[],
  labelForExpense: (expense: ExpenseItem) => string
) {
  const groups = new Map<string, ExpenseGroup>();

  for (const expense of expenses) {
    if (expense.amount <= 0) {
      continue;
    }

    const label = sanitizeInline(labelForExpense(expense)) || "Unknown";
    const key = label.toLowerCase();
    const current = groups.get(key) || {
      label,
      amount: 0,
      count: 0,
      currency: expense.currency || "USD"
    };

    current.amount += expense.amount;
    current.count += 1;
    groups.set(key, current);
  }

  return [...groups.values()].sort((left, right) => right.amount - left.amount);
}

function sumExpenses(expenses: readonly ExpenseItem[]) {
  return expenses.reduce(
    (sum, expense) => sum + (expense.amount > 0 ? expense.amount : 0),
    0
  );
}

function formatAmount(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD"
    }).format(value);
  } catch {
    return `${currency || "USD"} ${value.toFixed(2)}`;
  }
}

function sanitizeInline(value: string) {
  return value.replace(/\s+/g, " ").trim();
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

/**
 * The reply is asked for as JSON, but a provider that ignores the schema still
 * has a usable answer in it, so unparseable content degrades to plain prose
 * with no edits or categories instead of failing the whole question.
 */
function parseChatReply(content: unknown): {
  answer: string;
  edits: unknown;
  categories: unknown;
} {
  const text = parseChatContent(content);
  const json = parseJsonObject(text);

  if (!json) {
    return { answer: text, edits: [], categories: [] };
  }

  const answer =
    typeof json.answer === "string" && json.answer.trim()
      ? json.answer.trim()
      : text;

  return { answer, edits: json.edits, categories: json.newCategories };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  if (!candidate.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseChatContent(content: unknown) {
  if (typeof content === "string") {
    const cleaned = content.trim();

    if (cleaned) {
      return cleaned;
    }
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }

        const textPart = part as { text?: unknown; content?: unknown };
        return typeof textPart.text === "string"
          ? textPart.text
          : typeof textPart.content === "string"
            ? textPart.content
            : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  throw new ExpenseChatError("OpenRouter returned an empty chat response.", 502);
}

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};
