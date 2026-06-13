import {
  answerExpenseQuestion,
  ExpenseChatError,
  type ExpenseChatMessage
} from "@/lib/expenseChat";
import type { CashFlowSummary } from "@/lib/cashFlowPlan";
import type { ExpenseItem, SaveStatementSource } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

type ExpenseChatRequest = {
  question?: unknown;
  expenses?: unknown;
  statements?: unknown;
  selectedExpenseIds?: unknown;
  cashFlowSummary?: unknown;
  history?: unknown;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ExpenseChatRequest;
    const expenses = Array.isArray(payload.expenses)
      ? (payload.expenses as ExpenseItem[])
      : [];

    if (typeof payload.question !== "string" || !payload.question.trim()) {
      return Response.json(
        { error: "Ask a question about the current expense rows." },
        { status: 400 }
      );
    }

    if (expenses.length === 0) {
      return Response.json(
        { error: "Add expense rows before using expense chat." },
        { status: 400 }
      );
    }

    const result = await answerExpenseQuestion({
      question: payload.question,
      expenses,
      statements: Array.isArray(payload.statements)
        ? (payload.statements as SaveStatementSource[])
        : [],
      selectedExpenseIds: Array.isArray(payload.selectedExpenseIds)
        ? payload.selectedExpenseIds.filter(
            (id): id is string => typeof id === "string"
          )
        : [],
      cashFlowSummary: isRecord(payload.cashFlowSummary)
        ? (payload.cashFlowSummary as CashFlowSummary)
        : undefined,
      history: Array.isArray(payload.history)
        ? (payload.history as ExpenseChatMessage[])
        : []
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof ExpenseChatError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json(
      { error: "Expense chat failed." },
      { status: 500 }
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
