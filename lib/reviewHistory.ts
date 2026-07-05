import type { ExpenseItem } from "@/lib/types";

export const REVIEW_HISTORY_STORAGE_KEY = "statement-ledger.review-history";

const REVIEW_HISTORY_VERSION = 1;
const MAX_REVIEW_HISTORY_EVENTS = 30;

export type ReviewItemHistoryChange = {
  itemId: string;
  before: Pick<ExpenseItem, "category">;
  after: Pick<ExpenseItem, "category">;
};

export type ReviewHistoryEvent = {
  version: typeof REVIEW_HISTORY_VERSION;
  id: string;
  kind: "statement-items";
  action: "bulk-category";
  label: string;
  createdAt: string;
  changes: ReviewItemHistoryChange[];
};

export type ReviewHistoryUndoResult = {
  items: ExpenseItem[];
  restoredCount: number;
  missingCount: number;
};

export function createBulkCategoryHistoryEvent(input: {
  id: string;
  label: string;
  changes: readonly ReviewItemHistoryChange[];
  createdAt?: string;
}): ReviewHistoryEvent {
  return {
    version: REVIEW_HISTORY_VERSION,
    id: input.id,
    kind: "statement-items",
    action: "bulk-category",
    label: input.label,
    createdAt: input.createdAt || new Date().toISOString(),
    changes: input.changes
      .filter((change) => change.before.category !== change.after.category)
      .map((change) => ({
        itemId: change.itemId,
        before: { category: change.before.category },
        after: { category: change.after.category }
      }))
  };
}

export function pushReviewHistoryEvent(
  history: readonly ReviewHistoryEvent[],
  event: ReviewHistoryEvent
) {
  if (event.changes.length === 0) {
    return [...history];
  }

  return [...history, event].slice(-MAX_REVIEW_HISTORY_EVENTS);
}

export function undoReviewHistoryEvent(
  items: readonly ExpenseItem[],
  event: ReviewHistoryEvent
): ReviewHistoryUndoResult {
  const changesByItemId = new Map(
    event.changes.map((change) => [change.itemId, change])
  );
  let restoredCount = 0;

  const nextItems = items.map((item) => {
    const change = changesByItemId.get(item.id);

    if (!change) {
      return item;
    }

    restoredCount += 1;
    return {
      ...item,
      category: change.before.category
    };
  });

  return {
    items: nextItems,
    restoredCount,
    missingCount: event.changes.length - restoredCount
  };
}

export function parseReviewHistory(value: unknown): ReviewHistoryEvent[] {
  const record = asRecord(value);
  const rawEvents = Array.isArray(value)
    ? value
    : Array.isArray(record?.events)
      ? record.events
      : [];

  return rawEvents.flatMap((event) => {
    const parsed = parseReviewHistoryEvent(event);

    return parsed ? [parsed] : [];
  });
}

export function serializeReviewHistory(
  events: readonly ReviewHistoryEvent[]
) {
  return {
    version: REVIEW_HISTORY_VERSION,
    events
  };
}

function parseReviewHistoryEvent(value: unknown): ReviewHistoryEvent | null {
  const record = asRecord(value);

  if (
    !record ||
    record.version !== REVIEW_HISTORY_VERSION ||
    record.kind !== "statement-items" ||
    record.action !== "bulk-category"
  ) {
    return null;
  }

  const changes = Array.isArray(record.changes)
    ? record.changes.flatMap((change) => {
        const parsed = parseReviewItemHistoryChange(change);

        return parsed ? [parsed] : [];
      })
    : [];

  if (changes.length === 0) {
    return null;
  }

  return {
    version: REVIEW_HISTORY_VERSION,
    id: asString(record.id),
    kind: "statement-items",
    action: "bulk-category",
    label: asString(record.label, "Bulk category change"),
    createdAt: asString(record.createdAt),
    changes
  };
}

function parseReviewItemHistoryChange(
  value: unknown
): ReviewItemHistoryChange | null {
  const record = asRecord(value);
  const before = asRecord(record?.before);
  const after = asRecord(record?.after);
  const itemId = asString(record?.itemId);
  const beforeCategory = asString(before?.category);
  const afterCategory = asString(after?.category);

  if (!itemId || !beforeCategory || !afterCategory) {
    return null;
  }

  return {
    itemId,
    before: { category: beforeCategory },
    after: { category: afterCategory }
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
