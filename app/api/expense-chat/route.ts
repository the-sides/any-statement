import { commonErrorResponse } from "@/lib/apiErrors";
import { summarizeCashFlow } from "@/lib/cashFlowPlan";
import {
  getEnabledCategoryNames,
  selectActiveCategories
} from "@/lib/categories";
import { ensureCategoryCatalog } from "@/lib/categoryStore";
import { requireUserId } from "@/lib/currentUser";
import {
  answerExpenseQuestion,
  ExpenseChatError,
  type ExpenseChatMessage,
  type ExpenseChatRow,
  type ExpenseChatView
} from "@/lib/expenseChat";
import { isMonthKey } from "@/lib/months";
import { listStoredMonthDocuments } from "@/lib/monthStore";
import type { SaveStatementSource } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

type ExpenseChatRequest = {
  question?: unknown;
  selectedExpenseIds?: unknown;
  history?: unknown;
  view?: unknown;
  includeAppCategories?: unknown;
};

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = (await request.json()) as ExpenseChatRequest;

    if (typeof payload.question !== "string" || !payload.question.trim()) {
      return Response.json(
        { error: "Ask a question about the current expense rows." },
        { status: 400 }
      );
    }

    // Chat reads the whole ledger rather than the rows on screen: a question
    // about "last month" or "every Chipotle charge" is unanswerable from one
    // month document, and an approved edit has to name the month it lands in.
    const documents = await listStoredMonthDocuments(userId);
    const expenses: ExpenseChatRow[] = [];
    const statements: SaveStatementSource[] = [];

    for (const document of documents) {
      for (const expense of document.expenses) {
        expenses.push({ ...expense, month: document.month });
      }

      statements.push(...document.statements);
    }

    if (expenses.length === 0) {
      return Response.json(
        { error: "Add expense rows before using expense chat." },
        { status: 400 }
      );
    }

    const view = parseView(payload.view);
    const activeDocument = documents.find(
      (document) => document.month === view.activeMonth
    );
    const { catalog } = await ensureCategoryCatalog(userId);
    const categoryNames = getEnabledCategoryNames(
      selectActiveCategories(
        catalog.categories,
        typeof payload.includeAppCategories === "boolean"
          ? payload.includeAppCategories
          : null
      )
    );

    const result = await answerExpenseQuestion({
      question: payload.question,
      expenses,
      statements,
      view,
      categoryNames,
      selectedExpenseIds: Array.isArray(payload.selectedExpenseIds)
        ? payload.selectedExpenseIds.filter(
            (id): id is string => typeof id === "string"
          )
        : [],
      // Manual plan entries are not in scope here, so the summary is the one
      // the month on screen draws: recognized income against category spend.
      cashFlowSummary: activeDocument
        ? summarizeCashFlow(
            [],
            activeDocument.expenses,
            activeDocument.incomes
          )
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

    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Expense chat failed." }, { status: 500 })
    );
  }
}

function parseView(value: unknown): ExpenseChatView {
  if (!value || typeof value !== "object") {
    return { scope: "month", activeMonth: "" };
  }

  const view = value as Record<string, unknown>;

  return {
    scope: view.scope === "all" ? "all" : "month",
    activeMonth: isMonthKey(view.activeMonth) ? view.activeMonth : ""
  };
}
