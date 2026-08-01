import {
  createMonthDocument,
  fileStatementIntoMonth,
  migrateReviewDraftToMonths,
  parseMonthDocument,
  reassignStatementMonth,
  summarizeMonthDocument,
  type MonthDocument,
  type MonthSummary
} from "@/lib/months";
import {
  REVIEW_DRAFT_STORAGE_KEY,
  parseReviewDraft,
  type ReviewStatement
} from "@/lib/reviewDraft";
import type { ExpenseItem } from "@/lib/types";

const WRITE_DEBOUNCE_MS = 500;

export type MonthsMigration = {
  monthCount: number;
  statementCount: number;
  unresolvedCount: number;
};

export type MonthsState = {
  status: "loading" | "ready";
  months: MonthSummary[];
  activeMonth: string;
  document: MonthDocument | null;
  error: string;
  migration: MonthsMigration | null;
};

const INITIAL_STATE: MonthsState = {
  status: "loading",
  months: [],
  activeMonth: "",
  document: null,
  error: "",
  migration: null
};

const listeners = new Set<() => void>();

let state = INITIAL_STATE;
let initialized = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDocument: MonthDocument | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

export function subscribeToMonths(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  ensureInitialized();

  return () => {
    listeners.delete(onStoreChange);
  };
}

export function readMonthsSnapshot() {
  return state;
}

export function readInitialMonthsSnapshot() {
  return INITIAL_STATE;
}

/**
 * Store notices describe the last thing the store did, so the next action
 * clears them.
 */
function beginAction() {
  if (state.error || state.migration) {
    setState({ error: "", migration: null });
  }
}

/**
 * Applies an edit to the month on screen. State updates immediately and the
 * document is flushed to the server on a debounce.
 */
export function updateActiveMonth(input: {
  statements?: readonly ReviewStatement[];
  expenses?: readonly ExpenseItem[];
  selectedIds?: Iterable<string>;
  activeStatementId?: string;
}) {
  const current = state.document;

  if (!current) {
    return false;
  }

  beginAction();

  const next = createMonthDocument({
    month: current.month,
    statements: input.statements || current.statements,
    expenses: input.expenses || current.expenses,
    selectedIds: input.selectedIds ?? current.selectedIds,
    activeStatementId: input.activeStatementId ?? current.activeStatementId
  });

  if (next.statements.length === 0) {
    cancelPendingWrite();
    setState({ document: null });
    void dropMonth(current.month);

    return true;
  }

  setState({
    document: next,
    months: withMonthSummary(state.months, summarizeMonthDocument(next))
  });
  scheduleWrite(next);

  return true;
}

export async function selectMonth(month: string) {
  if (month === state.activeMonth) {
    return;
  }

  beginAction();
  await flushMonths();
  setState({ status: "loading", activeMonth: month, document: null });

  try {
    const document = await fetchMonthDocument(month);

    setState({ status: "ready", activeMonth: month, document });
  } catch (error) {
    setState({ status: "ready", error: errorMessage(error, "Loading the month failed.") });
  }
}

/**
 * Files a freshly extracted statement into its month and switches to it.
 */
export async function fileStatement(input: {
  month: string;
  statement: ReviewStatement;
  expenses: readonly ExpenseItem[];
}) {
  beginAction();
  await flushMonths();

  try {
    const existing =
      input.month === state.activeMonth && state.document
        ? state.document
        : await fetchMonthDocument(input.month);
    const next = fileStatementIntoMonth(existing, input);

    setState({
      status: "ready",
      activeMonth: input.month,
      document: next,
      months: withMonthSummary(state.months, summarizeMonthDocument(next))
    });

    await enqueueWrite(() => putMonthDocument(next));
  } catch (error) {
    setState({ error: errorMessage(error, "Filing the statement failed.") });
  }
}

/**
 * Moves a statement and its rows into another month, creating that month when
 * it does not exist and dropping the source month when it empties.
 */
export async function reassignStatement(input: {
  statementId: string;
  month: string;
}) {
  const source = state.document;

  if (!source || source.month === input.month) {
    return;
  }

  beginAction();
  await flushMonths();

  try {
    const target = await fetchMonthDocument(input.month);
    const moved = reassignStatementMonth({
      statementId: input.statementId,
      source,
      target,
      month: input.month
    });

    await enqueueWrite(async () => {
      await putMonthDocument(moved.target);

      if (moved.source) {
        await putMonthDocument(moved.source);
      } else {
        await deleteMonthDocument(source.month);
      }
    });

    setState({
      months: await fetchMonthSummaries(),
      activeMonth: moved.source ? source.month : moved.target.month,
      document: moved.source || moved.target
    });
  } catch (error) {
    setState({ error: errorMessage(error, "Changing the month failed.") });
  }
}

export async function flushMonths() {
  const pending = takePendingWrite();

  if (pending) {
    await enqueueWrite(() => putMonthDocument(pending));

    return;
  }

  await writeChain;
}

function ensureInitialized() {
  if (initialized) {
    return;
  }

  initialized = true;
  registerUnloadHandlers();
  void initialize();
}

async function initialize() {
  try {
    const migration = await migrateLegacyReviewDraft();
    const months = await fetchMonthSummaries();
    const activeMonth = months[months.length - 1]?.month || "";
    const document = activeMonth ? await fetchMonthDocument(activeMonth) : null;

    setState({
      status: "ready",
      months,
      activeMonth,
      document,
      migration
    });
  } catch (error) {
    setState({
      status: "ready",
      error: errorMessage(error, "Loading months failed.")
    });
  }
}

async function migrateLegacyReviewDraft(): Promise<MonthsMigration | null> {
  const raw = readLegacyReviewDraft();

  if (!raw) {
    return null;
  }

  const draft = parseStoredDraft(raw);

  if (!draft || draft.statements.length === 0) {
    removeLegacyReviewDraft();

    return null;
  }

  const migrated = migrateReviewDraftToMonths(draft);

  for (const document of migrated.months) {
    const existing = await fetchMonthDocument(document.month);

    await putMonthDocument(mergeMonthDocuments(existing, document));
  }

  removeLegacyReviewDraft();

  return {
    monthCount: migrated.months.length,
    statementCount:
      draft.statements.length - migrated.unresolvedStatementIds.length,
    unresolvedCount: migrated.unresolvedStatementIds.length
  };
}

function mergeMonthDocuments(
  base: MonthDocument | null,
  incoming: MonthDocument
) {
  const selectedIds = new Set(incoming.selectedIds);
  const merged = incoming.statements.reduce<MonthDocument | null>(
    (document, statement) => {
      const expenses = incoming.expenses.filter(
        (expense) => expense.statementId === statement.id
      );

      return fileStatementIntoMonth(document, {
        month: incoming.month,
        statement,
        expenses,
        selectedIds: expenses
          .map((expense) => expense.id)
          .filter((id) => selectedIds.has(id))
      });
    },
    base
  );

  return merged || incoming;
}

async function dropMonth(month: string) {
  try {
    await enqueueWrite(() => deleteMonthDocument(month));

    const months = withoutMonth(state.months, month);
    const nextMonth = neighbourMonth(months, month);
    const document = nextMonth ? await fetchMonthDocument(nextMonth) : null;

    setState({ months, activeMonth: nextMonth, document });
  } catch (error) {
    setState({ error: errorMessage(error, "Removing the month failed.") });
  }
}

function neighbourMonth(months: readonly MonthSummary[], removed: string) {
  const earlier = months.filter((entry) => entry.month < removed);

  return (earlier[earlier.length - 1] || months[0])?.month || "";
}

function scheduleWrite(document: MonthDocument) {
  pendingDocument = document;

  if (flushTimer) {
    clearTimeout(flushTimer);
  }

  flushTimer = setTimeout(() => {
    void flushMonths();
  }, WRITE_DEBOUNCE_MS);
}

function takePendingWrite() {
  const pending = pendingDocument;

  cancelPendingWrite();

  return pending;
}

function cancelPendingWrite() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  pendingDocument = null;
}

function enqueueWrite<T>(task: () => Promise<T>) {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);

  return next;
}

async function fetchMonthSummaries(): Promise<MonthSummary[]> {
  const response = await fetch("/api/months");
  const result = (await response.json()) as {
    months?: MonthSummary[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "Loading months failed.");
  }

  return result.months || [];
}

async function fetchMonthDocument(month: string): Promise<MonthDocument | null> {
  const response = await fetch(`/api/months/${month}`);
  const result = (await response.json()) as {
    document?: unknown;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "Loading the month failed.");
  }

  return result.document ? parseMonthDocument(result.document) : null;
}

async function putMonthDocument(document: MonthDocument) {
  const response = await fetch(`/api/months/${document.month}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(document)
  });
  const result = (await response.json()) as {
    summary?: MonthSummary | null;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "Saving the month failed.");
  }

  return result.summary || null;
}

async function deleteMonthDocument(month: string) {
  const response = await fetch(`/api/months/${month}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Removing the month failed.");
  }
}

function registerUnloadHandlers() {
  if (typeof window === "undefined") {
    return;
  }

  const flushOnUnload = () => {
    const pending = takePendingWrite();

    if (!pending) {
      return;
    }

    const sent = window.navigator.sendBeacon?.(
      `/api/months/${pending.month}`,
      new Blob([JSON.stringify(pending)], { type: "application/json" })
    );

    if (!sent) {
      void enqueueWrite(() => putMonthDocument(pending));
    }
  };

  window.addEventListener("pagehide", flushOnUnload);
  window.addEventListener("beforeunload", flushOnUnload);
  window.document.addEventListener("visibilitychange", () => {
    if (window.document.visibilityState === "hidden") {
      flushOnUnload();
    }
  });
}

function readLegacyReviewDraft() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(REVIEW_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function removeLegacyReviewDraft() {
  try {
    window.localStorage.removeItem(REVIEW_DRAFT_STORAGE_KEY);
  } catch {
    // A browser that refuses storage has nothing left to migrate.
  }
}

function parseStoredDraft(raw: string) {
  try {
    return parseReviewDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function withMonthSummary(
  months: readonly MonthSummary[],
  summary: MonthSummary
) {
  return [
    ...months.filter((entry) => entry.month !== summary.month),
    summary
  ].sort((first, second) => first.month.localeCompare(second.month));
}

function withoutMonth(months: readonly MonthSummary[], month: string) {
  return months.filter((entry) => entry.month !== month);
}

function setState(patch: Partial<MonthsState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
