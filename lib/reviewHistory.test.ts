import { describe, expect, test } from "bun:test";
import {
  createBulkCategoryHistoryEvent,
  parseReviewHistory,
  pushReviewHistoryEvent,
  serializeReviewHistory,
  undoReviewHistoryEvent
} from "@/lib/reviewHistory";
import type { ExpenseItem } from "@/lib/types";

const expense: ExpenseItem = {
  id: "row-1",
  date: "2026-06-05",
  postedDate: "2026-06-05",
  description: "ADOBE CREATIVE CLOUD",
  merchant: "Adobe",
  amount: 32.5,
  currency: "USD",
  category: "Other",
  subcategory: "",
  paymentMethod: "card",
  statementSection: "purchase",
  confidence: 0.92,
  notes: ""
};

describe("review history", () => {
  test("creates and parses bulk category events", () => {
    const event = createBulkCategoryHistoryEvent({
      id: "event-1",
      label: "Set 1 row to Software",
      createdAt: "2026-07-05T00:00:00.000Z",
      changes: [
        {
          itemId: expense.id,
          before: { category: "Other" },
          after: { category: "Software" }
        }
      ]
    });
    const parsed = parseReviewHistory(serializeReviewHistory([event]));

    expect(parsed.length).toBe(1);
    expect(parsed[0].label).toBe("Set 1 row to Software");
    expect(parsed[0].changes[0].before.category).toBe("Other");
    expect(parsed[0].changes[0].after.category).toBe("Software");
  });

  test("undo restores only the category field", () => {
    const event = createBulkCategoryHistoryEvent({
      id: "event-1",
      label: "Set 1 row to Software",
      changes: [
        {
          itemId: expense.id,
          before: { category: "Other" },
          after: { category: "Software" }
        }
      ]
    });
    const editedAfterCategoryChange = {
      ...expense,
      description: "Edited description",
      category: "Software"
    };
    const result = undoReviewHistoryEvent([editedAfterCategoryChange], event);

    expect(result.restoredCount).toBe(1);
    expect(result.items[0].category).toBe("Other");
    expect(result.items[0].description).toBe("Edited description");
  });

  test("keeps the history stack bounded", () => {
    const history = Array.from({ length: 31 }, (_, index) =>
      createBulkCategoryHistoryEvent({
        id: `event-${index}`,
        label: `Event ${index}`,
        changes: [
          {
            itemId: expense.id,
            before: { category: "Other" },
            after: { category: "Software" }
          }
        ]
      })
    ).reduce(
      (events, event) => pushReviewHistoryEvent(events, event),
      [] as ReturnType<typeof parseReviewHistory>
    );

    expect(history.length).toBe(30);
    expect(history[0].id).toBe("event-1");
    expect(history[29].id).toBe("event-30");
  });
});
