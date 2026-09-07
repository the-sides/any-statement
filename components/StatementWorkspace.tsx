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
  PanelLeft,
  Pin,
  PinOff,
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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  INCOME_KINDS,
  STATEMENT_TYPES,
  FALLBACK_CATEGORY_NAME,
  getDefaultCategoryName,
  getEnabledCategoryNames,
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
import { MAX_CATEGORIZATION_NOTES_LENGTH } from "@/lib/userSettings";
import {
  readInitialUserSettingsSnapshot,
  readUserSettingsSnapshot,
  subscribeToUserSettings,
  updateCategorizationNotes
} from "@/lib/userSettingsClientStore";
import {
  determineStatementMonth,
  formatMonthLabel,
  isMonthKey,
  statementMonthSourceOf
} from "@/lib/months";
import {
  clearMonthsNotice,
  fileStatement,
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

type PendingUpload = {
  statement: ReviewStatement;
  expenses: ExpenseItem[];
  incomes: IncomeItem[];
};

/**
 * The controls rail is hidden until the pointer nears the left edge: it fades in
 * from `RAIL_FADE_DISTANCE_PX` and is fully out by `RAIL_OPEN_DISTANCE_PX`.
 * Pinning bypasses the whole ramp.
 */
const RAIL_FADE_DISTANCE_PX = 20;
const RAIL_OPEN_DISTANCE_PX = 12;
const RAIL_PIN_STORAGE_KEY = "statement-ledger:rail-pinned";
const RAIL_PIN_STORAGE_EVENT = "statement-ledger:rail-pinned-change";

/**
 * Cached so `getSnapshot` is cheap and stable, and so a browser that refuses
 * localStorage still honours the pin for the session.
 */
let railPinnedCache: boolean | null = null;

function subscribeToRailPinPreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === RAIL_PIN_STORAGE_KEY) {
      railPinnedCache = null;
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(RAIL_PIN_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(RAIL_PIN_STORAGE_EVENT, onStoreChange);
  };
}

function readRailPinPreference() {
  if (typeof window === "undefined") {
    return false;
  }

  if (railPinnedCache === null) {
    try {
      railPinnedCache =
        window.localStorage.getItem(RAIL_PIN_STORAGE_KEY) === "1";
    } catch {
      railPinnedCache = false;
    }
  }

  return railPinnedCache;
}

function writeRailPinPreference(value: boolean) {
  railPinnedCache = value;

  try {
    if (value) {
      window.localStorage.setItem(RAIL_PIN_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(RAIL_PIN_STORAGE_KEY);
    }
  } catch {
    // Non-fatal: the pin just does not survive a reload.
  }

  window.dispatchEvent(new Event(RAIL_PIN_STORAGE_EVENT));
}

type ExtractionOutcome = {
  name: string;
  rowCount: number;
  month: string | null;
  monthFromRows: boolean;
  artifactDir: string;
  error?: string;
};

const CASH_FLOW_GRAPH_TYPES = [
  { value: "flow", label: "Flow" },
  { value: "pie", label: "Pie" }
] as const;

type CashFlowGraphType = (typeof CASH_FLOW_GRAPH_TYPES)[number]["value"];

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const APP_CATEGORY_VISIBILITY_STORAGE_KEY =
  "statement-ledger.include-app-categories";
const APP_CATEGORY_VISIBILITY_STORAGE_EVENT =
  "statement-ledger-include-app-categories";
const REVIEW_HISTORY_STORAGE_EVENT = "statement-ledger-review-history";
const MAX_STATEMENT_FILE_SIZE = 12 * 1024 * 1024;
const GRAPH_ZOOM_LEVELS = [0.35, 0.5, 0.65, 0.75, 1, 1.25, 1.5, 1.75];
const MIN_GRAPH_ZOOM = GRAPH_ZOOM_LEVELS[0];
const MAX_GRAPH_ZOOM = GRAPH_ZOOM_LEVELS[GRAPH_ZOOM_LEVELS.length - 1];
const DEFAULT_GRAPH_ZOOM = 1;
// The flow chart is wide on purpose: the long horizontal runs are what let a
// ribbon flatten out before it reaches its label.
const SANKEY_WIDTH = 1360;
const SANKEY_MIN_RENDER_WIDTH = 880;
const SANKEY_TRUNK_HEIGHT = 660;
const SANKEY_NODE_WIDTH = 14;
const SANKEY_LABEL_GAP = 16;
const SANKEY_NODE_GAP = 6;
const SANKEY_LABEL_SPACING = 50;
const SANKEY_MIN_NODE_HEIGHT = 3;
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

type SortKey =
  | "statement"
  | "amount"
  | "reimbursed"
  | "merchant"
  | "description"
  | "category"
  | "notes"
  | "date";

type SortState = { key: SortKey; dir: "asc" | "desc" };

const TABLE_SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "statement", label: "Statement" },
  { key: "amount", label: "Amount" },
  { key: "reimbursed", label: "Reimbursed" },
  { key: "merchant", label: "Merchant" },
  { key: "description", label: "Description" },
  { key: "category", label: "Category" },
  { key: "notes", label: "Notes" },
  { key: "date", label: "Date" }
];

function sortKeyValue(
  item: ExpenseItem,
  key: SortKey,
  statementById: Map<string, ReviewStatement>
): string | number {
  switch (key) {
    case "statement":
      return formatStatementShortLabel(
        statementById.get(item.statementId || "")
      );
    case "amount":
      return item.amount;
    case "reimbursed":
      return item.reimbursedAmount;
    case "merchant":
      return item.merchant;
    case "description":
      return item.description;
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
  direction: 1 | -1,
  statementById: Map<string, ReviewStatement>
): number {
  const aValue = sortKeyValue(a, key, statementById);
  const bValue = sortKeyValue(b, key, statementById);

  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * direction;
  }

  return String(aValue).localeCompare(String(bValue)) * direction;
}

export function StatementWorkspace() {
  const [files, setFiles] = useState<File[]>([]);
  const railRef = useRef<HTMLElement | null>(null);
  const railPinned = useSyncExternalStore(
    subscribeToRailPinPreference,
    readRailPinPreference,
    () => false
  );
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
  const categoryFilterSet = useMemo(
    () => new Set(categoryFilters),
    [categoryFilters]
  );
  const visibleItems = useMemo(() => {
    const filtered =
      categoryFilterSet.size === 0
        ? items
        : items.filter((item) => categoryFilterSet.has(item.category));

    if (!sort) {
      return filtered;
    }

    const direction = sort.dir === "asc" ? 1 : -1;

    // Display-only ordering; the month document keeps its stored order.
    return [...filtered].sort((a, b) =>
      compareBySortKey(a, b, sort.key, direction, statementById)
    );
  }, [categoryFilterSet, items, sort, statementById]);
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

  // Pointer proximity drives the rail directly through a CSS variable instead
  // of React state: a mousemove-per-frame re-render of this component would be
  // visible jank, and nothing else needs to know where the cursor is.
  useEffect(() => {
    const rail = railRef.current;

    if (!rail || railPinned) {
      return;
    }

    let frame = 0;
    let pointerX = Number.POSITIVE_INFINITY;
    // Once the rail is fully out it takes pointer events, so hover and focus
    // hold it open even where the cursor sits past the fade distance.
    let hovering = false;
    let focused = false;

    function apply() {
      frame = 0;

      const reveal =
        hovering || focused
          ? 1
          : pointerX <= RAIL_OPEN_DISTANCE_PX
            ? 1
            : pointerX >= RAIL_FADE_DISTANCE_PX
              ? 0
              : (RAIL_FADE_DISTANCE_PX - pointerX) /
                (RAIL_FADE_DISTANCE_PX - RAIL_OPEN_DISTANCE_PX);

      const target = railRef.current;

      if (!target) {
        return;
      }

      target.style.setProperty("--rail-reveal", reveal.toFixed(3));
      target.dataset.railOpen = reveal >= 1 ? "true" : "false";
    }

    function schedule() {
      if (!frame) {
        frame = window.requestAnimationFrame(apply);
      }
    }

    function onPointerMove(event: MouseEvent) {
      pointerX = event.clientX;
      schedule();
    }

    function onPointerLeaveWindow() {
      pointerX = Number.POSITIVE_INFINITY;
      schedule();
    }

    function onRailEnter() {
      hovering = true;
      schedule();
    }

    function onRailLeave() {
      hovering = false;
      schedule();
    }

    function onRailFocusIn() {
      focused = true;
      schedule();
    }

    function onRailFocusOut() {
      focused = false;
      schedule();
    }

    window.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseleave", onPointerLeaveWindow);
    rail.addEventListener("mouseenter", onRailEnter);
    rail.addEventListener("mouseleave", onRailLeave);
    rail.addEventListener("focusin", onRailFocusIn);
    rail.addEventListener("focusout", onRailFocusOut);
    apply();

    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      document.removeEventListener("mouseleave", onPointerLeaveWindow);
      rail.removeEventListener("mouseenter", onRailEnter);
      rail.removeEventListener("mouseleave", onRailLeave);
      rail.removeEventListener("focusin", onRailFocusIn);
      rail.removeEventListener("focusout", onRailFocusOut);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      rail.style.removeProperty("--rail-reveal");
      delete rail.dataset.railOpen;
    };
  }, [railPinned]);

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
          const determined = await loadExtraction(
            extractionResult.extraction,
            extractionResult.artifact?.fileName || statementFile.name
          );

          outcomes.push({
            name: statementFile.name,
            rowCount: extractionResult.extraction.expenses.length,
            month: determined?.month ?? null,
            monthFromRows: determined?.source === "rows",
            artifactDir: extractionResult.artifact?.dir || ""
          });
        } catch (error) {
          outcomes.push({
            name: statementFile.name,
            rowCount: 0,
            month: null,
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

    if (items.length === 0) {
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
      showNotice({ tone: "error", message });
    } finally {
      setChatBusy(false);
    }
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
    const determined = determineStatementMonth({
      statement: nextExtraction.statement,
      expenses: statementItems
    });
    const statement = createReviewStatement({
      id: statementId,
      statement: nextExtraction.statement,
      sourceFileName: nextSourceFileName,
      monthSource: determined.month
        ? statementMonthSourceOf(determined)
        : "manual"
    });

    if (!determined.month) {
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

    await fileStatement({
      month: determined.month,
      statement,
      expenses: statementItems,
      incomes: statementIncomes
    });

    return determined;
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
    <main className="app-shell" data-rail-pinned={railPinned ? "true" : "false"}>
      <header className="app-header">
        <div className="brand-lockup">
          <button
            className="mini-icon-button rail-handle"
            type="button"
            aria-pressed={railPinned}
            title={railPinned ? "Unpin controls" : "Pin controls open"}
            aria-label={railPinned ? "Unpin controls" : "Pin controls open"}
            onClick={() => writeRailPinPreference(!railPinned)}
          >
            <PanelLeft size={16} {...hydrationSafeIconProps} />
          </button>
          <div className="brand-mark">SL</div>
          <div>
            <p className="eyebrow">Statement Ledger</p>
            <h1>Expense intake</h1>
          </div>
          <ThemeToggle />
        </div>

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
        </div>
      </header>

      {/* Hidden by default: pointer proximity (see the rail effect above) or
          the pin slides it over the workspace. */}
      <aside
        className="side-rail"
        ref={railRef}
        aria-label="Statement controls"
        data-rail-pinned={railPinned ? "true" : "false"}
      >
        <div className="rail-top">
          <p className="eyebrow">Controls</p>
          <button
            className="mini-icon-button"
            type="button"
            aria-pressed={railPinned}
            title={railPinned ? "Unpin controls" : "Pin controls open"}
            aria-label={railPinned ? "Unpin controls" : "Pin controls open"}
            onClick={() => writeRailPinPreference(!railPinned)}
          >
            {railPinned ? (
              <Pin size={16} {...hydrationSafeIconProps} />
            ) : (
              <PinOff size={16} {...hydrationSafeIconProps} />
            )}
          </button>
        </div>

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

        <section className="panel month-stepper-panel">
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
      </aside>

      <section className="workspace" aria-label="Expense review table">
        {/* Off-screen by default: the drawer parks in the gutter between the
            side panel and the table, and slides over the table on hover. */}
        <div className="income-drawer">
          <section className="panel income-panel" aria-label="Income">
            <div className="panel-heading panel-heading-split">
              <div className="panel-heading-title">
                <Wallet size={18} {...hydrationSafeIconProps} />
                <h2>Income</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                title="Add income row"
                onClick={addIncome}
              >
                <Plus size={18} {...hydrationSafeIconProps} />
              </button>
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
                      <td>
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
                      <td>
                        <input
                          value={income.source}
                          onChange={(event) =>
                            updateIncome(income.id, {
                              source: event.target.value
                            })
                          }
                        />
                      </td>
                      <td>
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
                      <td>
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
                      <td>
                        <input
                          value={income.notes}
                          onChange={(event) =>
                            updateIncome(income.id, {
                              notes: event.target.value
                            })
                          }
                        />
                      </td>
                      <td>
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
          <span className="income-drawer-tab">
            <Wallet size={14} {...hydrationSafeIconProps} />
            Income
          </span>
        </div>
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
                      onClick={() => setCashFlowGraphType(graphType.value)}
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
              ) : (
                <CashFlowPie summary={cashFlowSummary} currency={currency} />
              )}
            </div>
          </div>
        </section>

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
                  <td colSpan={10}>
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
                  <td colSpan={10}>
                    <div className="empty-state">
                      No rows match the active category filter.
                    </div>
                  </td>
                </tr>
              ) : null}
              {visibleItems.map((item) => (
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
                    {item.reimbursedAmount > 0 ? (
                      <span className="net-amount">
                        net{" "}
                        {formatCurrency(
                          item.amount - item.reimbursedAmount,
                          currency
                        )}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <input
                      className="amount-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.reimbursedAmount}
                      onChange={(event) =>
                        updateItem(item.id, {
                          reimbursedAmount: Number(event.target.value)
                        })
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
                    <input
                      value={item.notes}
                      onChange={(event) =>
                        updateItem(item.id, { notes: event.target.value })
                      }
                    />
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

function CashFlowSankey({
  summary,
  currency,
  zoom
}: {
  summary: CashFlowSummary;
  currency: string;
  zoom: number;
}) {
  const width = SANKEY_WIDTH;
  const top = 84;
  const bottom = 48;
  const inputX = 40;
  const incomeX = 500;
  const outputX = 1288;
  const positiveInputs = summary.inputs.filter((entry) => entry.amount > 0);
  const allocations = summary.allocations.filter(
    (allocation) => allocation.amount > 0
  );
  const inputTotal =
    positiveInputs.reduce((sum, input) => sum + input.amount, 0) || 1;
  const allocationTotal =
    allocations.reduce((sum, allocation) => sum + allocation.amount, 0) || 1;
  const inputNodes = layoutSankeyColumn(
    positiveInputs.map((entry, index) => ({
      ...entry,
      color: inputColor(index)
    })),
    inputTotal,
    top,
    SANKEY_TRUNK_HEIGHT
  );
  const allocationNodes = layoutSankeyColumn(
    allocations.map((allocation, index) => ({
      ...allocation,
      color: allocationColor(allocation.source, index)
    })),
    allocationTotal,
    top,
    SANKEY_TRUNK_HEIGHT
  );
  // Both ends of the trunk are packed solid: the income bar is exactly as tall
  // as the flows entering it and as the flows leaving it, so the volume of one
  // shape is visibly conserved as it breaks out into categories.
  const trunkInflow = stackSankeyEnds(inputNodes, top);
  const trunkOutflow = stackSankeyEnds(allocationNodes, top);
  const height = Math.round(
    Math.max(
      top + SANKEY_TRUNK_HEIGHT,
      inputNodes[inputNodes.length - 1]?.y1 ?? 0,
      allocationNodes[allocationNodes.length - 1]?.y1 ?? 0
    ) + bottom
  );
  const trunkCenterY = top + SANKEY_TRUNK_HEIGHT / 2;
  const hasTrunk = positiveInputs.length > 0 || allocations.length > 0;

  return (
    <svg
      className="sankey-chart"
      style={{
        width: `${Math.round(zoom * 100)}%`,
        minWidth: `${Math.round(SANKEY_MIN_RENDER_WIDTH * zoom)}px`
      }}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Income flowing to savings, manual outputs, and statement categories"
    >
      <defs>
        {inputNodes.map((node) => (
          <linearGradient
            key={`input-gradient-${node.id}`}
            id={`sankey-input-${svgId(node.id)}`}
            gradientUnits="userSpaceOnUse"
            x1={inputX + SANKEY_NODE_WIDTH}
            x2={incomeX}
          >
            <stop offset="0%" stopColor={node.color} />
            <stop offset="100%" stopColor="var(--positive)" />
          </linearGradient>
        ))}
        {allocationNodes.map((node) => (
          <linearGradient
            key={`allocation-gradient-${node.id}`}
            id={`sankey-allocation-${svgId(node.id)}`}
            gradientUnits="userSpaceOnUse"
            x1={incomeX + SANKEY_NODE_WIDTH}
            x2={outputX}
          >
            <stop offset="0%" stopColor="var(--positive)" />
            <stop offset="100%" stopColor={node.color} />
          </linearGradient>
        ))}
      </defs>

      <rect className="sankey-stage" width={width} height={height} rx="8" />
      <text className="sankey-title" x={inputX} y="34">
        Inputs
      </text>
      <text className="sankey-title" x={incomeX} y="34">
        Income
      </text>
      <text
        className="sankey-title"
        x={outputX + SANKEY_NODE_WIDTH}
        y="34"
        textAnchor="end"
      >
        Outputs & categories
      </text>

      {positiveInputs.length === 0 ? (
        <text className="sankey-empty" x={inputX} y={top + 30}>
          Add income
        </text>
      ) : null}
      {allocations.length === 0 ? (
        <text className="sankey-empty" x={outputX} y={top + 30} textAnchor="end">
          Add outputs or statement rows
        </text>
      ) : null}

      <g className="sankey-ribbons">
        {inputNodes.map((node, index) => (
          <path
            className="sankey-ribbon"
            key={`input-ribbon-${node.id}`}
            d={sankeyRibbonPath(
              inputX + SANKEY_NODE_WIDTH,
              incomeX,
              node.y0,
              node.y1,
              trunkInflow[index].y0,
              trunkInflow[index].y1
            )}
            fill={`url(#sankey-input-${svgId(node.id)})`}
          />
        ))}
        {allocationNodes.map((node, index) => (
          <path
            className="sankey-ribbon"
            key={`allocation-ribbon-${node.id}`}
            d={sankeyRibbonPath(
              incomeX + SANKEY_NODE_WIDTH,
              outputX,
              trunkOutflow[index].y0,
              trunkOutflow[index].y1,
              node.y0,
              node.y1
            )}
            fill={`url(#sankey-allocation-${svgId(node.id)})`}
          />
        ))}
      </g>

      <g className="sankey-nodes">
        {inputNodes.map((node) => (
          <SankeyNodeMark
            key={`input-${node.id}`}
            x={inputX}
            node={node}
            label={truncateSvgText(node.label, 30)}
            value={`${formatCurrency(node.amount, currency)} (${formatPercent(
              (node.amount / inputTotal) * 100
            )})`}
            side="right"
          />
        ))}

        {hasTrunk ? (
          <>
            <rect
              className="sankey-income-node"
              x={incomeX}
              y={top}
              width={SANKEY_NODE_WIDTH}
              height={SANKEY_TRUNK_HEIGHT}
              rx="2"
            />
            <text
              className="sankey-node-name"
              x={incomeX + SANKEY_NODE_WIDTH + SANKEY_LABEL_GAP}
              y={trunkCenterY - 4}
            >
              Income
            </text>
            <text
              className="sankey-node-value"
              x={incomeX + SANKEY_NODE_WIDTH + SANKEY_LABEL_GAP}
              y={trunkCenterY + 19}
            >
              {formatCurrency(summary.incomeTotal, currency)} (100%)
            </text>
          </>
        ) : null}

        {allocationNodes.map((node) => (
          <SankeyNodeMark
            key={`allocation-${node.id}`}
            x={outputX}
            node={node}
            label={truncateSvgText(node.label, 30)}
            value={`${formatCurrency(node.amount, currency)} (${formatPercent(
              node.percent
            )})`}
            side="left"
          />
        ))}
      </g>
    </svg>
  );
}

function SankeyNodeMark({
  x,
  node,
  label,
  value,
  side
}: {
  x: number;
  node: { color: string; height: number; y0: number; yc: number };
  label: string;
  value: string;
  side: "left" | "right";
}) {
  // Hairline categories still need a bar you can see and a label you can read,
  // so the mark keeps a floor height and stays centred on its own flow.
  const barHeight = Math.max(node.height, SANKEY_MIN_NODE_HEIGHT);
  const textX =
    side === "right"
      ? x + SANKEY_NODE_WIDTH + SANKEY_LABEL_GAP
      : x - SANKEY_LABEL_GAP;

  return (
    <g>
      <rect
        x={x}
        y={node.yc - barHeight / 2}
        width={SANKEY_NODE_WIDTH}
        height={barHeight}
        rx="2"
        fill={node.color}
      />
      <text
        className="sankey-node-name"
        x={textX}
        y={node.yc - 4}
        textAnchor={side === "right" ? "start" : "end"}
      >
        {label}
      </text>
      <text
        className="sankey-node-value"
        x={textX}
        y={node.yc + 19}
        textAnchor={side === "right" ? "start" : "end"}
      >
        {value}
      </text>
    </g>
  );
}

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

function formatStatementShortLabel(statement?: ReviewStatement | null) {
  if (!statement) {
    return "Unknown";
  }

  const label =
    statement.statement.accountMask.trim() ||
    statement.statement.institution.trim() ||
    statement.sourceFileName.trim() ||
    "Statement";

  return label.slice(0, 5);
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

// A column stacks its nodes in value order, but a run of tiny categories would
// otherwise pile their labels on top of each other. Spreading them costs
// vertical room the chart does not have to fit on screen, so the branch simply
// reaches further down the canvas instead of squeezing.
function layoutSankeyColumn<T extends { amount: number; color: string }>(
  items: readonly T[],
  total: number,
  top: number,
  trunkHeight: number
): Array<SankeySegment<T>> {
  if (items.length === 0) {
    return [];
  }

  const heights = items.map((item) =>
    total > 0 ? (item.amount / total) * trunkHeight : trunkHeight / items.length
  );
  let cursor = top;

  return items.map((item, index) => {
    const height = heights[index];
    const y0 = cursor;
    const y1 = y0 + height;
    const next = heights[index + 1];

    cursor =
      next === undefined
        ? y1
        : y1 +
          Math.max(
            SANKEY_NODE_GAP,
            SANKEY_LABEL_SPACING - (height + next) / 2
          );

    return {
      ...item,
      height,
      y0,
      y1,
      yc: y0 + height / 2
    };
  });
}

// The trunk end of every ribbon is packed edge to edge so the bar it meets is
// exactly the sum of its flows.
function stackSankeyEnds(
  nodes: ReadonlyArray<{ height: number }>,
  top: number
) {
  let cursor = top;

  return nodes.map((node) => {
    const y0 = cursor;
    cursor = y0 + node.height;

    return { y0, y1: cursor };
  });
}

// A ribbon is a closed shape, not a thick line: its top and bottom edges are
// separate curves, so the band keeps its own width at each end and the volume
// entering equals the volume leaving.
function sankeyRibbonPath(
  x0: number,
  x1: number,
  a0: number,
  a1: number,
  b0: number,
  b1: number
) {
  const curve = (x1 - x0) * 0.5;

  return [
    `M ${x0} ${a0}`,
    `C ${x0 + curve} ${a0}, ${x1 - curve} ${b0}, ${x1} ${b0}`,
    `L ${x1} ${b1}`,
    `C ${x1 - curve} ${b1}, ${x0 + curve} ${a1}, ${x0} ${a1}`,
    "Z"
  ].join(" ");
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

function nextGraphZoomLevel(
  current: number,
  direction: "in" | "out"
) {
  const currentIndex = GRAPH_ZOOM_LEVELS.reduce(
    (closestIndex, level, index) =>
      Math.abs(level - current) <
      Math.abs(GRAPH_ZOOM_LEVELS[closestIndex] - current)
        ? index
        : closestIndex,
    0
  );
  const nextIndex = Math.min(
    GRAPH_ZOOM_LEVELS.length - 1,
    Math.max(0, currentIndex + (direction === "in" ? 1 : -1))
  );

  return GRAPH_ZOOM_LEVELS[nextIndex];
}

// Chart paint goes through the theme tokens so the graphs follow light/dark.
function inputColor(index: number) {
  const colors = [
    "var(--teal)",
    "var(--positive)",
    "var(--cobalt)",
    "var(--gold)"
  ];

  return colors[index % colors.length];
}

function allocationColor(source: string, index: number) {
  if (source === "saved") {
    return "var(--positive)";
  }

  if (source === "manual-output") {
    return "var(--gold)";
  }

  if (source === "overspent") {
    return "var(--coral)";
  }

  const colors = [
    "var(--magenta)",
    "var(--teal)",
    "var(--cobalt)",
    "var(--coral)",
    "var(--violet)"
  ];

  return colors[index % colors.length];
}

// Category ids carry the raw label, so they can hold spaces and punctuation
// that a url(#...) reference cannot.
function svgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
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
