"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  Database,
  FileText,
  Layers,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  NotebookPen,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES,
  FALLBACK_CATEGORY_NAME,
  getDefaultCategoryName,
  getEnabledCategoryNames,
  type ExpenseCategory,
  type ExpenseCategoryDefinition,
  type PaymentMethod,
  type StatementSection,
  type StatementType
} from "@/lib/categories";
import {
  CASH_FLOW_PLAN_STORAGE_KEY,
  createCashFlowPlan,
  parseCashFlowPlan,
  summarizeCashFlow,
  type CashFlowEntry,
  type CashFlowEntryKind,
  type CashFlowPlan,
  type CashFlowSummary
} from "@/lib/cashFlowPlan";
import {
  REVIEW_DRAFT_STORAGE_KEY,
  createReviewStatement,
  createReviewDraft,
  createStatementExpenses,
  parseReviewDraft,
  statementSourceForSave,
  type ReviewDraft,
  type ReviewStatement
} from "@/lib/reviewDraft";
import { sampleExtraction } from "@/lib/sample";
import type { ExpenseChatMessage } from "@/lib/expenseChat";
import type {
  ExpenseItem,
  SaveExpensesResult,
  StatementExtraction,
  StatementSummary
} from "@/lib/types";

type Notice = {
  tone: "neutral" | "success" | "error";
  message: string;
};

type ExtractionResponse = {
  extraction: StatementExtraction;
  artifact?: {
    dir: string;
    fileName?: string;
    filePath: string;
    pdfPath?: string;
    mediaType: "pdf" | "csv";
  };
};

type CategoryResponse = {
  categories: ExpenseCategoryDefinition[];
  enabledCategories?: ExpenseCategoryDefinition[];
  imported?: number;
  error?: string;
};

type ExpenseChatUiMessage = ExpenseChatMessage & {
  id: string;
};

type ExpenseChatResponse = {
  answer: string;
  context?: {
    rowCount: number;
    selectedRowCount: number;
    totalSpend: number;
    truncated: boolean;
  };
  error?: string;
};

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const CATEGORIZATION_NOTES_STORAGE_KEY =
  "statement-ledger.categorization-notes";
const CATEGORIZATION_NOTES_STORAGE_EVENT =
  "statement-ledger-categorization-notes";
const APP_CATEGORY_VISIBILITY_STORAGE_KEY =
  "statement-ledger.include-app-categories";
const APP_CATEGORY_VISIBILITY_STORAGE_EVENT =
  "statement-ledger-include-app-categories";
const REVIEW_DRAFT_STORAGE_EVENT = "statement-ledger-review-draft";
const CASH_FLOW_PLAN_STORAGE_EVENT = "statement-ledger-cash-flow-plan";
const MAX_CATEGORIZATION_NOTES_LENGTH = 4000;
const SAMPLE_STATEMENT_ID = "sample-statement";
const EXPENSE_CHAT_PROMPTS = [
  "How could I minimize food costs?",
  "Which merchants cost the most?",
  "Do any charges look recurring?"
];
const EMPTY_STATEMENT: StatementSummary = {
  institution: "",
  accountMask: "",
  statementType: "other",
  periodStart: "",
  periodEnd: "",
  currency: "USD",
  openingBalance: null,
  closingBalance: null,
  confidence: 0
};
const SAMPLE_REVIEW_STATEMENT = createReviewStatement({
  id: SAMPLE_STATEMENT_ID,
  statement: sampleExtraction.statement,
  sourceFileName: ""
});
const SAMPLE_REVIEW_DRAFT = createReviewDraft({
  statements: [SAMPLE_REVIEW_STATEMENT],
  expenses: sampleExtraction.expenses.map((item) => ({
    ...item,
    statementId: SAMPLE_STATEMENT_ID
  })),
  selectedIds: sampleExtraction.expenses.map((item) => item.id),
  activeStatementId: SAMPLE_STATEMENT_ID
});
const SAMPLE_CASH_FLOW_PLAN = createCashFlowPlan([
  {
    id: "paychecks",
    kind: "input",
    label: "Paychecks",
    amount: 4200,
    enabled: true
  },
  {
    id: "rent",
    kind: "output",
    label: "Rent",
    amount: 0,
    enabled: true
  },
  {
    id: "insurance",
    kind: "output",
    label: "Insurance",
    amount: 0,
    enabled: true
  }
]);
let cachedReviewDraftRaw: string | null = null;
let cachedReviewDraftSnapshot: ReviewDraft = SAMPLE_REVIEW_DRAFT;
let cachedCashFlowPlanRaw: string | null | undefined;
let cachedCashFlowPlanSnapshot: CashFlowPlan = SAMPLE_CASH_FLOW_PLAN;
const hydrationSafeIconProps = {
  "aria-hidden": "true",
  suppressHydrationWarning: true
} as const;

export function StatementWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [dataSourceId, setDataSourceId] = useState("");
  const [busy, setBusy] = useState<"idle" | "extracting" | "saving">("idle");
  const [categoryBusy, setCategoryBusy] = useState<
    "idle" | "loading" | "importing" | "updating"
  >("loading");
  const [categories, setCategories] = useState<ExpenseCategoryDefinition[]>(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  );
  const [notice, setNotice] = useState<Notice>({
    tone: "neutral",
    message: "Rows are saved locally in this browser."
  });
  const [lastSave, setLastSave] = useState<SaveExpensesResult | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ExpenseChatUiMessage[]>([]);
  const categorizationNotes = useSyncExternalStore(
    subscribeToCategorizationNotes,
    readCategorizationNotes,
    () => ""
  );
  const appCategoriesPreference = useSyncExternalStore(
    subscribeToAppCategoryVisibilityPreference,
    readAppCategoryVisibilityPreference,
    () => null
  );
  const reviewDraft = useSyncExternalStore(
    subscribeToReviewDraft,
    readReviewDraftSnapshot,
    readSampleReviewDraftSnapshot
  );
  const cashFlowPlan = useSyncExternalStore(
    subscribeToCashFlowPlan,
    readCashFlowPlanSnapshot,
    readSampleCashFlowPlanSnapshot
  );
  const statements = reviewDraft.statements;
  const items = reviewDraft.expenses;
  const selectedIds = useMemo(
    () => new Set(reviewDraft.selectedIds),
    [reviewDraft.selectedIds]
  );
  const statementById = useMemo(
    () => new Map(statements.map((statement) => [statement.id, statement])),
    [statements]
  );
  const activeStatement =
    statementById.get(reviewDraft.activeStatementId) || statements[0] || null;
  const activeStatementId = activeStatement?.id || "";
  const activeStatementSummary = activeStatement?.statement || EMPTY_STATEMENT;
  const sourceFileName = activeStatement?.sourceFileName || "";

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );
  const statementSummaries = useMemo(
    () =>
      statements.map((statement) => {
        const statementItems = items.filter(
          (item) => item.statementId === statement.id
        );
        const statementSelectedItems = statementItems.filter((item) =>
          selectedIds.has(item.id)
        );

        return {
          statement,
          items: statementItems,
          selectedItems: statementSelectedItems,
          amount: statementItems.reduce((sum, item) => sum + item.amount, 0)
        };
      }),
    [items, selectedIds, statements]
  );
  const cashFlowSummary = useMemo(
    () => summarizeCashFlow(cashFlowPlan.entries, items),
    [cashFlowPlan.entries, items]
  );
  const cashFlowInputs = cashFlowPlan.entries.filter(
    (entry) => entry.kind === "input"
  );
  const cashFlowOutputs = cashFlowPlan.entries.filter(
    (entry) => entry.kind === "output"
  );
  const totalAmount = selectedItems.reduce((sum, item) => sum + item.amount, 0);
  const currency =
    activeStatementSummary.currency || items[0]?.currency || "USD";
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const notionCategoryCount = categories.filter(
    (category) => category.source === "notion"
  ).length;
  const appCategoryCount = categories.filter(
    (category) => category.source === "app"
  ).length;
  const hasNotionCategories = notionCategoryCount > 0;
  const includeAppCategories =
    !hasNotionCategories || (appCategoriesPreference ?? false);
  const activeCategories = useMemo(
    () =>
      includeAppCategories
        ? categories
        : categories.filter((category) => category.source !== "app"),
    [categories, includeAppCategories]
  );
  const enabledCategoryNames = useMemo(
    () => getEnabledCategoryNames(activeCategories),
    [activeCategories]
  );
  const bulkCategoryOptions = useMemo(
    () => enabledCategoryOptions(activeCategories),
    [activeCategories]
  );
  const controlsDisabled = busy !== "idle" || categoryBusy !== "idle";

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      try {
        const response = await fetch("/api/categories");
        const result = (await response.json()) as CategoryResponse;

        if (!response.ok) {
          throw new Error(result.error || "Category loading failed.");
        }

        if (active) {
          setCategories(result.categories);
        }
      } catch {
        if (active) {
          setNotice({
            tone: "neutral",
            message: "Using built-in categories."
          });
        }
      } finally {
        if (active) {
          setCategoryBusy("idle");
        }
      }
    }

    loadCategories();

    return () => {
      active = false;
    };
  }, []);

  async function extractStatement() {
    if (!file) {
      setNotice({
        tone: "error",
        message: "Choose a PDF or CSV statement first."
      });
      return;
    }

    setBusy("extracting");
    setLastSave(null);
    setNotice({ tone: "neutral", message: "Extracting statement rows..." });

    try {
      const formData = new FormData();
      formData.append("statementFile", file);

      const notes = categorizationNotes.trim();
      if (notes) {
        formData.append("categorizationNotes", notes);
      }
      formData.append("includeAppCategories", String(includeAppCategories));

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData
      });
      const result = (await response.json()) as
        | ExtractionResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          ("error" in result && result.error) || "Extraction failed."
        );
      }

      const extractionResult = result as ExtractionResponse;
      const rowCount = extractionResult.extraction.expenses.length;
      const artifactMessage = extractionResult.artifact?.dir
        ? ` Artifacts: ${extractionResult.artifact.dir}`
        : "";

      loadExtraction(
        extractionResult.extraction,
        extractionResult.artifact?.fileName || file.name
      );
      setNotice({
        tone: rowCount > 0 ? "success" : "error",
        message:
          rowCount > 0
            ? `Extracted ${rowCount} expenses.${artifactMessage}`
            : `AI extraction returned no expense rows.${artifactMessage}`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Extraction failed."
      });
    } finally {
      setBusy("idle");
    }
  }

  async function saveToNotion() {
    if (!selectedItems.length) {
      setNotice({ tone: "error", message: "Select at least one row." });
      return;
    }

    setBusy("saving");
    setLastSave(null);
    setNotice({ tone: "neutral", message: "Saving selected rows..." });

    try {
      const response = await fetch("/api/notion/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dataSourceId: dataSourceId.trim() || undefined,
          sourceFileName:
            sourceFileName || file?.name || "sample-statement.pdf",
          statement: activeStatementSummary,
          statements: statements.map(statementSourceForSave),
          expenses: selectedItems
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Save failed.");
      }

      setLastSave(result);
      setNotice({
        tone: "success",
        message: `Saved ${result.saved} rows to Notion.`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Save failed."
      });
    } finally {
      setBusy("idle");
    }
  }

  async function askExpenseChat(nextQuestion = chatInput) {
    const question = nextQuestion.trim();

    if (!question) {
      return;
    }

    if (items.length === 0) {
      setNotice({
        tone: "error",
        message: "Add expense rows before using expense chat."
      });
      return;
    }

    const userMessage: ExpenseChatUiMessage = {
      id: createClientId("chat-user"),
      role: "user",
      content: question
    };
    const history = chatMessages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    setChatMessages((current) => [...current, userMessage]);
    setChatInput("");
    setChatBusy(true);

    try {
      const response = await fetch("/api/expense-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question,
          expenses: items,
          statements: statements.map(statementSourceForSave),
          selectedExpenseIds: [...selectedIds],
          cashFlowSummary,
          history
        })
      });
      const result = (await response.json()) as ExpenseChatResponse;

      if (!response.ok) {
        throw new Error(result.error || "Expense chat failed.");
      }

      setChatMessages((current) => [
        ...current,
        {
          id: createClientId("chat-assistant"),
          role: "assistant",
          content: result.answer
        }
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Expense chat failed.";

      setChatMessages((current) => [
        ...current,
        {
          id: createClientId("chat-assistant"),
          role: "assistant",
          content: message
        }
      ]);
      setNotice({ tone: "error", message });
    } finally {
      setChatBusy(false);
    }
  }

  async function importCategories() {
    setCategoryBusy("importing");
    setNotice({ tone: "neutral", message: "Importing categories..." });

    try {
      const response = await fetch("/api/categories/import", {
        method: "POST"
      });
      const result = (await response.json()) as CategoryResponse;

      if (!response.ok) {
        throw new Error(result.error || "Category import failed.");
      }

      setCategories(result.categories);
      setNotice({
        tone: "success",
        message: `Imported ${result.imported || 0} categories.`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Category import failed."
      });
    } finally {
      setCategoryBusy("idle");
    }
  }

  async function toggleCategory(name: string, enabled: boolean) {
    const previousCategories = categories;

    setCategoryBusy("updating");
    setCategories((current) =>
      current.map((category) =>
        category.name === name ? { ...category, enabled } : category
      )
    );

    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, enabled })
      });
      const result = (await response.json()) as CategoryResponse;

      if (!response.ok) {
        throw new Error(result.error || "Category update failed.");
      }

      setCategories(result.categories);
    } catch (error) {
      setCategories(previousCategories);
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Category update failed."
      });
    } finally {
      setCategoryBusy("idle");
    }
  }

  function toggleAppCategoryVisibility(enabled: boolean) {
    if (!writeAppCategoryVisibilityPreference(enabled)) {
      setNotice({
        tone: "error",
        message: "APP category preference could not be saved in this browser."
      });
    }
  }

  function writeReviewState(next: {
    statements?: readonly ReviewStatement[];
    items?: readonly ExpenseItem[];
    selectedIds?: Iterable<string>;
    activeStatementId?: string;
  }) {
    const nextStatements = next.statements || statements;
    const nextItems = [...(next.items || items)];
    const draft = createReviewDraft({
      statements: nextStatements,
      expenses: nextItems,
      selectedIds: next.selectedIds ?? selectedIds,
      activeStatementId: next.activeStatementId ?? activeStatementId
    });

    if (!writeStoredReviewDraft(draft)) {
      setNotice({
        tone: "error",
        message: "Current rows could not be saved in this browser."
      });
      return false;
    }

    return true;
  }

  function loadExtraction(
    nextExtraction: StatementExtraction,
    nextSourceFileName = ""
  ) {
    const statementId = createClientId("statement");
    const statement = createReviewStatement({
      id: statementId,
      statement: nextExtraction.statement,
      sourceFileName: nextSourceFileName
    });
    const statementItems = createStatementExpenses(
      statementId,
      nextExtraction.expenses
    );
    const shouldReplaceDraft = !hasStoredReviewDraft();
    const nextSelectedIds = shouldReplaceDraft
      ? statementItems.map((item) => item.id)
      : new Set([
          ...selectedIds,
          ...statementItems.map((item) => item.id)
        ]);

    writeReviewState({
      statements: shouldReplaceDraft ? [statement] : [...statements, statement],
      items: shouldReplaceDraft ? statementItems : [...items, ...statementItems],
      selectedIds: nextSelectedIds,
      activeStatementId: statementId
    });
  }

  function updateStatement<K extends keyof StatementSummary>(
    key: K,
    value: StatementSummary[K]
  ) {
    if (!activeStatement) {
      return;
    }

    writeReviewState({
      statements: statements.map((statement) =>
        statement.id === activeStatement.id
          ? {
              ...statement,
              statement: {
                ...statement.statement,
                [key]: value
              }
            }
          : statement
      )
    });
  }

  function updateItem(id: string, patch: Partial<ExpenseItem>) {
    writeReviewState({
      items: items.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      )
    });
  }

  function recategorizeSelected(category: ExpenseCategory) {
    const selectedCount = selectedItems.length;

    if (selectedCount === 0) {
      setNotice({ tone: "error", message: "Select at least one row." });
      return;
    }

    if (
      !writeReviewState({
        items: items.map((item) =>
          selectedIds.has(item.id) ? { ...item, category } : item
        )
      })
    ) {
      return;
    }

    setNotice({
      tone: "success",
      message: `Updated ${selectedCount} ${
        selectedCount === 1 ? "row" : "rows"
      } to ${category}.`
    });
  }

  function recategorizeStatement(statementId: string, category: ExpenseCategory) {
    const rowCount = items.filter((item) => item.statementId === statementId).length;
    const statement = statementById.get(statementId);

    if (rowCount === 0) {
      setNotice({ tone: "error", message: "No rows for that statement." });
      return;
    }

    if (
      !writeReviewState({
        items: items.map((item) =>
          item.statementId === statementId ? { ...item, category } : item
        ),
        activeStatementId: statementId
      })
    ) {
      return;
    }

    setNotice({
      tone: "success",
      message: `Updated ${rowCount} rows from ${formatStatementTitle(
        statement
      )} to ${category}.`
    });
  }

  function toggleItem(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    writeReviewState({ selectedIds: next });
  }

  function toggleAll() {
    writeReviewState({
      selectedIds: allSelected ? [] : items.map((item) => item.id)
    });
  }

  function activateStatement(statementId: string) {
    if (!statementById.has(statementId)) {
      return;
    }

    writeReviewState({ activeStatementId: statementId });
  }

  function selectStatementRows(statementId: string) {
    const rowIds = items
      .filter((item) => item.statementId === statementId)
      .map((item) => item.id);
    const statement = statementById.get(statementId);

    if (rowIds.length === 0) {
      setNotice({ tone: "error", message: "No rows for that statement." });
      return;
    }

    writeReviewState({
      selectedIds: new Set([...selectedIds, ...rowIds]),
      activeStatementId: statementId
    });
    setNotice({
      tone: "success",
      message: `Selected ${rowIds.length} rows from ${formatStatementTitle(
        statement
      )}.`
    });
  }

  function clearStatementRows(statementId: string) {
    const rowIds = new Set(
      items
        .filter((item) => item.statementId === statementId)
        .map((item) => item.id)
    );
    const nextSelectedIds = [...selectedIds].filter((id) => !rowIds.has(id));
    const statement = statementById.get(statementId);

    writeReviewState({
      selectedIds: nextSelectedIds,
      activeStatementId: statementId
    });
    setNotice({
      tone: "neutral",
      message: `Cleared ${rowIds.size} rows from ${formatStatementTitle(
        statement
      )}.`
    });
  }

  function removeStatement(statementId: string) {
    const rowIds = new Set(
      items
        .filter((item) => item.statementId === statementId)
        .map((item) => item.id)
    );
    const nextStatements = statements.filter(
      (statement) => statement.id !== statementId
    );
    const statement = statementById.get(statementId);

    writeReviewState({
      statements: nextStatements,
      items: items.filter((item) => item.statementId !== statementId),
      selectedIds: [...selectedIds].filter((id) => !rowIds.has(id)),
      activeStatementId:
        activeStatementId === statementId
          ? nextStatements[0]?.id || ""
          : activeStatementId
    });
    setNotice({
      tone: "neutral",
      message: `Removed ${rowIds.size} rows from ${formatStatementTitle(
        statement
      )}.`
    });
  }

  function addRow() {
    const id = crypto.randomUUID();
    const targetStatementId = activeStatementId || createClientId("statement");
    const targetStatement =
      activeStatement ||
      createReviewStatement({
        id: targetStatementId,
        statement: EMPTY_STATEMENT,
        sourceFileName: "Manual rows"
      });
    const row: ExpenseItem = {
      id,
      statementId: targetStatementId,
      date: new Date().toISOString().slice(0, 10),
      postedDate: "",
      description: "",
      merchant: "",
      amount: 0,
      currency,
      category: getDefaultCategoryName(enabledCategoryNames),
      subcategory: "",
      paymentMethod: "unknown",
      statementSection: "purchase",
      confidence: 0.7,
      notes: ""
    };

    writeReviewState({
      statements: activeStatement ? statements : [...statements, targetStatement],
      items: [row, ...items],
      selectedIds: new Set([id, ...selectedIds]),
      activeStatementId: targetStatementId
    });
  }

  function removeRow(id: string) {
    const nextSelectedIds = new Set(selectedIds);
    nextSelectedIds.delete(id);

    writeReviewState({
      items: items.filter((item) => item.id !== id),
      selectedIds: nextSelectedIds
    });
  }

  function writeCashFlowState(entries: readonly CashFlowEntry[]) {
    const plan = createCashFlowPlan(entries);

    if (!writeStoredCashFlowPlan(plan)) {
      setNotice({
        tone: "error",
        message: "Cash flow inputs could not be saved in this browser."
      });
      return false;
    }

    return true;
  }

  function addCashFlowEntry(kind: CashFlowEntryKind) {
    const entry: CashFlowEntry = {
      id: crypto.randomUUID(),
      kind,
      label: kind === "input" ? "Income" : "Output",
      amount: 0,
      enabled: true
    };

    writeCashFlowState([...cashFlowPlan.entries, entry]);
  }

  function updateCashFlowEntry(
    id: string,
    patch: Partial<Pick<CashFlowEntry, "amount" | "enabled" | "label">>
  ) {
    writeCashFlowState(
      cashFlowPlan.entries.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
      )
    );
  }

  function removeCashFlowEntry(id: string) {
    writeCashFlowState(cashFlowPlan.entries.filter((entry) => entry.id !== id));
  }

  return (
    <main className="app-shell">
      <aside className="side-panel" aria-label="Statement controls">
        <div className="brand-lockup">
          <div className="brand-mark">SL</div>
          <div>
            <p className="eyebrow">Statement Ledger</p>
            <h1>Expense intake</h1>
          </div>
        </div>

        <section className="panel upload-panel">
          <div className="panel-heading">
            <FileText size={18} {...hydrationSafeIconProps} />
            <h2>Statement</h2>
          </div>

          <label className="file-drop" htmlFor="statement-upload">
            <Upload size={22} {...hydrationSafeIconProps} />
            <span>
              {file
                ? file.name
                : sourceFileName ||
                  (statements.length > 1
                    ? `${statements.length} statements`
                    : "Choose file")}
            </span>
            <small>
              {file
                ? formatBytes(file.size)
                : sourceFileName
                  ? "Restored draft"
                  : "PDF or CSV"}
            </small>
          </label>
          <input
            id="statement-upload"
            className="visually-hidden"
            type="file"
            accept="application/pdf,text/csv,.pdf,.csv"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />

          <button
            className="primary-button"
            type="button"
            title="Extract expenses"
            disabled={controlsDisabled}
            onClick={extractStatement}
          >
            {busy === "extracting" ? (
              <LoaderCircle
                className="spin"
                size={18}
                {...hydrationSafeIconProps}
              />
            ) : (
              <Sparkles size={18} {...hydrationSafeIconProps} />
            )}
            Extract
          </button>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <Database size={18} {...hydrationSafeIconProps} />
            <h2>Notion</h2>
          </div>
          <label className="field">
            <span>Data source ID</span>
            <input
              value={dataSourceId}
              onChange={(event) => setDataSourceId(event.target.value)}
              placeholder="Uses env when blank"
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            title="Save selected expenses"
            disabled={controlsDisabled}
            onClick={saveToNotion}
          >
            {busy === "saving" ? (
              <LoaderCircle
                className="spin"
                size={18}
                {...hydrationSafeIconProps}
              />
            ) : (
              <Save size={18} {...hydrationSafeIconProps} />
            )}
            Save
          </button>
        </section>

        <section className="panel note-panel">
          <div className="panel-heading panel-heading-split">
            <div className="panel-heading-title">
              <NotebookPen size={18} {...hydrationSafeIconProps} />
              <h2>AI Notes</h2>
            </div>
            <span className="panel-count">
              {categorizationNotes.trim() ? "Local" : "Empty"}
            </span>
          </div>

          <textarea
            className="note-textarea"
            value={categorizationNotes}
            maxLength={MAX_CATEGORIZATION_NOTES_LENGTH}
            onChange={(event) => {
              if (!writeCategorizationNotes(event.target.value)) {
                setNotice({
                  tone: "error",
                  message: "AI notes could not be saved in this browser."
                });
              }
            }}
            placeholder="Steam, Valve, and STEAMGAMES.COM should be Entertainment, not Charity."
          />
          <div className="note-meta">
            <span>Saved locally</span>
            <span>
              {categorizationNotes.length}/{MAX_CATEGORIZATION_NOTES_LENGTH}
            </span>
          </div>
        </section>

        <section className="panel category-panel">
          <div className="panel-heading panel-heading-split">
            <div className="panel-heading-title">
              <Tags size={18} {...hydrationSafeIconProps} />
              <h2>Categories</h2>
            </div>
            <span className="panel-count">
              {enabledCategoryNames.length}/{activeCategories.length}
            </span>
          </div>

          <button
            className="secondary-button"
            type="button"
            title="Import categories"
            disabled={controlsDisabled}
            onClick={importCategories}
          >
            {categoryBusy === "importing" ? (
              <LoaderCircle
                className="spin"
                size={18}
                {...hydrationSafeIconProps}
              />
            ) : (
              <RefreshCw size={18} {...hydrationSafeIconProps} />
            )}
            Import
          </button>

          <label
            className={`category-source-toggle ${
              includeAppCategories ? "enabled" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={includeAppCategories}
              disabled={!hasNotionCategories || controlsDisabled}
              onChange={(event) =>
                toggleAppCategoryVisibility(event.target.checked)
              }
            />
            <span className="category-source-copy">
              <strong>APP categories</strong>
              <small>
                {hasNotionCategories
                  ? `${appCategoryCount} built-in / ${notionCategoryCount} Notion`
                  : `${appCategoryCount} built-in defaults`}
              </small>
            </span>
          </label>

          <div className="category-list">
            {activeCategories.map((category) => (
              <label
                className={`category-toggle ${category.enabled ? "enabled" : ""}`}
                key={`${category.source}-${category.sourceId || category.name}`}
              >
                <input
                  type="checkbox"
                  checked={category.enabled}
                  disabled={categoryBusy !== "idle" || busy !== "idle"}
                  onChange={(event) =>
                    toggleCategory(category.name, event.target.checked)
                  }
                />
                <span className="category-toggle-main">
                  <strong>{category.name}</strong>
                  <small>{category.source}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel statement-list-panel">
          <div className="panel-heading panel-heading-split">
            <div className="panel-heading-title">
              <Layers size={18} {...hydrationSafeIconProps} />
              <h2>Statements</h2>
            </div>
            <span className="panel-count">{statements.length}</span>
          </div>

          <div className="statement-list">
            {statementSummaries.length === 0 ? (
              <div className="statement-empty">No statements</div>
            ) : null}
            {statementSummaries.map(
              ({ statement, items: statementItems, selectedItems: selected }) => (
                <div
                  className={`statement-source ${
                    statement.id === activeStatementId ? "active" : ""
                  }`}
                  key={statement.id}
                >
                  <button
                    className="statement-source-main"
                    type="button"
                    onClick={() => activateStatement(statement.id)}
                  >
                    <strong>{formatStatementTitle(statement)}</strong>
                    <small>
                      {statement.sourceFileName ||
                        formatStatementPeriod(statement.statement) ||
                        "Manual rows"}
                    </small>
                    <span>
                      {statementItems.length} rows / {selected.length} selected
                    </span>
                  </button>

                  <div className="statement-source-actions">
                    <button
                      className="mini-icon-button"
                      type="button"
                      title="Select statement rows"
                      onClick={() => selectStatementRows(statement.id)}
                    >
                      <ListChecks size={14} {...hydrationSafeIconProps} />
                    </button>
                    <button
                      className="mini-icon-button"
                      type="button"
                      title="Clear statement selection"
                      onClick={() => clearStatementRows(statement.id)}
                    >
                      <X size={14} {...hydrationSafeIconProps} />
                    </button>
                    <button
                      className="mini-icon-button danger"
                      type="button"
                      title="Remove statement"
                      onClick={() => removeStatement(statement.id)}
                    >
                      <Trash2 size={14} {...hydrationSafeIconProps} />
                    </button>
                  </div>

                  <label className="statement-category-control">
                    <Tags size={14} {...hydrationSafeIconProps} />
                    <select
                      value=""
                      aria-label={`Category for ${formatStatementTitle(
                        statement
                      )}`}
                      disabled={
                        statementItems.length === 0 || controlsDisabled
                      }
                      onChange={(event) => {
                        const category = event.target.value as ExpenseCategory;

                        if (category) {
                          recategorizeStatement(statement.id, category);
                        }
                      }}
                    >
                      <option value="">Set all rows</option>
                      {bulkCategoryOptions.map((category) => (
                        <option
                          key={`${category.source}-${
                            category.sourceId || category.name
                          }`}
                          value={category.name}
                        >
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )
            )}
          </div>
        </section>

        <section className="panel statement-card">
          <h2>Active statement</h2>
          <label className="field">
            <span>Institution</span>
            <input
              value={activeStatementSummary.institution}
              onChange={(event) =>
                updateStatement("institution", event.target.value)
              }
            />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Type</span>
              <select
                value={activeStatementSummary.statementType}
                onChange={(event) =>
                  updateStatement(
                    "statementType",
                    event.target.value as StatementType
                  )
                }
              >
                {STATEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Account</span>
              <input
                value={activeStatementSummary.accountMask}
                onChange={(event) =>
                  updateStatement("accountMask", event.target.value)
                }
              />
            </label>
          </div>
          <div className="field-grid">
            <label className="field">
              <span>Start</span>
              <input
                type="date"
                value={activeStatementSummary.periodStart}
                onChange={(event) =>
                  updateStatement("periodStart", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>End</span>
              <input
                type="date"
                value={activeStatementSummary.periodEnd}
                onChange={(event) =>
                  updateStatement("periodEnd", event.target.value)
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Currency</span>
            <input
              value={activeStatementSummary.currency}
              onChange={(event) =>
                updateStatement("currency", event.target.value.toUpperCase())
              }
            />
          </label>
        </section>
      </aside>

      <section className="workspace" aria-label="Expense review table">
        <div className="workspace-top">
          <div>
            <p className="eyebrow">Review queue</p>
            <h2>
              {statements.length > 1
                ? "Combined review"
                : activeStatementSummary.institution || "Review queue"}
            </h2>
          </div>

          <div className="stats-strip">
            <Stat label="Rows" value={String(items.length)} />
            <Stat label="Statements" value={String(statements.length)} />
            <Stat label="Selected" value={String(selectedItems.length)} />
            <Stat label="Amount" value={formatCurrency(totalAmount, currency)} />
          </div>
        </div>

        <div className={`notice ${notice.tone}`} role="status">
          {notice.tone === "error" ? (
            <AlertTriangle size={16} {...hydrationSafeIconProps} />
          ) : notice.tone === "success" ? (
            <Check size={16} {...hydrationSafeIconProps} />
          ) : (
            <FileText size={16} {...hydrationSafeIconProps} />
          )}
          <span>{notice.message}</span>
          {lastSave?.pages[0]?.url ? (
            <a href={lastSave.pages[0].url} target="_blank" rel="noreferrer">
              Open first page
            </a>
          ) : null}
        </div>

        <section className="expense-chat-panel" aria-label="Expense chat">
          <div className="expense-chat-heading">
            <div className="panel-heading-title">
              <MessageCircle size={18} {...hydrationSafeIconProps} />
              <h3>Expense chat</h3>
            </div>
            <span className="panel-count">
              {selectedItems.length > 0
                ? `${selectedItems.length} selected`
                : `${items.length} rows`}
            </span>
          </div>

          <div className="expense-chat-log" aria-live="polite">
            {chatMessages.length === 0 ? (
              <div className="expense-chat-suggestions">
                {EXPENSE_CHAT_PROMPTS.map((prompt) => (
                  <button
                    className="expense-chat-suggestion"
                    type="button"
                    key={prompt}
                    disabled={chatBusy || items.length === 0}
                    onClick={() => void askExpenseChat(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}

            {chatMessages.map((message) => (
              <div
                className={`expense-chat-message ${message.role}`}
                key={message.id}
              >
                <span className="expense-chat-avatar">
                  {message.role === "assistant" ? (
                    <Bot size={16} {...hydrationSafeIconProps} />
                  ) : (
                    <UserRound size={16} {...hydrationSafeIconProps} />
                  )}
                </span>
                <p>{message.content}</p>
              </div>
            ))}

            {chatBusy ? (
              <div className="expense-chat-message assistant">
                <span className="expense-chat-avatar">
                  <Bot size={16} {...hydrationSafeIconProps} />
                </span>
                <p>Thinking...</p>
              </div>
            ) : null}
          </div>

          <form
            className="expense-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void askExpenseChat();
            }}
          >
            <input
              value={chatInput}
              disabled={chatBusy || items.length === 0}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="How could I minimize food costs?"
              aria-label="Expense question"
            />
            <button
              className="icon-button expense-chat-send"
              type="submit"
              title="Send question"
              disabled={chatBusy || items.length === 0 || !chatInput.trim()}
            >
              {chatBusy ? (
                <LoaderCircle
                  className="spin"
                  size={16}
                  {...hydrationSafeIconProps}
                />
              ) : (
                <Send size={16} {...hydrationSafeIconProps} />
              )}
            </button>
          </form>
        </section>

        <section className="cash-flow-panel" aria-label="Income allocation">
          <div className="cash-flow-heading">
            <div>
              <p className="eyebrow">Cash flow</p>
              <h3>Income allocation</h3>
            </div>
            <div
              className={`cash-flow-balance ${
                cashFlowSummary.savedAmount < 0 ? "negative" : ""
              }`}
            >
              <span>
                {cashFlowSummary.savedAmount < 0 ? "Overspent" : "Saved"}
              </span>
              <strong>
                {formatCurrency(
                  Math.abs(cashFlowSummary.savedAmount),
                  currency
                )}
              </strong>
            </div>
          </div>

          <div className="cash-flow-body">
            <div className="cash-flow-editor" aria-label="Manual cash flow">
              <div className="cash-flow-entry-group">
                <div className="cash-flow-entry-heading">
                  <span>Inputs</span>
                  <button
                    className="mini-icon-button"
                    type="button"
                    title="Add income input"
                    onClick={() => addCashFlowEntry("input")}
                  >
                    <Plus size={14} {...hydrationSafeIconProps} />
                  </button>
                </div>
                {cashFlowInputs.length === 0 ? (
                  <div className="cash-flow-empty-row">No income inputs</div>
                ) : null}
                {cashFlowInputs.map((entry) => (
                  <div className="cash-flow-entry-row" key={entry.id}>
                    <input
                      className="cash-flow-entry-toggle"
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(event) =>
                        updateCashFlowEntry(entry.id, {
                          enabled: event.target.checked
                        })
                      }
                      aria-label={`Include ${entry.label || "income"}`}
                    />
                    <input
                      value={entry.label}
                      onChange={(event) =>
                        updateCashFlowEntry(entry.id, {
                          label: event.target.value
                        })
                      }
                      aria-label="Income label"
                    />
                    <input
                      className="cash-flow-amount-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.amount || ""}
                      onChange={(event) =>
                        updateCashFlowEntry(entry.id, {
                          amount: Number(event.target.value)
                        })
                      }
                      aria-label={`${entry.label || "Income"} amount`}
                    />
                    <button
                      className="mini-icon-button danger"
                      type="button"
                      title="Remove income input"
                      onClick={() => removeCashFlowEntry(entry.id)}
                    >
                      <Trash2 size={14} {...hydrationSafeIconProps} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="cash-flow-entry-group">
                <div className="cash-flow-entry-heading">
                  <span>Outputs</span>
                  <button
                    className="mini-icon-button"
                    type="button"
                    title="Add manual output"
                    onClick={() => addCashFlowEntry("output")}
                  >
                    <Plus size={14} {...hydrationSafeIconProps} />
                  </button>
                </div>
                {cashFlowOutputs.length === 0 ? (
                  <div className="cash-flow-empty-row">No manual outputs</div>
                ) : null}
                {cashFlowOutputs.map((entry) => (
                  <div className="cash-flow-entry-row" key={entry.id}>
                    <input
                      className="cash-flow-entry-toggle"
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(event) =>
                        updateCashFlowEntry(entry.id, {
                          enabled: event.target.checked
                        })
                      }
                      aria-label={`Include ${entry.label || "output"}`}
                    />
                    <input
                      value={entry.label}
                      onChange={(event) =>
                        updateCashFlowEntry(entry.id, {
                          label: event.target.value
                        })
                      }
                      aria-label="Output label"
                    />
                    <input
                      className="cash-flow-amount-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.amount || ""}
                      onChange={(event) =>
                        updateCashFlowEntry(entry.id, {
                          amount: Number(event.target.value)
                        })
                      }
                      aria-label={`${entry.label || "Output"} amount`}
                    />
                    <button
                      className="mini-icon-button danger"
                      type="button"
                      title="Remove manual output"
                      onClick={() => removeCashFlowEntry(entry.id)}
                    >
                      <Trash2 size={14} {...hydrationSafeIconProps} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flow-visual" aria-label="Cash flow visualization">
              <CashFlowSankey summary={cashFlowSummary} currency={currency} />
            </div>
          </div>
        </section>

        <div className="table-actions">
          <button
            className="icon-button"
            type="button"
            title={allSelected ? "Clear selection" : "Select all"}
            onClick={toggleAll}
          >
            <Check size={18} {...hydrationSafeIconProps} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Add expense"
            onClick={addRow}
          >
            <Plus size={18} {...hydrationSafeIconProps} />
          </button>
          <label className="bulk-category-control">
            <Tags size={16} {...hydrationSafeIconProps} />
            <select
              value=""
              aria-label="Category for selected rows"
              disabled={selectedItems.length === 0 || controlsDisabled}
              onChange={(event) => {
                const category = event.target.value as ExpenseCategory;

                if (category) {
                  recategorizeSelected(category);
                }
              }}
            >
              <option value="">Set category</option>
              {bulkCategoryOptions.map((category) => (
                <option
                  key={`${category.source}-${category.sourceId || category.name}`}
                  value={category.name}
                >
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="statement-scope-control">
            <Layers size={16} {...hydrationSafeIconProps} />
            <select
              value={activeStatementId}
              aria-label="Active statement"
              disabled={statements.length === 0 || controlsDisabled}
              onChange={(event) => activateStatement(event.target.value)}
            >
              {statements.map((statement) => (
                <option key={statement.id} value={statement.id}>
                  {formatStatementTitle(statement)}
                </option>
              ))}
            </select>
          </label>
          <span>{currencyNames.of(currency) || currency}</span>
        </div>

        <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th aria-label="Selected" />
                <th>Statement</th>
                <th>Date</th>
                <th>Merchant</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Method</th>
                <th>Section</th>
                <th>Confidence</th>
                <th>Notes</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={12}>
                    <div className="empty-state">
                      No expense rows returned. Re-upload the statement file and
                      inspect the saved artifact directory shown above.
                    </div>
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      aria-label={`Select ${item.merchant || item.description}`}
                    />
                  </td>
                  <td>
                    <button
                      className="statement-chip"
                      type="button"
                      onClick={() => activateStatement(item.statementId || "")}
                    >
                      {formatStatementShortLabel(
                        statementById.get(item.statementId || "")
                      )}
                    </button>
                  </td>
                  <td>
                    <input
                      type="date"
                      value={item.date}
                      onChange={(event) =>
                        updateItem(item.id, { date: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={item.merchant}
                      onChange={(event) =>
                        updateItem(item.id, { merchant: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={item.description}
                      onChange={(event) =>
                        updateItem(item.id, { description: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="amount-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(event) =>
                        updateItem(item.id, {
                          amount: Number(event.target.value)
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={item.category}
                      onChange={(event) =>
                        updateItem(item.id, {
                          category: event.target.value as ExpenseCategory
                        })
                      }
                    >
                      {categoryOptionsForItem(
                        item.category,
                        activeCategories
                      ).map((category) => (
                        <option key={category.name} value={category.name}>
                          {category.name}
                          {category.enabled ? "" : " (off)"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={item.paymentMethod}
                      onChange={(event) =>
                        updateItem(item.id, {
                          paymentMethod: event.target.value as PaymentMethod
                        })
                      }
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={item.statementSection}
                      onChange={(event) =>
                        updateItem(item.id, {
                          statementSection: event.target
                            .value as StatementSection
                        })
                      }
                    >
                      {STATEMENT_SECTIONS.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="confidence">
                      <span>{Math.round(item.confidence * 100)}%</span>
                      <meter min="0" max="1" value={item.confidence} />
                    </div>
                  </td>
                  <td>
                    <input
                      value={item.notes}
                      onChange={(event) =>
                        updateItem(item.id, { notes: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="icon-button danger"
                      type="button"
                      title="Remove row"
                      onClick={() => removeRow(item.id)}
                    >
                      <Trash2 size={16} {...hydrationSafeIconProps} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

type SankeySegment<T> = T & {
  color: string;
  height: number;
  y0: number;
  y1: number;
  yc: number;
};

function CashFlowSankey({
  summary,
  currency
}: {
  summary: CashFlowSummary;
  currency: string;
}) {
  const width = 760;
  const top = 76;
  const bottom = 64;
  const leftX = 22;
  const leftWidth = 180;
  const bundleX = 286;
  const bundleWidth = 22;
  const outputX = 520;
  const outsideLabelX = 552;
  const positiveInputs = summary.inputs.filter((entry) => entry.amount > 0);
  const allocations = summary.allocations.filter(
    (allocation) => allocation.amount > 0
  );
  const rowCount = Math.max(positiveInputs.length, allocations.length, 1);
  const height = Math.max(660, 180 + rowCount * 62);
  const availableHeight = height - top - bottom;
  const incomeCenterY = top + availableHeight / 2;
  const inputTotal =
    positiveInputs.reduce((sum, input) => sum + input.amount, 0) || 1;
  const allocationTotal =
    allocations.reduce((sum, allocation) => sum + allocation.amount, 0) || 1;
  const inputSegments = layoutSankeySegments(
    positiveInputs.map((entry, index) => ({
      ...entry,
      color: inputColor(index)
    })),
    inputTotal,
    top,
    availableHeight,
    18
  );
  const allocationSegments = layoutSankeySegments(
    allocations.map((allocation, index) => ({
      ...allocation,
      color: allocationColor(allocation.source, index)
    })),
    allocationTotal,
    top,
    availableHeight,
    16
  );
  const outsideAllocationLabelYs = new Map(
    layoutOutsideFlowLabels(
      allocationSegments.filter(
        (segment) => !canPlaceFlowLabelInside(segment)
      ),
      top + 16,
      height - bottom - 16,
      38
    )
  );

  return (
    <svg
      className="sankey-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Income flowing to savings, manual outputs, and statement categories"
    >
      <defs>
        <linearGradient id="sankey-input-fill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#d9f3f6" />
          <stop offset="100%" stopColor="#effbf2" />
        </linearGradient>
        <linearGradient id="sankey-input-stroke" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#0ca4b8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2f9e4f" stopOpacity="0.54" />
        </linearGradient>
      </defs>

      <rect className="sankey-stage" width={width} height={height} rx="8" />
      <text className="sankey-title" x={leftX} y="28">
        Inputs
      </text>
      <text className="sankey-title" x={bundleX - 32} y="28">
        Income
      </text>
      <text className="sankey-title" x={outsideLabelX} y="28">
        Outputs & categories
      </text>

      {positiveInputs.length === 0 ? (
        <text className="sankey-empty" x={leftX + 18} y={top + 28}>
          Add income
        </text>
      ) : null}
      {allocations.length === 0 ? (
        <text className="sankey-empty" x={outsideLabelX} y={top + 28}>
          Add outputs or statement rows
        </text>
      ) : null}

      <g className="sankey-flows">
        {inputSegments.map((segment) => (
          <g key={`input-flow-${segment.id}`}>
            <path
              className="sankey-flow input-flow"
              d={sankeyStrokePath(
                leftX + leftWidth + 16,
                bundleX - 10,
                segment.yc,
                flowBundleY(segment.yc, incomeCenterY)
              )}
              fill="none"
              stroke="url(#sankey-input-stroke)"
              strokeWidth={segment.height}
            />
          </g>
        ))}

        {allocationSegments.map((segment) => (
          <g key={`allocation-flow-${segment.id}`}>
            <path
              className={`sankey-flow allocation-flow ${
                canPlaceFlowLabelInside(segment)
                  ? "label-inside"
                  : "label-outside"
              }`}
              d={sankeyStrokePath(
                bundleX + bundleWidth + 18,
                outputX,
                flowBundleY(segment.yc, incomeCenterY),
                segment.yc
              )}
              fill="none"
              stroke={segment.color}
              strokeWidth={segment.height}
            />
          </g>
        ))}
      </g>

      <g className="sankey-nodes">
        {inputSegments.map((segment) => {
          const nodeHeight = Math.max(56, Math.min(segment.height, 104));
          const nodeY = clamp(
            segment.yc - nodeHeight / 2,
            top,
            height - bottom - nodeHeight
          );

          return (
            <g key={`input-${segment.id}`}>
              <rect
                className="sankey-input-node"
                x={leftX}
                y={nodeY}
                width={leftWidth}
                height={nodeHeight}
                rx="6"
              />
              <rect
                x={leftX}
                y={nodeY}
                width="12"
                height={nodeHeight}
                rx="4"
                fill={segment.color}
              />
              <text
                className="sankey-node-label"
                x={leftX + 28}
                y={nodeY + 26}
              >
                {truncateSvgText(segment.label, 28)}
              </text>
              <text
                className="sankey-node-amount"
                x={leftX + 28}
                y={nodeY + 46}
              >
                {formatCurrency(segment.amount, currency)}
              </text>
            </g>
          );
        })}

        <rect
          className="sankey-income-node"
          x={bundleX}
          y={top}
          width={bundleWidth}
          height={availableHeight}
          rx="12"
        />
        <rect
          className="sankey-income-label-bg"
          x={bundleX - 56}
          y={incomeCenterY - 30}
          width="136"
          height="60"
          rx="4"
        />
        <text
          className="sankey-income-label"
          x={bundleX + bundleWidth / 2}
          y={incomeCenterY - 7}
          textAnchor="middle"
        >
          Income
        </text>
        <text
          className="sankey-income-amount"
          x={bundleX + bundleWidth / 2}
          y={incomeCenterY + 15}
          textAnchor="middle"
        >
          {formatCurrency(summary.incomeTotal, currency)}
        </text>

        {allocationSegments.map((segment) => {
          const labelInside = canPlaceFlowLabelInside(segment);
          const labelY = labelInside
            ? segment.yc
            : outsideAllocationLabelYs.get(segment.id) || segment.yc;
          const labelX = labelInside ? outputX - 22 : outsideLabelX;
          const textAnchor = labelInside ? "end" : "start";

          return (
            <g key={`allocation-${segment.id}`}>
              {!labelInside ? (
                <path
                  className="sankey-label-leader"
                  d={sankeyLabelLeaderPath(
                    outputX + 8,
                    segment.yc,
                    labelX - 12,
                    labelY
                  )}
                  fill="none"
                  stroke={segment.color}
                />
              ) : null}
              <circle
                className="sankey-flow-terminal"
                cx={outputX}
                cy={segment.yc}
                r={Math.max(2.5, Math.min(8, segment.height / 2))}
                fill={segment.color}
              />
              <text
                className={`sankey-allocation-label ${
                  labelInside ? "inside" : "outside"
                }`}
                x={labelX}
                y={labelY - 5}
                textAnchor={textAnchor}
              >
                {truncateSvgText(segment.label, labelInside ? 24 : 34)}
              </text>
              <text
                className={`sankey-allocation-amount ${
                  labelInside ? "inside" : "outside"
                }`}
                x={labelX}
                y={labelY + 14}
                textAnchor={textAnchor}
              >
                {formatCurrency(segment.amount, currency)} (
                {formatPercent(segment.percent)})
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function subscribeToCategorizationNotes(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === CATEGORIZATION_NOTES_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(CATEGORIZATION_NOTES_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(
      CATEGORIZATION_NOTES_STORAGE_EVENT,
      onStoreChange
    );
  };
}

function readCategorizationNotes() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(CATEGORIZATION_NOTES_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeCategorizationNotes(value: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(CATEGORIZATION_NOTES_STORAGE_KEY, value);
    window.dispatchEvent(new Event(CATEGORIZATION_NOTES_STORAGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function subscribeToAppCategoryVisibilityPreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_CATEGORY_VISIBILITY_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(
    APP_CATEGORY_VISIBILITY_STORAGE_EVENT,
    onStoreChange
  );

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(
      APP_CATEGORY_VISIBILITY_STORAGE_EVENT,
      onStoreChange
    );
  };
}

function readAppCategoryVisibilityPreference() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(
      APP_CATEGORY_VISIBILITY_STORAGE_KEY
    );

    if (stored === "true") {
      return true;
    }

    if (stored === "false") {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

function writeAppCategoryVisibilityPreference(value: boolean) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(
      APP_CATEGORY_VISIBILITY_STORAGE_KEY,
      String(value)
    );
    window.dispatchEvent(new Event(APP_CATEGORY_VISIBILITY_STORAGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function subscribeToReviewDraft(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === REVIEW_DRAFT_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(REVIEW_DRAFT_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(REVIEW_DRAFT_STORAGE_EVENT, onStoreChange);
  };
}

function readSampleReviewDraftSnapshot() {
  return SAMPLE_REVIEW_DRAFT;
}

function readReviewDraftSnapshot() {
  if (typeof window === "undefined") {
    return SAMPLE_REVIEW_DRAFT;
  }

  try {
    const raw = window.localStorage.getItem(REVIEW_DRAFT_STORAGE_KEY);

    if (raw === cachedReviewDraftRaw) {
      return cachedReviewDraftSnapshot;
    }

    const draft = raw ? parseReviewDraft(JSON.parse(raw)) : null;
    cachedReviewDraftRaw = raw;
    cachedReviewDraftSnapshot = draft || SAMPLE_REVIEW_DRAFT;
    return cachedReviewDraftSnapshot;
  } catch {
    cachedReviewDraftRaw = null;
    cachedReviewDraftSnapshot = SAMPLE_REVIEW_DRAFT;
    return cachedReviewDraftSnapshot;
  }
}

function writeStoredReviewDraft(draft: ReviewDraft) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const raw = JSON.stringify(draft);
    window.localStorage.setItem(REVIEW_DRAFT_STORAGE_KEY, raw);
    cachedReviewDraftRaw = raw;
    cachedReviewDraftSnapshot = draft;
    window.dispatchEvent(new Event(REVIEW_DRAFT_STORAGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function hasStoredReviewDraft() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(REVIEW_DRAFT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function formatStatementTitle(statement?: ReviewStatement | null) {
  if (!statement) {
    return "Statement";
  }

  return (
    statement.statement.institution.trim() ||
    statement.sourceFileName.trim() ||
    "Statement"
  );
}

function formatStatementShortLabel(statement?: ReviewStatement | null) {
  if (!statement) {
    return "Unknown";
  }

  return truncateText(
    statement.statement.accountMask.trim() ||
      statement.statement.institution.trim() ||
      statement.sourceFileName.trim() ||
      "Statement",
    18
  );
}

function formatStatementPeriod(statement: StatementSummary) {
  return [statement.periodStart, statement.periodEnd].filter(Boolean).join(" to ");
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function subscribeToCashFlowPlan(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === CASH_FLOW_PLAN_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(CASH_FLOW_PLAN_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CASH_FLOW_PLAN_STORAGE_EVENT, onStoreChange);
  };
}

function readSampleCashFlowPlanSnapshot() {
  return SAMPLE_CASH_FLOW_PLAN;
}

function readCashFlowPlanSnapshot() {
  if (typeof window === "undefined") {
    return SAMPLE_CASH_FLOW_PLAN;
  }

  try {
    const raw = window.localStorage.getItem(CASH_FLOW_PLAN_STORAGE_KEY);

    if (raw === cachedCashFlowPlanRaw) {
      return cachedCashFlowPlanSnapshot;
    }

    const plan = raw ? parseCashFlowPlan(JSON.parse(raw)) : null;
    cachedCashFlowPlanRaw = raw;
    cachedCashFlowPlanSnapshot = plan || SAMPLE_CASH_FLOW_PLAN;
    return cachedCashFlowPlanSnapshot;
  } catch {
    cachedCashFlowPlanRaw = undefined;
    cachedCashFlowPlanSnapshot = SAMPLE_CASH_FLOW_PLAN;
    return cachedCashFlowPlanSnapshot;
  }
}

function writeStoredCashFlowPlan(plan: CashFlowPlan) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const raw = JSON.stringify(plan);
    window.localStorage.setItem(CASH_FLOW_PLAN_STORAGE_KEY, raw);
    cachedCashFlowPlanRaw = raw;
    cachedCashFlowPlanSnapshot = plan;
    window.dispatchEvent(new Event(CASH_FLOW_PLAN_STORAGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function categoryOptionsForItem(
  value: string,
  categories: readonly ExpenseCategoryDefinition[]
) {
  const normalizedValue = value.trim().toLowerCase();
  const options = categories.filter(
    (category) =>
      category.enabled || category.name.toLowerCase() === normalizedValue
  );

  if (
    value &&
    !options.some((category) => category.name.toLowerCase() === normalizedValue)
  ) {
    return [
      ...options,
      {
        name: value,
        enabled: false,
        description: "",
        source: "app" as const
      }
    ];
  }

  if (options.length > 0) {
    return options;
  }

  return [
    {
      name: FALLBACK_CATEGORY_NAME,
      enabled: true,
      description: "",
      source: "app" as const
    }
  ];
}

function enabledCategoryOptions(
  categories: readonly ExpenseCategoryDefinition[]
) {
  const options = categories.filter((category) => category.enabled);

  if (options.length > 0) {
    return options;
  }

  return [
    {
      name: FALLBACK_CATEGORY_NAME,
      enabled: true,
      description: "",
      source: "app" as const
    }
  ];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function layoutSankeySegments<T extends { amount: number; color: string }>(
  items: readonly T[],
  total: number,
  top: number,
  availableHeight: number,
  gap: number
): Array<SankeySegment<T>> {
  if (items.length === 0) {
    return [];
  }

  const totalGap = gap * (items.length - 1);
  const stackHeight = Math.max(1, availableHeight - totalGap);
  let cursor = top;

  return items.map((item) => {
    const height =
      total > 0
        ? (item.amount / total) * stackHeight
        : stackHeight / items.length;
    const y0 = cursor;
    const y1 = y0 + height;
    cursor = y1 + gap;

    return {
      ...item,
      height,
      y0,
      y1,
      yc: y0 + height / 2
    };
  });
}

function canPlaceFlowLabelInside(segment: { height: number }) {
  return segment.height >= 46;
}

function flowBundleY(targetY: number, centerY: number) {
  return centerY + (targetY - centerY) * 0.18;
}

function layoutOutsideFlowLabels<T extends { id: string; yc: number }>(
  segments: readonly T[],
  minY: number,
  maxY: number,
  minSpacing: number
): Array<readonly [string, number]> {
  if (segments.length === 0) {
    return [];
  }

  const sorted = [...segments].sort((left, right) => left.yc - right.yc);
  const available = Math.max(1, maxY - minY);
  const spacing =
    sorted.length > 1
      ? Math.min(minSpacing, available / (sorted.length - 1))
      : minSpacing;
  const positions = sorted.map((segment) => clamp(segment.yc, minY, maxY));

  for (let index = 1; index < positions.length; index += 1) {
    positions[index] = Math.max(
      positions[index],
      positions[index - 1] + spacing
    );
  }

  const overflow = positions[positions.length - 1] - maxY;
  if (overflow > 0) {
    for (let index = 0; index < positions.length; index += 1) {
      positions[index] -= overflow;
    }
  }

  for (let index = positions.length - 2; index >= 0; index -= 1) {
    positions[index] = Math.min(
      positions[index],
      positions[index + 1] - spacing
    );
  }

  return sorted.map((segment, index) => [
    segment.id,
    clamp(positions[index], minY, maxY)
  ]);
}

function sankeyStrokePath(
  x0: number,
  x1: number,
  y0: number,
  y1: number
) {
  const curve = (x1 - x0) * 0.48;
  const verticalPull = (y1 - y0) * 0.18;

  return [
    `M ${x0} ${y0}`,
    `C ${x0 + curve} ${y0 + verticalPull}, ${x1 - curve} ${
      y1 - verticalPull
    }, ${x1} ${y1}`
  ].join(" ");
}

function sankeyLabelLeaderPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const curve = Math.max(24, (x1 - x0) * 0.52);

  return [
    `M ${x0} ${y0}`,
    `C ${x0 + curve} ${y0}, ${x1 - curve} ${y1}, ${x1} ${y1}`
  ].join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function inputColor(index: number) {
  const colors = ["#0ca4b8", "#2f9e4f", "#2448c7", "#f2b705"];

  return colors[index % colors.length];
}

function allocationColor(source: string, index: number) {
  if (source === "saved") {
    return "#2f9e4f";
  }

  if (source === "manual-output") {
    return "#f2b705";
  }

  if (source === "overspent") {
    return "#d45735";
  }

  const colors = ["#c51f87", "#0ca4b8", "#2448c7", "#d45735", "#7a62c9"];

  return colors[index % colors.length];
}

function truncateSvgText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function formatPercent(value: number) {
  if (value === 0) {
    return "0%";
  }

  if (Math.abs(value) < 10) {
    return `${value.toFixed(1)}%`;
  }

  return `${Math.round(value)}%`;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
