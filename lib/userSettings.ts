import {
  parseCashFlowEntries,
  type CashFlowEntry
} from "@/lib/cashFlowPlan";

export const MAX_CATEGORIZATION_NOTES_LENGTH = 4000;

/**
 * The workspace configuration that belongs to the person, not to a month: the
 * cash flow inputs and outputs, and the standing category notes the extractor
 * is told to obey.
 */
export type UserSettings = {
  cashFlowEntries: CashFlowEntry[];
  categorizationNotes: string;
  updatedAt: string;
};

/**
 * What a brand new user sees. It is a worked example rather than an empty
 * panel, because an empty cash flow panel gives no hint of what an input or an
 * output is meant to be.
 */
export const DEFAULT_CASH_FLOW_ENTRIES: readonly CashFlowEntry[] = [
  {
    id: "paychecks",
    kind: "input",
    label: "Paychecks",
    amount: 0,
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
];

export function parseUserSettings(value: unknown): UserSettings {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    cashFlowEntries: parseCashFlowEntries(record.cashFlowEntries),
    categorizationNotes: normalizeCategorizationNotes(
      record.categorizationNotes
    ),
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : ""
  };
}

export function normalizeCategorizationNotes(value: unknown) {
  return typeof value === "string"
    ? value.slice(0, MAX_CATEGORIZATION_NOTES_LENGTH)
    : "";
}
