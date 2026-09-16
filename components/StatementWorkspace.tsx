"use client";

import {
  AlertTriangle,
  Bot,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  FileText,
  Layers,
  ListChecks,
  ListFilter,
  LoaderCircle,
  MessageCircle,
  NotebookPen,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Tags,
  Trash2,
  Undo2,
  Unplug,
  Upload,
  UserRound,
  Wallet,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";
import { AllMonthsView } from "@/components/AllMonthsView";
import { AppNav, sectionTitle, type SectionId } from "@/components/AppNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthStatus } from "@/components/AuthStatus";
import CashFlowSankey from "@/components/CashFlowSankey";
import SpendingCalendar from "@/components/SpendingCalendar";
import {
  allocationColor,
  formatPercent,
  truncateSvgText
} from "@/lib/chartFormat";
import {
  DEFAULT_GRAPH_ZOOM,
  MAX_GRAPH_ZOOM,
  MIN_GRAPH_ZOOM,
  nextGraphZoomLevel
} from "@/lib/graphZoom";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  INCOME_KINDS,
  STATEMENT_TYPES,
  FALLBACK_CATEGORY_NAME,
  MAX_CATEGORY_DESCRIPTION_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  getDefaultCategoryName,
  getEnabledCategoryNames,
  isEditableCategory,
  hasActiveNotionCategories,
  resolveIncludeAppCategories,
  selectActiveCategories,
  type ExpenseCategory,
  type ExpenseCategoryDefinition,
  type StatementType
} from "@/lib/categories";
import {
  summarizeCashFlow,
  type CashFlowSummary
} from "@/lib/cashFlowPlan";
import { formatCurrency } from "@/lib/currency";
import { MAX_CATEGORIZATION_NOTES_LENGTH } from "@/lib/userSettings";
import type { Viewer } from "@/lib/viewer";
import {
  readInitialUserSettingsSnapshot,
  readUserSettingsSnapshot,
  subscribeToUserSettings,
  updateCategorizationNotes
} from "@/lib/userSettingsClientStore";
import {
  formatMonthLabel,
  isMonthKey,
  planStatementFiling
} from "@/lib/months";
import {
  clearMonthsNotice,
  fileStatement,
  fileStatementSegments,
  flushMonths,
  applyExpenseEdits,
  readInitialMonthsSnapshot,
  readMonthsSnapshot,
  reassignStatement,
  selectMonth,
  subscribeToMonths,
  updateActiveMonth,
  type MonthsState
} from "@/lib/monthsClientStore";
import {
  createReviewStatement,
  createStatementExpenses,
  statementSourceForSave,
  type ReviewStatement
} from "@/lib/reviewDraft";
import {
  REVIEW_HISTORY_STORAGE_KEY,
  createBulkCategoryHistoryEvent,
  parseReviewHistory,
  pushReviewHistoryEvent,
  serializeReviewHistory,
  undoReviewHistoryEvent,
  type ReviewHistoryEvent
} from "@/lib/reviewHistory";
import type { ExpenseChatMessage } from "@/lib/expenseChat";
import type {
  CategoryProposal,
  ExpenseChatEdit,
  ExpenseEditField
} from "@/lib/expenseEdits";
import type {
  ExpenseItem,
  IncomeItem,
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
  importError?: string;
  error?: string;
  renamedFrom?: string;
  renamedTo?: string;
  renamedRows?: number;
};

/** The add/rename panel form; `target` is the category being edited. */
type CategoryFormState = {
  mode: "create" | "edit";
  target: string;
  name: string;
  description: string;
};

/** Mirrors `NotionConnectionStatus` from lib/notionConnection.ts. */
type NotionConnectionStatus = {
  hasApiKey: boolean;
  dataSourceId: string;
  categoryDataSourceId: string;
  updatedAt: string;
  ready: boolean;
  error?: string;
};

const EMPTY_NOTION_CONNECTION: NotionConnectionStatus = {
  hasApiKey: false,
  dataSourceId: "",
  categoryDataSourceId: "",
  updatedAt: "",
  ready: false
};

type ExpenseChatEditState = "pending" | "applied" | "dismissed";

type ExpenseChatUiEdit = ExpenseChatEdit & {
  state: ExpenseChatEditState;
};

type ExpenseChatUiCategory = CategoryProposal & {
  state: ExpenseChatEditState;
};

/**
 * One approval batch: categories are created before the row edits that use
 * them, so an `Approve all` cannot move rows into a category that does not
 * exist yet.
 */
type ExpenseChatProposals = {
  categories: readonly ExpenseChatUiCategory[];
  edits: readonly ExpenseChatUiEdit[];
};

type ExpenseChatUiMessage = ExpenseChatMessage & {
  id: string;
  edits?: ExpenseChatUiEdit[];
  categories?: ExpenseChatUiCategory[];
};

type ExpenseChatResponse = {
  answer: string;
  edits?: ExpenseChatEdit[];
  categories?: CategoryProposal[];
  context?: {
    rowCount: number;
    selectedRowCount: number;
    totalSpend: number;
    truncated: boolean;
  };
  error?: string;
};

type PendingUpload = {
  statement: ReviewStatement;
  expenses: ExpenseItem[];
  incomes: IncomeItem[];
};

type ExtractionOutcome = {
  name: string;
  rowCount: number;
  month: string | null;
  /** Every month the statement was filed into; more than one when it spans months. */
  months: string[];
  monthFromRows: boolean;
  artifactDir: string;
  error?: string;
};

const CASH_FLOW_GRAPH_TYPES = [
  { value: "flow", label: "Flow" },
  { value: "pie", label: "Pie" },
  { value: "calendar", label: "3D Calendar" }
] as const;

type CashFlowGraphType = (typeof CASH_FLOW_GRAPH_TYPES)[number]["value"];

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const APP_CATEGORY_VISIBILITY_STORAGE_KEY =
  "statement-ledger.include-app-categories";
const APP_CATEGORY_VISIBILITY_STORAGE_EVENT =
  "statement-ledger-include-app-categories";
const REVIEW_HISTORY_STORAGE_EVENT = "statement-ledger-review-history";
const MAX_STATEMENT_FILE_SIZE = 12 * 1024 * 1024;
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
const EMPTY_STATEMENTS: ReviewStatement[] = [];
const EMPTY_EXPENSES: ExpenseItem[] = [];
const EMPTY_INCOMES: IncomeItem[] = [];
const EMPTY_SELECTED_IDS: string[] = [];
const EMPTY_REVIEW_HISTORY: ReviewHistoryEvent[] = [];
let cachedReviewHistoryRaw: string | null | undefined;
let cachedReviewHistorySnapshot: ReviewHistoryEvent[] = EMPTY_REVIEW_HISTORY;
const hydrationSafeIconProps = {
  "aria-hidden": "true",
  suppressHydrationWarning: true
} as const;

type SortKey = "date" | "merchant" | "category" | "amount" | "notes";

type SortState = { key: SortKey; dir: "asc" | "desc" };

/**
 * Seven columns, in reading order. `Merchant` also carries the statement chip
 * and the raw description, so sorting by it sorts by the merchant name; the
 * dropped `statement` and `description` sort keys went with those columns.
 */
const TABLE_SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "merchant", label: "Merchant" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "notes", label: "Notes" }
];

function sortKeyValue(item: ExpenseItem, key: SortKey): string | number {
  switch (key) {
    case "amount":
      return item.amount;
    case "merchant":
      return item.merchant;
    case "category":
      return item.category;
    case "notes":
      return item.notes;
    case "date":
      return item.date;
  }
}

function compareBySortKey(
  a: ExpenseItem,
  b: ExpenseItem,
  key: SortKey,
  direction: 1 | -1
): number {
  const aValue = sortKeyValue(a, key);
  const bValue = sortKeyValue(b, key);

  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * direction;
  }

  return String(aValue).localeCompare(String(bValue)) * direction;
}

const EDIT_FIELD_LABELS: Record<ExpenseEditField, string> = {
  category: "Category",
  merchant: "Merchant",
  description: "Description",
  subcategory: "Subcategory",
  notes: "Notes",
  amount: "Amount",
  reimbursedAmount: "Reimbursed"
};

function formatEditValue(
  field: ExpenseEditField,
  value: string | number,
  currency: string
) {
  if (field === "amount" || field === "reimbursedAmount") {
    return typeof value === "number"
      ? formatCurrency(value, currency)
      : String(value);
  }

  return String(value).trim() || "(empty)";
}

/**
 * The approval cards under an assistant answer. Chat only ever proposes
 * changes - new categories and row edits alike; nothing reaches the catalog or
 * the month documents until one of these buttons is clicked, and a pending
 * card can always be dismissed instead.
 */
function ExpenseChatEditList(props: {
  message: ExpenseChatUiMessage;
  busy: boolean;
  onApprove: (
    messageId: string,
    proposals: ExpenseChatProposals
  ) => void | Promise<void>;
  onDismiss: (messageId: string, proposals: ExpenseChatProposals) => void;
}) {
  const { message, busy, onApprove, onDismiss } = props;
  const edits = message.edits || [];
  const categories = message.categories || [];
  const total = edits.length + categories.length;
  const pending: ExpenseChatProposals = {
    categories: categories.filter((category) => category.state === "pending"),
    edits: edits.filter((edit) => edit.state === "pending")
  };
  const pendingCount = pending.categories.length + pending.edits.length;

  if (total === 0) {
    return null;
  }

  return (
    <div className="expense-chat-edits">
      <div className="expense-chat-edits-heading">
        <span>
          {total === 1 ? "1 suggested change" : `${total} suggested changes`}
        </span>
        {pendingCount > 1 ? (
          <span className="expense-chat-edits-bulk">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onApprove(message.id, pending)}
            >
              <Check size={14} {...hydrationSafeIconProps} />
              Approve all
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDismiss(message.id, pending)}
            >
              <X size={14} {...hydrationSafeIconProps} />
              Dismiss all
            </button>
          </span>
        ) : null}
      </div>
      {categories.map((category) => (
        <div
          className={`expense-chat-edit is-${category.state}`}
          key={category.id}
        >
          <div className="expense-chat-edit-row">
            <span className="expense-chat-edit-target">
              New category · {category.name}
            </span>
            {category.state === "pending" ? (
              <span className="expense-chat-edit-actions">
                <button
                  type="button"
                  className="expense-chat-edit-approve"
                  disabled={busy}
                  title={`Add ${category.name} to the catalog`}
                  onClick={() =>
                    void onApprove(message.id, {
                      categories: [category],
                      edits: []
                    })
                  }
                >
                  <Check size={14} {...hydrationSafeIconProps} />
                  Approve
                </button>
                <button
                  type="button"
                  className="expense-chat-edit-dismiss"
                  disabled={busy}
                  title="Discard this suggestion"
                  onClick={() =>
                    onDismiss(message.id, { categories: [category], edits: [] })
                  }
                >
                  <X size={14} {...hydrationSafeIconProps} />
                  Dismiss
                </button>
              </span>
            ) : (
              <span className="expense-chat-edit-state">
                {category.state === "applied" ? "Added" : "Dismissed"}
              </span>
            )}
          </div>
          {category.description ? (
            <div className="expense-chat-edit-change">
              <span className="expense-chat-edit-field">Description</span>
              <span className="expense-chat-edit-diff">
                <ins>{category.description}</ins>
              </span>
            </div>
          ) : null}
          {category.reason ? (
            <p className="expense-chat-edit-reason">{category.reason}</p>
          ) : null}
        </div>
      ))}
      {edits.map((edit) => (
        <div
          className={`expense-chat-edit is-${edit.state}`}
          key={edit.id}
        >
          <div className="expense-chat-edit-row">
            <span className="expense-chat-edit-target">
              {edit.rowLabel}
              {edit.date ? ` · ${edit.date}` : ""}
              {edit.month ? ` · ${edit.month}` : ""}
            </span>
            {edit.state === "pending" ? (
              <span className="expense-chat-edit-actions">
                <button
                  type="button"
                  className="expense-chat-edit-approve"
                  disabled={busy}
                  title="Apply this change"
                  onClick={() =>
                    void onApprove(message.id, { categories: [], edits: [edit] })
                  }
                >
                  <Check size={14} {...hydrationSafeIconProps} />
                  Approve
                </button>
                <button
                  type="button"
                  className="expense-chat-edit-dismiss"
                  disabled={busy}
                  title="Discard this suggestion"
                  onClick={() =>
                    onDismiss(message.id, { categories: [], edits: [edit] })
                  }
                >
                  <X size={14} {...hydrationSafeIconProps} />
                  Dismiss
                </button>
              </span>
            ) : (
              <span className="expense-chat-edit-state">
                {edit.state === "applied" ? "Applied" : "Dismissed"}
              </span>
            )}
          </div>
          <div className="expense-chat-edit-change">
            <span className="expense-chat-edit-field">
              {EDIT_FIELD_LABELS[edit.field]}
            </span>
            <span className="expense-chat-edit-diff">
              <del>
                {formatEditValue(edit.field, edit.before, edit.currency)}
              </del>
              <ins>
                {formatEditValue(edit.field, edit.after, edit.currency)}
              </ins>
            </span>
          </div>
          {edit.reason ? (
            <p className="expense-chat-edit-reason">{edit.reason}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * One shell, one section. `section` comes from the route (`app/cash-flow`,
 * `app/income`, ...) rather than from component state, so every destination
 * has a URL, the back button works, and a page can be linked to and
 * bookmarked. The shell itself - header bar, nav, notices, the pick-a-month
 * prompt - is identical on every one of them.
 */
export function StatementWorkspace({
  viewer,
  section
}: {
  viewer: Viewer;
  section: SectionId;
}) {
  const [files, setFiles] = useState<File[]>([]);
  // Picking a month in All months lands on that month's review page.
  const router = useRouter();
  // The connection lives on the server, per user. The token is never sent back
  // to the browser, so `apiKeyDraft` is only ever a new value being typed.
  const [notionConnection, setNotionConnection] =
    useState<NotionConnectionStatus>(EMPTY_NOTION_CONNECTION);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [dataSourceId, setDataSourceId] = useState("");
  const [categoryDataSourceId, setCategoryDataSourceId] = useState("");
  const [notionBusy, setNotionBusy] = useState(false);
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [graphZoom, setGraphZoom] = useState(DEFAULT_GRAPH_ZOOM);
  const [sort, setSort] = useState<SortState | null>(null);
  const [cashFlowGraphType, setCashFlowGraphType] =
    useState<CashFlowGraphType>("flow");
  const [busy, setBusy] = useState<"idle" | "extracting" | "saving">("idle");
  const [categoryBusy, setCategoryBusy] = useState<
    "idle" | "loading" | "importing" | "updating"
  >("loading");
  const [categories, setCategories] = useState<ExpenseCategoryDefinition[]>(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  );
  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(
    null
  );
  const [notice, setNotice] = useState<Notice>({
    tone: "neutral",
    message: "Months are saved on this machine."
  });
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [pendingUploadMonth, setPendingUploadMonth] = useState("");
  const [lastSave, setLastSave] = useState<SaveExpensesResult | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ExpenseChatUiMessage[]>([]);
  const settingsState = useSyncExternalStore(
    subscribeToUserSettings,
    readUserSettingsSnapshot,
    readInitialUserSettingsSnapshot
  );
  const categorizationNotes = settingsState.categorizationNotes;
  const cashFlowEntries = settingsState.cashFlowEntries;
  const appCategoriesPreference = useSyncExternalStore(
    subscribeToAppCategoryVisibilityPreference,
    readAppCategoryVisibilityPreference,
    () => null
  );
  const monthsState = useSyncExternalStore(
    subscribeToMonths,
    readMonthsSnapshot,
    readInitialMonthsSnapshot
  );
  const reviewHistory = useSyncExternalStore(
    subscribeToReviewHistory,
    readReviewHistorySnapshot,
    readEmptyReviewHistorySnapshot
  );
  const settingsError = settingsState.error;
  const monthDocument = monthsState.document;
  const activeMonth = monthsState.activeMonth;
  const months = monthsState.months;
  const monthsLoading = monthsState.status === "loading";
  const statements = monthDocument?.statements || EMPTY_STATEMENTS;
  const items = monthDocument?.expenses || EMPTY_EXPENSES;
  const incomes = monthDocument?.incomes || EMPTY_INCOMES;
  const monthSelectedIds = monthDocument?.selectedIds || EMPTY_SELECTED_IDS;
  const lastReviewHistoryEvent =
    reviewHistory[reviewHistory.length - 1] || null;
  const selectedIds = useMemo(
    () => new Set(monthSelectedIds),
    [monthSelectedIds]
  );
  const monthIndex = months.findIndex((entry) => entry.month === activeMonth);
  const previousMonth = monthIndex > 0 ? months[monthIndex - 1].month : "";
  const nextMonth =
    monthIndex >= 0 && monthIndex < months.length - 1
      ? months[monthIndex + 1].month
      : "";
  const statementById = useMemo(
    () => new Map(statements.map((statement) => [statement.id, statement])),
    [statements]
  );
  const activeStatement =
    statementById.get(monthDocument?.activeStatementId || "") ||
    statements[0] ||
    null;
  const activeStatementId = activeStatement?.id || "";
  const activeStatementSummary = activeStatement?.statement || EMPTY_STATEMENT;
  const sourceFileName = activeStatement?.sourceFileName || "";
  const firstPendingUpload = pendingUploads[0] || null;
  const pendingMonth = pendingUploadMonth || activeMonth;
  const selectedFilesTotalSize = files.reduce(
    (total, selectedFile) => total + selectedFile.size,
    0
  );
  // The chip only ever describes the files staged right now. A restored month
  // is not a pending upload, so it must not look like one.
  const uploadLabel =
    files.length > 1
      ? `${files.length} files`
      : files[0]?.name || "Choose file(s)";
  const uploadSizeLabel =
    files.length > 1
      ? `${formatBytes(selectedFilesTotalSize)} total`
      : files[0]
        ? formatBytes(files[0].size)
        : "PDF or CSV";

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );
  const [calendarDateFilter, setCalendarDateFilter] = useState("");
  const activeCalendarDateFilter = cashFlowGraphType === "calendar" && calendarDateFilter.startsWith(`${activeMonth}-`) ? calendarDateFilter : "";
  const categoryFilterSet = useMemo(
    () => new Set(categoryFilters),
    [categoryFilters]
  );
  const visibleItems = useMemo(() => {
    const filtered = items.filter(item =>
      (categoryFilterSet.size === 0 || categoryFilterSet.has(item.category)) &&
      (!activeCalendarDateFilter || item.date === activeCalendarDateFilter)
    );

    if (!sort) {
      return filtered;
    }

    const direction = sort.dir === "asc" ? 1 : -1;

    // Display-only ordering; the month document keeps its stored order.
    return [...filtered].sort((a, b) =>
      compareBySortKey(a, b, sort.key, direction)
    );
  }, [categoryFilterSet, items, sort, activeCalendarDateFilter]);
  const visibleSelectedItems = useMemo(
    () => visibleItems.filter((item) => selectedIds.has(item.id)),
    [selectedIds, visibleItems]
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
    () => summarizeCashFlow(cashFlowEntries, items, incomes),
    [cashFlowEntries, items, incomes]
  );
  const totalAmount = selectedItems.reduce((sum, item) => sum + item.amount, 0);
  const totalNetAmount = selectedItems.reduce(
    (sum, item) => sum + item.amount - item.reimbursedAmount,
    0
  );
  const incomeTotal = incomes.reduce((sum, income) => sum + income.amount, 0);
  const currency =
    activeStatementSummary.currency || items[0]?.currency || "USD";
  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleItems.every((item) => selectedIds.has(item.id));
  const notionCategoryCount = categories.filter(
    (category) => category.source === "notion"
  ).length;
  const appCategoryCount = categories.filter(
    (category) => category.source === "app"
  ).length;
  const hasNotionCategories = hasActiveNotionCategories(categories);
  const includeAppCategories = resolveIncludeAppCategories(
    categories,
    appCategoriesPreference
  );
  const activeCategories = useMemo(
    () => selectActiveCategories(categories, appCategoriesPreference),
    [appCategoriesPreference, categories]
  );
  const enabledCategoryNames = useMemo(
    () => getEnabledCategoryNames(activeCategories),
    [activeCategories]
  );
  const bulkCategoryOptions = useMemo(
    () => enabledCategoryOptions(activeCategories),
    [activeCategories]
  );
  const categoryFilterOptions = useMemo(
    () => categoryFilterOptionsForItems(items, activeCategories),
    [activeCategories, items]
  );
  const controlsDisabled = busy !== "idle" || categoryBusy !== "idle";
  const activeNotice =
    monthsNotice(monthsState) ||
    (settingsError ? { tone: "error" as const, message: settingsError } : null) ||
    notice;

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

          if (result.importError) {
            showNotice({
              tone: "neutral",
              message: `Notion category import failed. ${result.importError}`
            });
          } else if (result.imported) {
            showNotice({
              tone: "neutral",
              message: `Imported ${result.imported} Notion categories.`
            });
          }
        }
      } catch {
        if (active) {
          showNotice({
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

  useEffect(() => {
    let active = true;

    async function loadNotionConnection() {
      try {
        const response = await fetch("/api/notion/connection");
        const result = (await response.json()) as NotionConnectionStatus;

        if (!response.ok) {
          throw new Error(result.error || "Loading the connection failed.");
        }

        if (active) {
          applyNotionConnection(result);
        }
      } catch {
        // A missing connection is the normal state for a new account; the panel
        // already reads as "not connected" without an extra error notice.
      }
    }

    loadNotionConnection();

    return () => {
      active = false;
    };
  }, []);

  function applyNotionConnection(status: NotionConnectionStatus) {
    setNotionConnection(status);
    setDataSourceId(status.dataSourceId);
    setCategoryDataSourceId(status.categoryDataSourceId);
    setApiKeyDraft("");
  }

  async function saveNotionConnection() {
    setNotionBusy(true);

    try {
      const response = await fetch("/api/notion/connection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Omitted rather than blank: an empty draft means "keep the stored
          // token", not "clear it".
          apiKey: apiKeyDraft.trim() ? apiKeyDraft.trim() : undefined,
          dataSourceId,
          categoryDataSourceId
        })
      });
      const result = (await response.json()) as NotionConnectionStatus;

      if (!response.ok) {
        throw new Error(result.error || "Saving the connection failed.");
      }

      applyNotionConnection(result);
      showNotice({
        tone: result.ready ? "success" : "neutral",
        message: result.ready
          ? "Notion connection saved."
          : "Notion connection saved. Add an integration token and expenses data source ID to save rows."
      });
    } catch (error) {
      showNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Saving the connection failed."
      });
    } finally {
      setNotionBusy(false);
    }
  }

  async function disconnectNotion() {
    setNotionBusy(true);

    try {
      const response = await fetch("/api/notion/connection", {
        method: "DELETE"
      });
      const result = (await response.json()) as NotionConnectionStatus;

      if (!response.ok) {
        throw new Error(result.error || "Disconnecting failed.");
      }

      applyNotionConnection(result);
      showNotice({ tone: "neutral", message: "Notion connection removed." });
    } catch (error) {
      showNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Disconnecting failed."
      });
    } finally {
      setNotionBusy(false);
    }
  }

  async function extractStatement() {
    if (files.length === 0) {
      showNotice({
        tone: "error",
        message: "Choose a PDF or CSV statement first."
      });
      return;
    }

    const oversizedNames = files
      .filter((selectedFile) => selectedFile.size > MAX_STATEMENT_FILE_SIZE)
      .map((selectedFile) => selectedFile.name);
    const queue = files.filter(
      (selectedFile) => selectedFile.size <= MAX_STATEMENT_FILE_SIZE
    );

    if (queue.length === 0) {
      showNotice({
        tone: "error",
        message: "Statement file is too large. The current limit is 12 MB."
      });
      return;
    }

    setBusy("extracting");
    setLastSave(null);
    showNotice({ tone: "neutral", message: "Extracting statement rows..." });

    // Files are extracted one request at a time so each stays under the 12 MB
    // body limit and the 90s function cap, failures stay per-file, and the
    // months store is only ever mutated by one filing at a time.
    const outcomes: ExtractionOutcome[] = [];

    try {
      for (const [index, statementFile] of queue.entries()) {
        if (queue.length > 1) {
          showNotice({
            tone: "neutral",
            message: `Extracting ${index + 1} of ${queue.length}: ${statementFile.name}...`
          });
        }

        try {
          const formData = new FormData();
          formData.append("statementFile", statementFile);

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
          const plan = await loadExtraction(
            extractionResult.extraction,
            extractionResult.artifact?.fileName || statementFile.name
          );

          outcomes.push({
            name: statementFile.name,
            rowCount: extractionResult.extraction.expenses.length,
            month: plan?.month ?? null,
            months: plan?.segments.map((segment) => segment.month) || [],
            monthFromRows: plan?.source === "rows",
            artifactDir: extractionResult.artifact?.dir || ""
          });
        } catch (error) {
          outcomes.push({
            name: statementFile.name,
            rowCount: 0,
            month: null,
            months: [],
            monthFromRows: false,
            artifactDir: "",
            error: error instanceof Error ? error.message : "Extraction failed."
          });
        }
      }

      showNotice(extractionNotice(outcomes, oversizedNames));
    } finally {
      // Uploaded files are consumed: the statement now lives in the month
      // document, so nothing is left staged to extract again.
      setFiles([]);
      setBusy("idle");
    }
  }

  async function saveToNotion() {
    if (!selectedItems.length) {
      showNotice({ tone: "error", message: "Select at least one row." });
      return;
    }

    setBusy("saving");
    setLastSave(null);
    showNotice({ tone: "neutral", message: "Saving selected rows..." });

    try {
      const response = await fetch("/api/notion/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceFileName:
            sourceFileName || files[0]?.name || "sample-statement.pdf",
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

      const unmatchedCategories: string[] = Array.isArray(
        result.unmatchedCategories
      )
        ? result.unmatchedCategories
        : [];

      showNotice({
        tone: unmatchedCategories.length ? "neutral" : "success",
        message: unmatchedCategories.length
          ? `Saved ${result.saved} rows to Notion. No Notion category matched: ${unmatchedCategories.join(
              ", "
            )} - those rows have an empty Category.`
          : `Saved ${result.saved} rows to Notion.`
      });
    } catch (error) {
      showNotice({
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

    if (months.length === 0) {
      showNotice({
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
      // The server reads every filed month itself, so only the pointers it
      // cannot derive are sent. Pending edits flush first or the ledger it
      // reads is one behind what the reviewer is looking at.
      await flushMonths();
      const response = await fetch("/api/expense-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question,
          selectedExpenseIds: [...selectedIds],
          history,
          view: {
            scope: section === "all" ? "all" : "month",
            activeMonth
          },
          includeAppCategories
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
          content: result.answer,
          edits: (result.edits || []).map((edit) => ({
            ...edit,
            state: "pending" as const
          })),
          categories: (result.categories || []).map((category) => ({
            ...category,
            state: "pending" as const
          }))
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
      showNotice({ tone: "error", message });
    } finally {
      setChatBusy(false);
    }
  }

  function resolveChatProposals(
    messageId: string,
    proposals: ExpenseChatProposals,
    state: ExpenseChatEditState
  ) {
    setChatMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              edits: message.edits?.map((edit) =>
                proposals.edits.some((resolved) => resolved.id === edit.id)
                  ? { ...edit, state }
                  : edit
              ),
              categories: message.categories?.map((category) =>
                proposals.categories.some(
                  (resolved) => resolved.id === category.id
                )
                  ? { ...category, state }
                  : category
              )
            }
          : message
      )
    );
  }

  /**
   * Categories are created first: a row edit approved in the same batch names
   * one of them, so creating them afterwards would leave the catalog missing
   * the category the rows were just moved into.
   */
  async function approveChatProposals(
    messageId: string,
    proposals: ExpenseChatProposals
  ) {
    resolveChatProposals(messageId, proposals, "applied");

    const failedCategories: ExpenseChatUiCategory[] = [];
    let created = 0;

    if (proposals.categories.length > 0) {
      setCategoryBusy("updating");

      for (const proposal of proposals.categories) {
        try {
          const response = await fetch("/api/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: proposal.name,
              description: proposal.description
            })
          });
          const result = (await response.json()) as CategoryResponse;

          if (!response.ok) {
            throw new Error(result.error || "Creating the category failed.");
          }

          setCategories(result.categories);
          created += 1;
        } catch {
          failedCategories.push(proposal);
        }
      }

      setCategoryBusy("idle");
    }

    if (failedCategories.length > 0) {
      // Back to pending rather than silently "Added": the catalog does not
      // hold them, so the reviewer has to be able to retry the card.
      resolveChatProposals(
        messageId,
        { categories: failedCategories, edits: [] },
        "pending"
      );
    }

    const applied =
      proposals.edits.length > 0 ? await applyExpenseEdits(proposals.edits) : 0;
    const requested = proposals.categories.length + proposals.edits.length;
    const succeeded = created + applied;

    showNotice(
      succeeded === requested
        ? {
            tone: "success",
            message: `Applied ${succeeded} ${
              succeeded === 1 ? "change" : "changes"
            } from the chat.`
          }
        : {
            tone: "error",
            message: `Applied ${succeeded} of ${requested} ${
              requested === 1 ? "change" : "changes"
            } from the chat.${
              failedCategories.length > 0
                ? ` ${failedCategories
                    .map((category) => category.name)
                    .join(", ")} could not be created.`
                : " Check the months they landed in."
            }`
          }
    );
  }

  function dismissChatProposals(
    messageId: string,
    proposals: ExpenseChatProposals
  ) {
    resolveChatProposals(messageId, proposals, "dismissed");
  }

  async function importCategories() {
    setCategoryBusy("importing");
    showNotice({ tone: "neutral", message: "Importing categories..." });

    try {
      const response = await fetch("/api/categories/import", {
        method: "POST"
      });
      const result = (await response.json()) as CategoryResponse;

      if (!response.ok) {
        throw new Error(result.error || "Category import failed.");
      }

      setCategories(result.categories);
      showNotice({
        tone: "success",
        message: `Imported ${result.imported || 0} categories.`
      });
    } catch (error) {
      showNotice({
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
      showNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Category update failed."
      });
    } finally {
      setCategoryBusy("idle");
    }
  }

  function openCategoryForm(category?: ExpenseCategoryDefinition) {
    setCategoryForm(
      category
        ? {
            mode: "edit",
            target: category.name,
            name: category.name,
            description: category.description
          }
        : { mode: "create", target: "", name: "", description: "" }
    );
  }

  async function submitCategoryForm() {
    const form = categoryForm;

    if (!form) {
      return;
    }

    const name = form.name.trim();
    const description = form.description.trim();

    if (!name) {
      showNotice({ tone: "error", message: "A category needs a name." });
      return;
    }

    setCategoryBusy("updating");

    try {
      if (form.mode === "edit") {
        // A rename cascades to every stored row, so pending month writes have
        // to land first: a debounced flush afterwards would write the old
        // category name back onto the active month.
        await flushMonths();
      }

      const response =
        form.mode === "create"
          ? await fetch("/api/categories", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, description })
            })
          : await fetch("/api/categories", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: form.target, newName: name, description })
            });
      const result = (await response.json()) as CategoryResponse;

      if (!response.ok) {
        throw new Error(
          result.error ||
            (form.mode === "create"
              ? "Creating the category failed."
              : "Category update failed.")
        );
      }

      setCategories(result.categories);
      setCategoryForm(null);

      if (form.mode === "create") {
        showNotice({ tone: "success", message: `Added ${name}.` });
        return;
      }

      if (result.renamedFrom && result.renamedTo) {
        renameActiveMonthCategory(result.renamedFrom, result.renamedTo);
        showNotice({
          tone: "success",
          message: `Renamed ${result.renamedFrom} to ${result.renamedTo}${
            result.renamedRows
              ? ` and updated ${result.renamedRows} ${
                  result.renamedRows === 1 ? "row" : "rows"
                }`
              : ""
          }.`
        });
        return;
      }

      showNotice({ tone: "success", message: `Saved ${name}.` });
    } catch (error) {
      showNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Category update failed."
      });
    } finally {
      setCategoryBusy("idle");
    }
  }

  /**
   * The server renamed the rows it has stored; the active month is held in
   * memory optimistically, so it has to be renamed here too.
   */
  function renameActiveMonthCategory(from: string, to: string) {
    const normalized = from.trim().toLowerCase();
    const matches = (item: ExpenseItem) =>
      item.category.trim().toLowerCase() === normalized;

    if (!items.some(matches)) {
      return;
    }

    updateActiveMonth({
      expenses: items.map((item) =>
        matches(item) ? { ...item, category: to } : item
      )
    });
  }

  async function deleteCategory(name: string) {
    if (
      !window.confirm(
        `Remove ${name}? Rows already using it keep the name until you recategorize them.`
      )
    ) {
      return;
    }

    setCategoryBusy("updating");

    try {
      const response = await fetch(
        `/api/categories?name=${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      const result = (await response.json()) as CategoryResponse;

      if (!response.ok) {
        throw new Error(result.error || "Removing the category failed.");
      }

      setCategories(result.categories);
      setCategoryForm((current) =>
        current && current.target === name ? null : current
      );
      showNotice({ tone: "success", message: `Removed ${name}.` });
    } catch (error) {
      showNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Removing the category failed."
      });
    } finally {
      setCategoryBusy("idle");
    }
  }

  function toggleAppCategoryVisibility(enabled: boolean) {
    if (!writeAppCategoryVisibilityPreference(enabled)) {
      showNotice({
        tone: "error",
        message: "APP category preference could not be saved in this browser."
      });
    }
  }

  function showNotice(next: Notice) {
    clearMonthsNotice();
    setNotice(next);
  }

  function writeMonthState(next: Parameters<typeof updateActiveMonth>[0]) {
    if (!updateActiveMonth(next)) {
      showNotice({
        tone: "error",
        message: "Upload a statement to start a month first."
      });
      return false;
    }

    return true;
  }

  function writeReviewHistoryState(
    nextHistory: readonly ReviewHistoryEvent[]
  ) {
    return writeStoredReviewHistory(nextHistory);
  }

  function recordBulkCategoryUndo(
    label: string,
    changedItems: readonly ExpenseItem[],
    category: ExpenseCategory
  ) {
    const event = createBulkCategoryHistoryEvent({
      id: createClientId("review-history"),
      label,
      changes: changedItems.map((item) => ({
        itemId: item.id,
        before: { category: item.category },
        after: { category }
      }))
    });

    return writeReviewHistoryState(
      pushReviewHistoryEvent(readReviewHistorySnapshot(), event)
    );
  }

  /** Returns null when the month could not be determined, which parks the upload. */
  async function loadExtraction(
    nextExtraction: StatementExtraction,
    nextSourceFileName = ""
  ) {
    const statementId = createClientId("statement");
    const statementItems = createStatementExpenses(
      statementId,
      nextExtraction.expenses
    );
    const statementIncomes = nextExtraction.incomes.map((income, index) => ({
      ...income,
      id: `${statementId}-income-${index + 1}-${income.id}`,
      statementId
    }));
    const statement = createReviewStatement({
      id: statementId,
      statement: nextExtraction.statement,
      sourceFileName: nextSourceFileName,
      monthSource: "manual"
    });
    const plan = planStatementFiling({
      statement,
      expenses: statementItems,
      incomes: statementIncomes
    });

    if (!plan.month || plan.segments.length === 0) {
      // Parked statements queue up so a batch upload never drops one.
      setPendingUploads((current) => [
        ...current,
        {
          statement,
          expenses: statementItems,
          incomes: statementIncomes
        }
      ]);
      return null;
    }

    await fileStatementSegments({
      segments: plan.segments,
      primaryMonth: plan.month
    });

    return plan;
  }

  async function filePendingUpload() {
    const pendingUpload = pendingUploads[0];

    if (!pendingUpload) {
      return;
    }

    const month = pendingUploadMonth || activeMonth;

    if (!isMonthKey(month)) {
      showNotice({ tone: "error", message: "Choose a month first." });
      return;
    }

    await fileStatement({
      month,
      statement: pendingUpload.statement,
      expenses: pendingUpload.expenses,
      incomes: pendingUpload.incomes
    });
    setPendingUploads((current) => current.slice(1));
    if (pendingUploads.length <= 1) {
      setPendingUploadMonth("");
    }
    showNotice({
      tone: "success",
      message: `Filed ${formatStatementTitle(
        pendingUpload.statement
      )} into ${formatMonthLabel(month)}.`
    });
  }

  function discardPendingUpload() {
    setPendingUploads((current) => current.slice(1));
    if (pendingUploads.length <= 1) {
      setPendingUploadMonth("");
    }
    showNotice({ tone: "neutral", message: "Upload discarded." });
  }

  async function changeStatementMonth(statementId: string, month: string) {
    if (!isMonthKey(month) || month === activeMonth) {
      return;
    }

    const statement = statementById.get(statementId);

    await reassignStatement({ statementId, month });
    showNotice({
      tone: "success",
      message: `Moved ${formatStatementTitle(statement)} to ${formatMonthLabel(
        month
      )}.`
    });
  }

  function updateStatement<K extends keyof StatementSummary>(
    key: K,
    value: StatementSummary[K]
  ) {
    if (!activeStatement) {
      return;
    }

    writeMonthState({
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

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, dir: "asc" };
      }

      return current.dir === "asc" ? { key, dir: "desc" } : null;
    });
  }

  function updateItem(id: string, patch: Partial<ExpenseItem>) {
    writeMonthState({
      expenses: items.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      )
    });
  }

  function recategorizeSelected(category: ExpenseCategory) {
    const targetSelectedItems = visibleSelectedItems;
    const changedItems = targetSelectedItems.filter(
      (item) => item.category !== category
    );
    const changedItemIds = new Set(changedItems.map((item) => item.id));
    const changedCount = changedItems.length;

    if (targetSelectedItems.length === 0) {
      showNotice({
        tone: "error",
        message:
          categoryFilters.length > 0
            ? "Select at least one visible row."
            : "Select at least one row."
      });
      return;
    }

    if (changedCount === 0) {
      showNotice({
        tone: "neutral",
        message:
          categoryFilters.length > 0
            ? `Visible selected rows already use ${category}.`
            : `Selected rows already use ${category}.`
      });
      return;
    }

    if (
      !writeMonthState({
        expenses: items.map((item) =>
          changedItemIds.has(item.id) ? { ...item, category } : item
        )
      })
    ) {
      return;
    }

    const label = `Set ${changedCount} ${
      changedCount === 1 ? "row" : "rows"
    } to ${category}`;
    const undoSaved = recordBulkCategoryUndo(label, changedItems, category);

    showNotice({
      tone: undoSaved ? "success" : "neutral",
      message: undoSaved
        ? `Updated ${changedCount} ${
            changedCount === 1 ? "row" : "rows"
          } to ${category}.`
        : `Updated ${changedCount} ${
            changedCount === 1 ? "row" : "rows"
          } to ${category}. Undo could not be saved.`
    });
  }

  function undoLastItemChange() {
    if (!lastReviewHistoryEvent) {
      showNotice({ tone: "error", message: "Nothing to undo." });
      return;
    }

    const result = undoReviewHistoryEvent(items, lastReviewHistoryEvent);
    const nextHistory = reviewHistory.slice(0, -1);

    if (result.restoredCount === 0) {
      writeReviewHistoryState(nextHistory);
      showNotice({
        tone: "error",
        message: "Nothing to undo for those rows."
      });
      return;
    }

    if (!writeMonthState({ expenses: result.items })) {
      return;
    }

    const historyUpdated = writeReviewHistoryState(nextHistory);
    const missingMessage =
      result.missingCount > 0
        ? ` ${result.missingCount} missing ${
            result.missingCount === 1 ? "row was" : "rows were"
          } skipped.`
        : "";

    showNotice({
      tone: historyUpdated ? "success" : "error",
      message: historyUpdated
        ? `Undid ${lastReviewHistoryEvent.label}.${missingMessage}`
        : `Undid ${lastReviewHistoryEvent.label}, but history could not be cleared.`
    });
  }

  function addCategoryFilter(category: string) {
    if (!category) {
      return;
    }

    setCategoryFilters((current) =>
      current.includes(category) ? current : [...current, category]
    );
  }

  function removeCategoryFilter(category: string) {
    setCategoryFilters((current) =>
      current.filter((currentCategory) => currentCategory !== category)
    );
  }

  function clearCategoryFilters() {
    setCategoryFilters([]);
  }

  function updateGraphZoom(direction: "in" | "out") {
    setGraphZoom((current) => nextGraphZoomLevel(current, direction));
  }

  function resetGraphZoom() {
    setGraphZoom(DEFAULT_GRAPH_ZOOM);
  }
  function toggleItem(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    writeMonthState({ selectedIds: next });
  }

  function toggleAll() {
    if (visibleItems.length === 0) {
      return;
    }

    const visibleItemIds = new Set(visibleItems.map((item) => item.id));
    const nextSelectedIds = new Set(selectedIds);

    if (allVisibleSelected) {
      visibleItemIds.forEach((id) => nextSelectedIds.delete(id));
    } else {
      visibleItemIds.forEach((id) => nextSelectedIds.add(id));
    }

    writeMonthState({
      selectedIds: nextSelectedIds
    });
  }

  function activateStatement(statementId: string) {
    if (!statementById.has(statementId)) {
      return;
    }

    writeMonthState({ activeStatementId: statementId });
  }

  function selectStatementRows(statementId: string) {
    const rowIds = items
      .filter((item) => item.statementId === statementId)
      .map((item) => item.id);
    const statement = statementById.get(statementId);

    if (rowIds.length === 0) {
      showNotice({ tone: "error", message: "No rows for that statement." });
      return;
    }

    writeMonthState({
      selectedIds: new Set([...selectedIds, ...rowIds]),
      activeStatementId: statementId
    });
    showNotice({
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

    writeMonthState({
      selectedIds: nextSelectedIds,
      activeStatementId: statementId
    });
    showNotice({
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

    writeMonthState({
      statements: nextStatements,
      expenses: items.filter((item) => item.statementId !== statementId),
      selectedIds: [...selectedIds].filter((id) => !rowIds.has(id)),
      activeStatementId:
        activeStatementId === statementId
          ? nextStatements[0]?.id || ""
          : activeStatementId
    });
    showNotice({
      tone: "neutral",
      message: `Removed ${rowIds.size} rows from ${formatStatementTitle(
        statement
      )}.`
    });
  }

  function addIncome() {
    const income: IncomeItem = {
      id: crypto.randomUUID(),
      statementId: activeStatementId,
      date: new Date().toISOString().slice(0, 10),
      source: "",
      amount: 0,
      currency,
      kind: "other",
      confidence: 0.7,
      notes: ""
    };

    writeMonthState({ incomes: [income, ...incomes] });
  }

  function updateIncome(id: string, patch: Partial<IncomeItem>) {
    writeMonthState({
      incomes: incomes.map((income) =>
        income.id === id ? { ...income, ...patch } : income
      )
    });
  }

  function removeIncome(id: string) {
    writeMonthState({ incomes: incomes.filter((income) => income.id !== id) });
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
      reimbursedAmount: 0,
      currency,
      category: getDefaultCategoryName(enabledCategoryNames),
      subcategory: "",
      paymentMethod: "unknown",
      statementSection: "purchase",
      confidence: 0.7,
      notes: ""
    };

    writeMonthState({
      statements: activeStatement ? statements : [...statements, targetStatement],
      expenses: [row, ...items],
      selectedIds: new Set([id, ...selectedIds]),
      activeStatementId: targetStatementId
    });
  }

  function removeRow(id: string) {
    const nextSelectedIds = new Set(selectedIds);
    nextSelectedIds.delete(id);

    writeMonthState({
      expenses: items.filter((item) => item.id !== id),
      selectedIds: nextSelectedIds
    });
  }

  return (
    <main className="app-shell" data-section={section}>
      <header className="app-header">
        <div className="brand-lockup">
          <Link className="brand-mark" href="/" title="Any Statement">
            AS
          </Link>
          <div className="brand-title">
            <p className="eyebrow">Any Statement</p>
            <h1>{sectionTitle(section)}</h1>
          </div>
        </div>

                <section className="header-month" aria-label="Active month">
          <div className="month-stepper">
            <button
              className="mini-icon-button"
              type="button"
              title="Previous month"
              aria-label="Previous month"
              disabled={!previousMonth || monthsLoading}
              onClick={() => void selectMonth(previousMonth)}
            >
              <ChevronLeft size={16} {...hydrationSafeIconProps} />
            </button>
            <div className="month-stepper-label">
              <strong>
                {activeMonth
                    ? formatMonthLabel(activeMonth)
                    : monthsLoading
                      ? "Loading months"
                      : "No months yet"}
              </strong>
              <small>
                {activeMonth
                    ? `${statements.length} ${
                        statements.length === 1 ? "statement" : "statements"
                      } / ${items.length} rows`
                    : "Upload a statement to start one"}
              </small>
            </div>
            <button
              className="mini-icon-button"
              type="button"
              title="Next month"
              aria-label="Next month"
              disabled={!nextMonth || monthsLoading}
              onClick={() => void selectMonth(nextMonth)}
            >
              <ChevronRight size={16} {...hydrationSafeIconProps} />
            </button>
          </div>
        </section>

        <div className="header-upload">
          <label className="header-file" htmlFor="statement-upload">
            <Upload size={16} {...hydrationSafeIconProps} />
            <span>{uploadLabel}</span>
            <small>{uploadSizeLabel}</small>
          </label>
          <input
            id="statement-upload"
            className="visually-hidden"
            type="file"
            multiple
            accept="application/pdf,text/csv,.pdf,.csv"
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
              // Reset so picking the same files again still fires onChange.
              event.target.value = "";
            }}
          />
          <button
            className="primary-button header-extract"
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
          <ThemeToggle />
          <AuthStatus viewer={viewer} />
        </div>
      </header>

      <AppNav />

      <div className="app-content">
        <div className={`notice ${activeNotice.tone}`} role="status">
          {activeNotice.tone === "error" ? (
            <AlertTriangle size={16} {...hydrationSafeIconProps} />
          ) : activeNotice.tone === "success" ? (
            <Check size={16} {...hydrationSafeIconProps} />
          ) : (
            <FileText size={16} {...hydrationSafeIconProps} />
          )}
          <span>{activeNotice.message}</span>
          {lastSave?.pages[0]?.url ? (
            <a href={lastSave.pages[0].url} target="_blank" rel="noreferrer">
              Open first page
            </a>
          ) : null}
        </div>

        {/* Filing an undated statement blocks everything downstream, so this
            panel follows the reviewer into whichever section they are in. */}
        {firstPendingUpload ? (
          <section className="panel month-prompt-panel">
            <div className="panel-heading">
              <CalendarRange size={18} {...hydrationSafeIconProps} />
              <h2>
                Pick a month
                {pendingUploads.length > 1
                  ? ` (${pendingUploads.length} left)`
                  : ""}
              </h2>
            </div>
            <p className="month-prompt-copy">
              {formatStatementTitle(firstPendingUpload.statement)} has no
              usable statement period and no usable row dates. Choose the
              month it belongs to.
            </p>
            <label className="field">
              <span>Month</span>
              <input
                type="month"
                value={pendingMonth}
                onChange={(event) => setPendingUploadMonth(event.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              title="File this statement"
              disabled={!isMonthKey(pendingMonth)}
              onClick={() => void filePendingUpload()}
            >
              <CalendarRange size={18} {...hydrationSafeIconProps} />
              File statement
            </button>
            <button
              className="filter-clear-button"
              type="button"
              onClick={discardPendingUpload}
            >
              Discard
            </button>
          </section>
        ) : null}

        {section === "review" ? (
          <section className="workspace" aria-label="Expense review table">
            <div className="workspace-top">
          <div>
            <p className="eyebrow">
              {activeMonth ? formatMonthLabel(activeMonth) : "Review queue"}
            </p>
            <h2>
              {statements.length > 1
                ? "Combined review"
                : activeStatementSummary.institution || "Review queue"}
            </h2>
          </div>

          <div className="stats-strip">
            <Stat
              label="Rows"
              value={
                categoryFilters.length > 0
                  ? `${visibleItems.length}/${items.length}`
                  : String(items.length)
              }
            />
            <Stat label="Statements" value={String(statements.length)} />
            <Stat label="Selected" value={String(selectedItems.length)} />
            <Stat label="Amount" value={formatCurrency(totalAmount, currency)} />
            <Stat
              label="Net"
              value={formatCurrency(totalNetAmount, currency)}
            />
            <Stat
              label="Income"
              value={formatCurrency(incomeTotal, currency)}
            />
          </div>
        </div>

            <div className="table-actions">
          <button
            className="icon-button"
            type="button"
            title={
              allVisibleSelected
                ? "Clear visible selection"
                : "Select visible rows"
            }
            disabled={visibleItems.length === 0}
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
          <button
            className="icon-button"
            type="button"
            title={
              lastReviewHistoryEvent
                ? `Undo: ${lastReviewHistoryEvent.label}`
                : "Nothing to undo"
            }
            aria-label={
              lastReviewHistoryEvent
                ? `Undo ${lastReviewHistoryEvent.label}`
                : "Nothing to undo"
            }
            disabled={!lastReviewHistoryEvent || controlsDisabled}
            onClick={undoLastItemChange}
          >
            <Undo2 size={18} {...hydrationSafeIconProps} />
          </button>
          <label className="bulk-category-control">
            <Tags size={16} {...hydrationSafeIconProps} />
            <select
              value=""
              aria-label="Category for visible selected rows"
              disabled={visibleSelectedItems.length === 0 || controlsDisabled}
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
          <label className="category-filter-control">
            <ListFilter size={16} {...hydrationSafeIconProps} />
            <select
              value=""
              aria-label="Filter rows by category"
              disabled={items.length === 0}
              onChange={(event) => addCategoryFilter(event.target.value)}
            >
              <option value="">Filter category</option>
              {categoryFilterOptions.map((category) => (
                <option
                  key={category.name}
                  value={category.name}
                  disabled={categoryFilterSet.has(category.name)}
                >
                  {category.name} ({category.count})
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
          {activeCalendarDateFilter ? <button type="button" className="category-filter-chip" onClick={() => setCalendarDateFilter("")} aria-label="Clear day filter">
            {activeCalendarDateFilter}<X size={13} {...hydrationSafeIconProps} />
          </button> : null}
          {categoryFilters.length > 0 ? (
            <div className="category-filter-chips" aria-label="Active filters">
              {categoryFilters.map((category) => (
                <button
                  className="category-filter-chip"
                  type="button"
                  key={category}
                  title={`Remove ${category} filter`}
                  onClick={() => removeCategoryFilter(category)}
                >
                  <span>{category}</span>
                  <X size={13} {...hydrationSafeIconProps} />
                </button>
              ))}
              <button
                className="filter-clear-button"
                type="button"
                title="Clear category filters"
                onClick={clearCategoryFilters}
              >
                Clear
              </button>
            </div>
          ) : null}
          <span>{currencyNames.of(currency) || currency}</span>
        </div>

            <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th aria-label="Selected" />
                {TABLE_SORT_COLUMNS.map((column) => {
                  const activeSort =
                    sort && sort.key === column.key ? sort : null;

                  return (
                    <th
                      key={column.key}
                      aria-sort={
                        activeSort
                          ? activeSort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      <button
                        className="sort-header"
                        type="button"
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.label}
                        {activeSort ? (
                          activeSort.dir === "asc" ? (
                            <ChevronUp size={13} {...hydrationSafeIconProps} />
                          ) : (
                            <ChevronDown
                              size={13}
                              {...hydrationSafeIconProps}
                            />
                          )
                        ) : null}
                      </button>
                    </th>
                  );
                })}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      {monthsLoading
                        ? "Loading this month..."
                        : months.length === 0
                          ? "No months yet. Upload a statement and it is filed into the month it covers."
                          : "No expense rows in this month. Re-upload the statement file and inspect the saved artifact directory shown above."}
                    </div>
                  </td>
                </tr>
              ) : null}
              {items.length > 0 && visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      No rows match the active filters.
                    </div>
                  </td>
                </tr>
              ) : null}
              {visibleItems.map((item) => (
                <tr key={item.id}>
                  <td data-label="Selected">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      aria-label={`Select ${item.merchant || item.description}`}
                    />
                  </td>
                  <td data-label="Date">
                    <input
                      type="date"
                      value={item.date}
                      aria-label={`Date for ${item.merchant || item.description}`}
                      onChange={(event) =>
                        updateItem(item.id, { date: event.target.value })
                      }
                    />
                  </td>
                  {/* Merchant on top, then the row's provenance and the raw
                      statement text on one quieter line: three columns folded
                      into the width of one, which is most of what made the
                      table 1600px wide. */}
                  <td data-label="Merchant">
                    <div className="row-merchant">
                      <input
                        className="row-merchant-name"
                        value={item.merchant}
                        aria-label="Merchant"
                        onChange={(event) =>
                          updateItem(item.id, { merchant: event.target.value })
                        }
                      />
                      <div className="row-merchant-meta">
                        <button
                          className="statement-chip"
                          type="button"
                          title={`Open ${formatStatementTitle(
                            statementById.get(item.statementId || "")
                          )}`}
                          onClick={() =>
                            activateStatement(item.statementId || "")
                          }
                        >
                          {formatStatementShortLabel(
                            statementById.get(item.statementId || "")
                          )}
                        </button>
                        <input
                          className="row-merchant-description"
                          value={item.description}
                          aria-label="Statement description"
                          onChange={(event) =>
                            updateItem(item.id, {
                              description: event.target.value
                            })
                          }
                        />
                      </div>
                    </div>
                  </td>
                  <td data-label="Category">
                    <select
                      value={item.category}
                      aria-label="Category"
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
                  <td data-label="Amount">
                    <div className="amount-cell">
                      <input
                        className="amount-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.amount}
                        aria-label="Amount"
                        onChange={(event) =>
                          updateItem(item.id, {
                            amount: Number(event.target.value)
                          })
                        }
                      />
                      <div
                        className="amount-reimbursed"
                        data-active={item.reimbursedAmount > 0 ? "true" : "false"}
                      >
                        <label className="reimbursed-field">
                          <span>reimb</span>
                          <input
                            className="reimbursed-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.reimbursedAmount}
                            aria-label={`Reimbursed for ${item.merchant || item.description}`}
                            onChange={(event) =>
                              updateItem(item.id, {
                                reimbursedAmount: Number(event.target.value)
                              })
                            }
                          />
                        </label>
                        {item.reimbursedAmount > 0 ? (
                          <span className="net-amount">
                            net{" "}
                            {formatCurrency(
                              item.amount - item.reimbursedAmount,
                              currency
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td data-label="Notes">
                    <input
                      value={item.notes}
                      aria-label="Notes"
                      onChange={(event) =>
                        updateItem(item.id, { notes: event.target.value })
                      }
                    />
                  </td>
                  <td data-label="Actions">
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
        ) : null}

        {section === "cashflow" ? (
          <section className="cash-flow-panel" aria-label="Cash flow">
          <div className="cash-flow-heading">
            <div>
              <p className="eyebrow">Cash flow</p>
              <h3>Where it went</h3>
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
            <div className="flow-visual" aria-label="Cash flow visualization">
              <div className="flow-visual-toolbar">
                <div className="graph-type-control" aria-label="Graph type">
                  {CASH_FLOW_GRAPH_TYPES.map((graphType) => (
                    <button
                      className={
                        cashFlowGraphType === graphType.value ? "active" : ""
                      }
                      key={graphType.value}
                      type="button"
                      aria-pressed={cashFlowGraphType === graphType.value}
                      onClick={() => { setCashFlowGraphType(graphType.value); setCalendarDateFilter(""); }}
                    >
                      {graphType.label}
                    </button>
                  ))}
                </div>
                {cashFlowGraphType === "flow" ? (
                  <div
                    className="graph-zoom-controls"
                    aria-label="Graph zoom controls"
                  >
                    <button
                      className="mini-icon-button"
                      type="button"
                      title="Zoom out"
                      aria-label="Zoom out graph"
                      disabled={graphZoom <= MIN_GRAPH_ZOOM}
                      onClick={() => updateGraphZoom("out")}
                    >
                      <ZoomOut size={14} {...hydrationSafeIconProps} />
                    </button>
                    <button
                      className="graph-zoom-reset"
                      type="button"
                      title="Reset graph zoom"
                      aria-label="Reset graph zoom"
                      disabled={graphZoom === DEFAULT_GRAPH_ZOOM}
                      onClick={resetGraphZoom}
                    >
                      {Math.round(graphZoom * 100)}%
                    </button>
                    <button
                      className="mini-icon-button"
                      type="button"
                      title="Zoom in"
                      aria-label="Zoom in graph"
                      disabled={graphZoom >= MAX_GRAPH_ZOOM}
                      onClick={() => updateGraphZoom("in")}
                    >
                      <ZoomIn size={14} {...hydrationSafeIconProps} />
                    </button>
                  </div>
                ) : null}
              </div>
              {cashFlowGraphType === "flow" ? (
                <CashFlowSankey
                  summary={cashFlowSummary}
                  currency={currency}
                  zoom={graphZoom}
                />
              ) : cashFlowGraphType === "calendar" ? (
                activeMonth ? <SpendingCalendar month={activeMonth} expenses={items} incomes={incomes} currency={currency} selectedDate={activeCalendarDateFilter} onSelectDate={setCalendarDateFilter} /> : <p>Pick a month to see its spending calendar.</p>
              ) : (
                <CashFlowPie summary={cashFlowSummary} currency={currency} />
              )}
            </div>
          </div>
        </section>
        ) : null}

        {section === "income" ? (
          <section
            className="panel income-panel"
            aria-label="Income"
          >
            <div className="panel-heading panel-heading-split">
              <div className="panel-heading-title">
                <Wallet size={18} {...hydrationSafeIconProps} />
                <h2>Income</h2>
              </div>
              <div className="panel-heading-actions">
                <button
                  className="icon-button"
                  type="button"
                  title="Add income row"
                  onClick={addIncome}
                >
                  <Plus size={18} {...hydrationSafeIconProps} />
                </button>
              </div>
            </div>
            <div className="table-frame income-frame">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Amount</th>
                    <th>Kind</th>
                    <th>Notes</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {incomes.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          No income recognized this month. Bank statement
                          deposits such as payroll land here; add rows for
                          anything missing.
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {incomes.map((income) => (
                    <tr key={income.id}>
                      <td data-label="Date">
                        <input
                          type="date"
                          value={income.date}
                          onChange={(event) =>
                            updateIncome(income.id, {
                              date: event.target.value
                            })
                          }
                        />
                      </td>
                      <td data-label="Source">
                        <input
                          value={income.source}
                          onChange={(event) =>
                            updateIncome(income.id, {
                              source: event.target.value
                            })
                          }
                        />
                      </td>
                      <td data-label="Amount">
                        <input
                          className="amount-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={income.amount}
                          onChange={(event) =>
                            updateIncome(income.id, {
                              amount: Number(event.target.value)
                            })
                          }
                        />
                      </td>
                      <td data-label="Kind">
                        <select
                          value={income.kind}
                          onChange={(event) =>
                            updateIncome(income.id, {
                              kind: event.target.value as IncomeItem["kind"]
                            })
                          }
                        >
                          {INCOME_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Notes">
                        <input
                          value={income.notes}
                          onChange={(event) =>
                            updateIncome(income.id, {
                              notes: event.target.value
                            })
                          }
                        />
                      </td>
                      <td data-label="Actions">
                        <button
                          className="icon-button danger"
                          type="button"
                          title="Remove income row"
                          onClick={() => removeIncome(income.id)}
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
        ) : null}

        {section === "chat" ? (
          <section
            className="expense-chat-panel"
            aria-label="Expense chat"
          >
            <div className="expense-chat-heading">
              <div className="panel-heading-title">
                <MessageCircle size={18} {...hydrationSafeIconProps} />
                <h3>Expense chat</h3>
              </div>
              <div className="panel-heading-actions">
                <span className="panel-count">
                  {selectedItems.length > 0
                    ? `${selectedItems.length} selected`
                    : `${items.length} rows`}
                </span>
              </div>
            </div>

            <div className="expense-chat-log" aria-live="polite">
              {chatMessages.length === 0 ? (
                <div className="expense-chat-suggestions">
                  {EXPENSE_CHAT_PROMPTS.map((prompt) => (
                    <button
                      className="expense-chat-suggestion"
                      type="button"
                      key={prompt}
                      disabled={chatBusy || months.length === 0}
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
                  <ExpenseChatEditList
                    message={message}
                    busy={chatBusy}
                    onApprove={approveChatProposals}
                    onDismiss={dismissChatProposals}
                  />
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
                disabled={chatBusy || months.length === 0}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="How could I minimize food costs?"
                aria-label="Expense question"
              />
              <button
                className="icon-button expense-chat-send"
                type="submit"
                title="Send question"
                disabled={chatBusy || months.length === 0 || !chatInput.trim()}
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
        ) : null}

        {section === "all" ? (
          <AllMonthsView
            onSelectMonth={(month) => {
              void selectMonth(month);
              router.push("/");
            }}
          />
        ) : null}

        {section === "setup" ? (
          <div className="setup-grid">
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
              <div className="statement-empty">
                {monthsLoading
                  ? "Loading months"
                  : months.length === 0
                    ? "Upload a statement to start a month"
                    : "No statements"}
              </div>
            ) : null}
            {statementSummaries.map(
              ({
                statement,
                items: statementItems,
                selectedItems: selected,
                amount
              }) => (
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
                    <span>
                      {formatCurrency(
                        amount,
                        statement.statement.currency || currency
                      )}
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

                  <label
                    className="statement-source-month"
                    title={
                      statement.monthSource === "rows"
                        ? "Month came from the row dates, not the statement period."
                        : "Month this statement is filed under."
                    }
                  >
                    <span>
                      Month{statement.monthSource === "rows" ? " (guessed)" : ""}
                    </span>
                    <input
                      type="month"
                      value={activeMonth}
                      disabled={monthsLoading}
                      onChange={(event) =>
                        void changeStatementMonth(
                          statement.id,
                          event.target.value
                        )
                      }
                    />
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

            <section className="panel">
          <div className="panel-heading panel-heading-split">
            <div className="panel-heading-title">
              <Database size={18} {...hydrationSafeIconProps} />
              <h2>Notion</h2>
            </div>
            <span className="panel-count">
              {notionConnection.ready
                ? "Connected"
                : notionConnection.hasApiKey
                  ? "Incomplete"
                  : "Not connected"}
            </span>
          </div>
          <label className="field">
            <span>Integration token</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder={
                notionConnection.hasApiKey
                  ? "Stored - type to replace"
                  : "secret_..."
              }
            />
          </label>
          <label className="field">
            <span>Expenses data source ID</span>
            <input
              value={dataSourceId}
              onChange={(event) => setDataSourceId(event.target.value)}
              placeholder="Expenses database or data source"
            />
          </label>
          <label className="field">
            <span>Category data source ID</span>
            <input
              value={categoryDataSourceId}
              onChange={(event) => setCategoryDataSourceId(event.target.value)}
              placeholder="Optional - imports your categories"
            />
          </label>
          <div className="panel-actions">
            <button
              className="secondary-button"
              type="button"
              title="Save this Notion connection"
              disabled={notionBusy}
              onClick={saveNotionConnection}
            >
              {notionBusy ? (
                <LoaderCircle
                  className="spin"
                  size={18}
                  {...hydrationSafeIconProps}
                />
              ) : (
                <Plug size={18} {...hydrationSafeIconProps} />
              )}
              Connect
            </button>
            {notionConnection.hasApiKey ? (
              <button
                className="secondary-button"
                type="button"
                title="Remove the stored token and data source IDs"
                disabled={notionBusy}
                onClick={disconnectNotion}
              >
                <Unplug size={18} {...hydrationSafeIconProps} />
                Disconnect
              </button>
            ) : null}
          </div>
          <button
            className="secondary-button"
            type="button"
            title={
              notionConnection.ready
                ? "Save selected expenses"
                : "Connect Notion first"
            }
            disabled={controlsDisabled || !notionConnection.ready}
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
              {categorizationNotes.trim() ? "Saved" : "Empty"}
            </span>
          </div>

          <textarea
            className="note-textarea"
            value={categorizationNotes}
            maxLength={MAX_CATEGORIZATION_NOTES_LENGTH}
            onChange={(event) => {
              if (!updateCategorizationNotes(event.target.value)) {
                showNotice({
                  tone: "error",
                  message: settingsError || "Your settings are still loading."
                });
              }
            }}
            placeholder="Steam, Valve, and STEAMGAMES.COM should be Entertainment, not Charity."
          />
          <div className="note-meta">
            <span>Saved to your account</span>
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

          <div className="category-panel-actions">
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
            <button
              className="secondary-button"
              type="button"
              title="Add a category"
              disabled={controlsDisabled}
              onClick={() => openCategoryForm()}
            >
              <Plus size={18} {...hydrationSafeIconProps} />
              New
            </button>
          </div>

          {categoryForm ? (
            <form
              className="category-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCategoryForm();
              }}
            >
              <input
                value={categoryForm.name}
                maxLength={MAX_CATEGORY_NAME_LENGTH}
                placeholder="Category name"
                aria-label="Category name"
                autoFocus
                onChange={(event) =>
                  setCategoryForm((current) =>
                    current ? { ...current, name: event.target.value } : current
                  )
                }
              />
              <input
                value={categoryForm.description}
                maxLength={MAX_CATEGORY_DESCRIPTION_LENGTH}
                placeholder="What belongs here (optional)"
                aria-label="Category description"
                onChange={(event) =>
                  setCategoryForm((current) =>
                    current
                      ? { ...current, description: event.target.value }
                      : current
                  )
                }
              />
              <div className="category-form-actions">
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={controlsDisabled || !categoryForm.name.trim()}
                >
                  {categoryBusy === "updating" ? (
                    <LoaderCircle
                      className="spin"
                      size={16}
                      {...hydrationSafeIconProps}
                    />
                  ) : (
                    <Check size={16} {...hydrationSafeIconProps} />
                  )}
                  {categoryForm.mode === "create" ? "Add" : "Save"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCategoryForm(null)}
                >
                  <X size={16} {...hydrationSafeIconProps} />
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

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
              <div
                className={`category-toggle ${category.enabled ? "enabled" : ""}`}
                key={`${category.source}-${category.sourceId || category.name}`}
              >
                <label
                  className="category-toggle-label"
                  title={category.description || undefined}
                >
                  <input
                    type="checkbox"
                    checked={category.enabled}
                    disabled={controlsDisabled}
                    onChange={(event) =>
                      toggleCategory(category.name, event.target.checked)
                    }
                  />
                  <span className="category-toggle-main">
                    <strong>{category.name}</strong>
                    <small>{category.source}</small>
                  </span>
                </label>
                <div className="category-toggle-actions">
                  {isEditableCategory(category) ? (
                    <button
                      className="icon-button"
                      type="button"
                      title={`Rename ${category.name}`}
                      aria-label={`Rename ${category.name}`}
                      disabled={controlsDisabled}
                      onClick={() => openCategoryForm(category)}
                    >
                      <Pencil size={14} {...hydrationSafeIconProps} />
                    </button>
                  ) : null}
                  <button
                    className="icon-button danger"
                    type="button"
                    title={`Remove ${category.name}`}
                    aria-label={`Remove ${category.name}`}
                    disabled={controlsDisabled}
                    onClick={() => deleteCategory(category.name)}
                  >
                    <Trash2 size={14} {...hydrationSafeIconProps} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

type PieSlice = {
  id: string;
  label: string;
  amount: number;
  percent: number;
  color: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
};

type PieOutsideLabel = {
  slice: PieSlice;
  side: "left" | "right";
  anchor: { x: number; y: number };
  elbow: { x: number; y: number };
  labelX: number;
  labelY: number;
  leaderEndX: number;
  textAnchor: "start" | "end";
};

function CashFlowPie({
  summary,
  currency
}: {
  summary: CashFlowSummary;
  currency: string;
}) {
  const width = 980;
  const legendX = 720;
  const legendTop = 78;
  const legendRowHeight = 46;
  const allocations = summary.allocations.filter(
    (allocation) => allocation.amount > 0
  );
  const allocationTotal = allocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0
  );
  const height = Math.max(
    420,
    legendTop + 46 + Math.max(allocations.length, 1) * legendRowHeight
  );
  const centerX = 316;
  const centerY = height / 2;
  const radius = 144;
  const slices = layoutPieSlices(allocations);
  const insideLabels = slices.filter(canPlacePieLabelInside);
  const outsideLabels = layoutPieOutsideLabels(
    slices.filter((slice) => !canPlacePieLabelInside(slice)),
    centerX,
    centerY,
    radius,
    78,
    height - 42,
    52
  );

  return (
    <svg
      className="pie-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Pie graph of savings, manual outputs, and statement categories"
    >
      <rect className="pie-stage" width={width} height={height} rx="8" />
      <text className="pie-title" x="24" y="32">
        Allocation share
      </text>

      {slices.length === 0 ? (
        <text
          className="pie-empty"
          x={centerX}
          y={centerY}
          textAnchor="middle"
        >
          Add outputs or statement rows
        </text>
      ) : (
        <>
          <g className="pie-slices">
            {slices.length === 1 ? (
              <circle
                className="pie-slice"
                cx={centerX}
                cy={centerY}
                r={radius}
                fill={slices[0].color}
              >
                <title>
                  {slices[0].label}: {formatCurrency(slices[0].amount, currency)}
                </title>
              </circle>
            ) : (
              slices.map((slice) => (
                <path
                  className="pie-slice"
                  d={pieSlicePath(
                    centerX,
                    centerY,
                    radius,
                    slice.startAngle,
                    slice.endAngle
                  )}
                  fill={slice.color}
                  key={slice.id}
                >
                  <title>
                    {slice.label}: {formatCurrency(slice.amount, currency)}
                  </title>
                </path>
              ))
            )}
          </g>

          <g className="pie-labels">
            {insideLabels.map((slice) => {
              const labelPoint = piePoint(
                centerX,
                centerY,
                radius * 0.58,
                slice.midAngle
              );

              return (
                <text
                  className="pie-slice-label inside"
                  key={`inside-label-${slice.id}`}
                  x={labelPoint.x}
                  y={labelPoint.y - 5}
                  textAnchor="middle"
                >
                  <tspan x={labelPoint.x}>
                    {truncateSvgText(slice.label, 18)}
                  </tspan>
                  <tspan
                    className="pie-slice-label-value inside"
                    x={labelPoint.x}
                    dy="18"
                  >
                    {formatCurrency(slice.amount, currency)} /{" "}
                    {formatPercent(slice.percent)}
                  </tspan>
                </text>
              );
            })}
            {outsideLabels.map((label) => (
              <g key={`outside-label-${label.slice.id}`}>
                <path
                  className="pie-label-line"
                  d={pieLabelLeaderPath(label)}
                  fill="none"
                  stroke={label.slice.color}
                />
                <circle
                  className="pie-label-dot"
                  cx={label.anchor.x}
                  cy={label.anchor.y}
                  r="3"
                  fill={label.slice.color}
                />
                <text
                  className="pie-slice-label outside"
                  x={label.labelX}
                  y={label.labelY - 5}
                  textAnchor={label.textAnchor}
                >
                  <tspan x={label.labelX}>
                    {truncateSvgText(label.slice.label, 20)}
                  </tspan>
                  <tspan
                    className="pie-slice-label-value outside"
                    x={label.labelX}
                    dy="18"
                  >
                    {formatCurrency(label.slice.amount, currency)} /{" "}
                    {formatPercent(label.slice.percent)}
                  </tspan>
                </text>
              </g>
            ))}
          </g>

          <g className="pie-legend" transform={`translate(${legendX} 0)`}>
            <text className="pie-legend-heading" x="0" y="32">
              {formatCurrency(allocationTotal, currency)} total
            </text>
            {slices.map((slice, index) => (
              <g
                className="pie-legend-row"
                key={slice.id}
                transform={`translate(0 ${
                  legendTop + index * legendRowHeight
                })`}
              >
                <rect
                  className="pie-legend-swatch"
                  x="0"
                  y="-13"
                  width="14"
                  height="14"
                  rx="4"
                  fill={slice.color}
                />
                <text className="pie-legend-label" x="24" y="-2">
                  {truncateSvgText(slice.label, 30)}
                </text>
                <text className="pie-legend-value" x="24" y="19">
                  {formatCurrency(slice.amount, currency)} /{" "}
                  {formatPercent(slice.percent)}
                </text>
              </g>
            ))}
          </g>
        </>
      )}
    </svg>
  );
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

function subscribeToReviewHistory(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === REVIEW_HISTORY_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(REVIEW_HISTORY_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(REVIEW_HISTORY_STORAGE_EVENT, onStoreChange);
  };
}

function readEmptyReviewHistorySnapshot() {
  return EMPTY_REVIEW_HISTORY;
}

function readReviewHistorySnapshot() {
  if (typeof window === "undefined") {
    return EMPTY_REVIEW_HISTORY;
  }

  try {
    const raw = window.localStorage.getItem(REVIEW_HISTORY_STORAGE_KEY);

    if (raw === cachedReviewHistoryRaw) {
      return cachedReviewHistorySnapshot;
    }

    cachedReviewHistoryRaw = raw;
    cachedReviewHistorySnapshot = raw
      ? parseReviewHistory(JSON.parse(raw))
      : EMPTY_REVIEW_HISTORY;
    return cachedReviewHistorySnapshot;
  } catch {
    cachedReviewHistoryRaw = undefined;
    cachedReviewHistorySnapshot = EMPTY_REVIEW_HISTORY;
    return cachedReviewHistorySnapshot;
  }
}

function writeStoredReviewHistory(
  history: readonly ReviewHistoryEvent[]
) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const raw = JSON.stringify(serializeReviewHistory(history));
    window.localStorage.setItem(REVIEW_HISTORY_STORAGE_KEY, raw);
    cachedReviewHistoryRaw = raw;
    cachedReviewHistorySnapshot = [...history];
    window.dispatchEvent(new Event(REVIEW_HISTORY_STORAGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function monthsNotice(state: MonthsState): Notice | null {
  if (state.error) {
    return { tone: "error", message: state.error };
  }

  if (!state.migration) {
    return null;
  }

  const { monthCount, statementCount, unresolvedCount } = state.migration;
  const filed =
    statementCount > 0
      ? `Filed ${statementCount} saved ${
          statementCount === 1 ? "statement" : "statements"
        } into ${monthCount} ${monthCount === 1 ? "month" : "months"}.`
      : "";
  const undated =
    unresolvedCount > 0
      ? `${unresolvedCount} ${
          unresolvedCount === 1 ? "statement" : "statements"
        } could not be dated and stayed in this browser's draft.`
      : "";

  return {
    tone: undated ? "neutral" : "success",
    message: [filed, undated].filter(Boolean).join(" ")
  };
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

/**
 * The chip names the statement a row came from and now sits inside the
 * merchant cell, so it has to be both short and identifying: the institution's
 * initials plus the account's last four (`AE 1007`, `WF 8842`), with the full
 * name on the button's `title`. It used to be the first five characters of the
 * masked account, which is `••••` and says nothing.
 */
function formatStatementShortLabel(statement?: ReviewStatement | null) {
  if (!statement) {
    return "Unknown";
  }

  const name = formatStatementTitle(statement);
  const initials = name
    .split(/\s+/)
    .map((word) => word[0] || "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const tail = statement.statement.accountMask.replace(/\D+/g, "").slice(-4);

  return tail ? `${initials} ${tail}` : initials;
}

function formatStatementPeriod(statement: StatementSummary) {
  return [statement.periodStart, statement.periodEnd].filter(Boolean).join(" to ");
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

function categoryFilterOptionsForItems(
  items: readonly ExpenseItem[],
  categories: readonly ExpenseCategoryDefinition[]
) {
  const countsByCategory = new Map<string, number>();

  for (const item of items) {
    const category = item.category.trim() || FALLBACK_CATEGORY_NAME;
    countsByCategory.set(category, (countsByCategory.get(category) || 0) + 1);
  }

  const categoryOrder = new Map(
    categories.map((category, index) => [category.name.toLowerCase(), index])
  );

  return [...countsByCategory.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => {
      const leftOrder = categoryOrder.get(left.name.toLowerCase());
      const rightOrder = categoryOrder.get(right.name.toLowerCase());

      if (leftOrder !== undefined && rightOrder !== undefined) {
        return leftOrder - rightOrder;
      }

      if (leftOrder !== undefined) {
        return -1;
      }

      if (rightOrder !== undefined) {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function layoutPieSlices(
  items: ReadonlyArray<{
    id: string;
    label: string;
    amount: number;
    source: string;
  }>
): PieSlice[] {
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  if (total <= 0) {
    return [];
  }

  let cursor = -90;

  return items.map((item, index) => {
    const angle = (item.amount / total) * 360;
    const startAngle = cursor;
    const endAngle = cursor + angle;
    cursor = endAngle;

    return {
      id: item.id,
      label: item.label,
      amount: item.amount,
      percent: (item.amount / total) * 100,
      color: allocationColor(item.source, index),
      startAngle,
      endAngle,
      midAngle: startAngle + angle / 2
    };
  });
}

function canPlacePieLabelInside(slice: PieSlice) {
  return slice.endAngle - slice.startAngle >= 48 && slice.percent >= 12;
}

function layoutPieOutsideLabels(
  slices: readonly PieSlice[],
  centerX: number,
  centerY: number,
  radius: number,
  minY: number,
  maxY: number,
  minSpacing: number
): PieOutsideLabel[] {
  const labels = slices.map((slice) => {
    const side: PieOutsideLabel["side"] =
      Math.cos((slice.midAngle * Math.PI) / 180) >= 0 ? "right" : "left";
    const anchor = piePoint(centerX, centerY, radius + 2, slice.midAngle);
    const elbow = piePoint(centerX, centerY, radius + 28, slice.midAngle);
    const labelX = side === "right" ? centerX + radius + 48 : 36;

    return {
      slice,
      side,
      anchor,
      elbow,
      labelX,
      labelY: elbow.y,
      leaderEndX: labelX - 12,
      textAnchor: "start" as const
    };
  });

  return [
    ...layoutPieLabelSide(
      labels.filter((label) => label.side === "right"),
      minY,
      maxY,
      minSpacing
    ),
    ...layoutPieLabelSide(
      labels.filter((label) => label.side === "left"),
      minY,
      maxY,
      minSpacing
    )
  ];
}

function layoutPieLabelSide(
  labels: readonly PieOutsideLabel[],
  minY: number,
  maxY: number,
  minSpacing: number
) {
  if (labels.length === 0) {
    return [];
  }

  const sorted = [...labels].sort((left, right) => left.elbow.y - right.elbow.y);
  const available = Math.max(1, maxY - minY);
  const spacing =
    sorted.length > 1
      ? Math.min(minSpacing, available / (sorted.length - 1))
      : minSpacing;
  const positions = sorted.map((label) => clamp(label.elbow.y, minY, maxY));

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

  return sorted.map((label, index) => ({
    ...label,
    labelY: clamp(positions[index], minY, maxY)
  }));
}

function pieLabelLeaderPath(label: PieOutsideLabel) {
  return [
    `M ${label.anchor.x} ${label.anchor.y}`,
    `L ${label.elbow.x} ${label.elbow.y}`,
    `L ${label.leaderEndX} ${label.labelY}`
  ].join(" ");
}

function pieSlicePath(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const start = piePoint(centerX, centerY, radius, startAngle);
  const end = piePoint(centerX, centerY, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z"
  ].join(" ");
}

function piePoint(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number
) {
  const radians = (angle * Math.PI) / 180;

  return {
    x: centerX + radius * Math.cos(radians),
    y: centerY + radius * Math.sin(radians)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}




function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function extractionNotice(
  outcomes: readonly ExtractionOutcome[],
  skippedNames: readonly string[]
): Notice {
  const failed = outcomes.filter((outcome) => Boolean(outcome.error));
  const succeeded = outcomes.filter((outcome) => !outcome.error);

  // A lone file keeps the exact wording the single upload flow always had.
  if (outcomes.length === 1 && skippedNames.length === 0) {
    const outcome = outcomes[0];
    const artifactMessage = outcome.artifactDir
      ? ` Artifacts: ${outcome.artifactDir}`
      : "";

    if (outcome.error) {
      return { tone: "error", message: outcome.error };
    }

    if (outcome.rowCount === 0) {
      return {
        tone: "error",
        message: `AI extraction returned no expense rows.${artifactMessage}`
      };
    }

    if (!outcome.month) {
      return {
        tone: "neutral",
        message: `Extracted ${outcome.rowCount} expenses. Choose the month this statement belongs to.${artifactMessage}`
      };
    }

    if (outcome.months.length > 1) {
      return {
        tone: "success",
        message: `Extracted ${outcome.rowCount} expenses across ${
          outcome.months.length
        } months: ${outcome.months
          .map(formatMonthLabel)
          .join(", ")}. Showing ${formatMonthLabel(
          outcome.month
        )}.${artifactMessage}`
      };
    }

    return {
      tone: "success",
      message: `Extracted ${outcome.rowCount} expenses into ${formatMonthLabel(
        outcome.month
      )}.${
        outcome.monthFromRows
          ? " Month came from the row dates, so check it."
          : ""
      }${artifactMessage}`
    };
  }

  const totalRows = succeeded.reduce(
    (total, outcome) => total + outcome.rowCount,
    0
  );
  const segments = [
    `Extracted ${totalRows} expense${totalRows === 1 ? "" : "s"} from ${
      succeeded.length
    } of ${outcomes.length + skippedNames.length} statements.`
  ];
  // Parked statements (no usable month) are the ones the panel below asks
  // about, whether or not they carried rows; filed-but-empty ones are the
  // extraction-quality signal.
  const zeroRows = succeeded.filter(
    (outcome) => outcome.rowCount === 0 && outcome.month
  );
  const needsMonth = succeeded.filter((outcome) => !outcome.month);

  if (zeroRows.length) {
    segments.push(
      `No expense rows: ${zeroRows
        .map((outcome) =>
          outcome.artifactDir
            ? `${outcome.name} (artifacts: ${outcome.artifactDir})`
            : outcome.name
        )
        .join(", ")}.`
    );
  }

  if (needsMonth.length) {
    segments.push(
      `Needs a month below: ${needsMonth
        .map((outcome) => outcome.name)
        .join(", ")}.`
    );
  }

  if (failed.length) {
    segments.push(
      `Failed: ${failed
        .map(
          (outcome) => `${outcome.name} (${outcome.error || "extraction failed"})`
        )
        .join(", ")}.`
    );
  }

  if (skippedNames.length) {
    segments.push(`Too large (12 MB limit): ${skippedNames.join(", ")}.`);
  }

  return {
    tone:
      failed.length || skippedNames.length
        ? "error"
        : zeroRows.length || needsMonth.length
          ? "neutral"
          : "success",
    message: segments.join(" ")
  };
}
