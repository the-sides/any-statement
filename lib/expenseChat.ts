import type { CashFlowSummary } from "@/lib/cashFlowPlan";
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
const MAX_CONTEXT_ROWS = 300;
const MAX_TOP_GROUPS = 20;

export type ExpenseChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ExpenseChatInput = {
  question: string;
  expenses: readonly ExpenseItem[];
  statements?: readonly SaveStatementSource[];
  selectedExpenseIds?: readonly string[];
  cashFlowSummary?: CashFlowSummary;
  history?: readonly ExpenseChatMessage[];
};

export type ExpenseChatAnswer = {
  answer: string;
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
            "You are an expense-analysis assistant inside Statement Ledger. Use only the supplied expense rows, statement metadata, cash-flow summary, and conversation transcript. Do not invent transactions, balances, vendors, categories, or external facts. When useful, cite exact category or merchant totals from the context. Keep advice concrete and practical, and say when the rows are insufficient."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 1200,
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

  const answer = parseChatContent(
    (payload as OpenRouterChatResponse).choices?.[0]?.message?.content
  );

  return {
    answer,
    model,
    context: summarizeChatContext(input)
  };
}

export function buildExpenseChatPrompt(input: ExpenseChatInput) {
  const selectedIds = new Set(input.selectedExpenseIds || []);
  const totalSpend = sumExpenses(input.expenses);
  const selectedSpend = sumExpenses(
    input.expenses.filter((expense) => selectedIds.has(expense.id))
  );
  const rows = rowsForPrompt(input.expenses);
  const truncated = rows.length < input.expenses.length;
  const statementNames = new Map(
    (input.statements || []).map((statement) => [
      statement.id,
      formatStatementLabel(statement.statement, statement.sourceFileName)
    ])
  );

  return [
    "Current review context:",
    `- Expense rows: ${input.expenses.length}`,
    `- Selected rows: ${selectedIds.size}`,
    `- Total reviewed spend: ${formatAmount(totalSpend, input.expenses[0]?.currency || "USD")}`,
    selectedIds.size > 0
      ? `- Selected-row spend: ${formatAmount(
          selectedSpend,
          input.expenses[0]?.currency || "USD"
        )}`
      : "- Selected-row spend: none selected",
    truncated
      ? `- Row detail below is limited to the ${rows.length} highest-amount rows. Category and merchant summaries include all rows.`
      : "- Row detail includes all rows.",
    "",
    "Statements:",
    formatStatements(input.statements),
    "",
    "Cash-flow summary:",
    formatCashFlowSummary(input.cashFlowSummary, input.expenses[0]?.currency || "USD"),
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
    "Answer with the most relevant totals, vendors, categories, and next actions. For cost-reduction questions, rank the highest-leverage reductions first."
  ].join("\n");
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

function rowsForPrompt(expenses: readonly ExpenseItem[]) {
  if (expenses.length <= MAX_CONTEXT_ROWS) {
    return expenses;
  }

  return [...expenses]
    .sort((left, right) => right.amount - left.amount)
    .slice(0, MAX_CONTEXT_ROWS);
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
  expense: ExpenseItem,
  options: { selected: boolean; statementName: string }
) {
  return [
    `${index}.`,
    options.selected ? "[selected]" : "[not selected]",
    expense.date || "no date",
    options.statementName ? `statement=${sanitizeInline(options.statementName)}` : "",
    `merchant=${sanitizeInline(expense.merchant || "Unknown")}`,
    `description=${sanitizeInline(expense.description || "")}`,
    `amount=${formatAmount(expense.amount, expense.currency)}`,
    `category=${sanitizeInline(expense.category || "Other")}`,
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
