import type { ExpenseItem } from "@/lib/types";

/**
 * The row fields the expense chat may propose changing. Everything else on a
 * row - id, statement, dates, confidence - describes where the row came from,
 * so a model rewriting it would be falsifying the statement rather than
 * reviewing it.
 */
export const EXPENSE_EDIT_FIELDS = [
  "category",
  "merchant",
  "description",
  "subcategory",
  "notes",
  "amount",
  "reimbursedAmount"
] as const;

export type ExpenseEditField = (typeof EXPENSE_EDIT_FIELDS)[number];

/**
 * One field on one row, proposed and not yet applied. Field-at-a-time rather
 * than a row patch because it is exactly what the approval card shows -
 * "Meals -> Groceries" - and because a strict JSON schema cannot express an
 * object of optional fields.
 */
export type ExpenseChatEdit = {
  /** `expenseId:field`; stable, so re-proposing the same change is one card. */
  id: string;
  expenseId: string;
  /** The month document the row lives in; an approval writes back to it. */
  month: string;
  field: ExpenseEditField;
  before: string | number;
  after: string | number;
  rowLabel: string;
  date: string;
  currency: string;
  reason: string;
};

/**
 * Returns the same array when nothing matched, so an approval that races a
 * deleted row does not schedule a pointless whole-month write.
 */
export function applyExpenseEditsToRows(
  expenses: readonly ExpenseItem[],
  edits: readonly ExpenseChatEdit[]
): { expenses: readonly ExpenseItem[]; applied: number } {
  const editsByExpenseId = new Map<string, ExpenseChatEdit[]>();

  for (const edit of edits) {
    const existing = editsByExpenseId.get(edit.expenseId);

    if (existing) {
      existing.push(edit);
    } else {
      editsByExpenseId.set(edit.expenseId, [edit]);
    }
  }

  let applied = 0;
  const next = expenses.map((expense) => {
    const rowEdits = editsByExpenseId.get(expense.id);

    if (!rowEdits) {
      return expense;
    }

    let patched = expense;

    for (const edit of rowEdits) {
      const patch = patchForEdit(edit);
      // An edit replayed against a row that already holds the value is a
      // no-op: it neither rewrites the row nor counts as applied.
      const key = patch ? (Object.keys(patch)[0] as keyof ExpenseItem) : null;

      if (!patch || !key || patched[key] === patch[key]) {
        continue;
      }

      patched = { ...patched, ...patch };
      applied += 1;
    }

    return patched;
  });

  return applied === 0 ? { expenses, applied: 0 } : { expenses: next, applied };
}

function patchForEdit(edit: ExpenseChatEdit): Partial<ExpenseItem> | null {
  // Written out per field so the value type is checked rather than asserted:
  // a computed key would widen this to a string index signature.
  switch (edit.field) {
    case "amount":
      return typeof edit.after === "number" ? { amount: edit.after } : null;
    case "reimbursedAmount":
      return typeof edit.after === "number"
        ? { reimbursedAmount: edit.after }
        : null;
    case "category":
      return typeof edit.after === "string" ? { category: edit.after } : null;
    case "merchant":
      return typeof edit.after === "string" ? { merchant: edit.after } : null;
    case "description":
      return typeof edit.after === "string" ? { description: edit.after } : null;
    case "subcategory":
      return typeof edit.after === "string" ? { subcategory: edit.after } : null;
    case "notes":
      return typeof edit.after === "string" ? { notes: edit.after } : null;
  }
}
