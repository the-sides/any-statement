import type { ExpenseItem } from "@/lib/types";

export const CASH_FLOW_PLAN_STORAGE_KEY = "statement-ledger.cash-flow-plan";

const CASH_FLOW_PLAN_VERSION = 1;

export type CashFlowEntryKind = "input" | "output";

export type CashFlowEntry = {
  id: string;
  kind: CashFlowEntryKind;
  label: string;
  amount: number;
  enabled: boolean;
};

export type CashFlowPlan = {
  version: typeof CASH_FLOW_PLAN_VERSION;
  entries: CashFlowEntry[];
  savedAt: string;
};

export type CashFlowAllocationSource =
  | "manual-output"
  | "category"
  | "saved"
  | "overspent";

export type CashFlowAllocation = {
  id: string;
  label: string;
  amount: number;
  percent: number;
  source: CashFlowAllocationSource;
};

export type CashFlowSummary = {
  inputs: CashFlowEntry[];
  manualOutputs: CashFlowEntry[];
  allocations: CashFlowAllocation[];
  incomeTotal: number;
  manualOutputTotal: number;
  categorySpendTotal: number;
  allocatedTotal: number;
  savedAmount: number;
  percentBasis: number;
};

export function createCashFlowPlan(
  entries: readonly CashFlowEntry[]
): CashFlowPlan {
  return {
    version: CASH_FLOW_PLAN_VERSION,
    entries: entries.map((entry, index) => normalizeEntry(entry, index)),
    savedAt: new Date().toISOString()
  };
}

export function parseCashFlowPlan(value: unknown): CashFlowPlan | null {
  const record = asRecord(value);

  if (!record || record.version !== CASH_FLOW_PLAN_VERSION) {
    return null;
  }

  return {
    version: CASH_FLOW_PLAN_VERSION,
    entries: Array.isArray(record.entries)
      ? record.entries.flatMap((entry, index) => {
          const parsed = parseEntry(entry, index);

          return parsed ? [parsed] : [];
        })
      : [],
    savedAt: asString(record.savedAt)
  };
}

export function summarizeCashFlow(
  entries: readonly CashFlowEntry[],
  expenses: readonly ExpenseItem[]
): CashFlowSummary {
  const activeEntries = entries.filter((entry) => entry.enabled);
  const inputs = activeEntries.filter(
    (entry) => entry.kind === "input" && entry.amount > 0
  );
  const manualOutputs = activeEntries.filter(
    (entry) => entry.kind === "output" && entry.amount > 0
  );
  const incomeTotal = sumAmounts(inputs);
  const manualOutputTotal = sumAmounts(manualOutputs);
  const categoryTotals = summarizeCategories(expenses);
  const categorySpendTotal = categoryTotals.reduce(
    (sum, category) => sum + category.amount,
    0
  );
  const allocatedTotal = manualOutputTotal + categorySpendTotal;
  const savedAmount = incomeTotal - allocatedTotal;
  const percentBasis = Math.max(incomeTotal || allocatedTotal, 1);
  const outflowAllocations: CashFlowAllocation[] = [
    ...manualOutputs.map((entry) => ({
      id: `manual-${entry.id}`,
      label: entry.label,
      amount: entry.amount,
      percent: toPercent(entry.amount, percentBasis),
      source: "manual-output" as const
    })),
    ...categoryTotals.map((category) => ({
      id: `category-${category.label.toLowerCase()}`,
      label: category.label,
      amount: category.amount,
      percent: toPercent(category.amount, percentBasis),
      source: "category" as const
    }))
  ].sort((left, right) => right.amount - left.amount);

  const remainderAllocation =
    savedAmount === 0
      ? []
      : [
          {
            id: savedAmount > 0 ? "saved" : "overspent",
            label: savedAmount > 0 ? "Saved" : "Overspent",
            amount: Math.abs(savedAmount),
            percent: toPercent(Math.abs(savedAmount), percentBasis),
            source: savedAmount > 0 ? ("saved" as const) : ("overspent" as const)
          }
        ];

  return {
    inputs,
    manualOutputs,
    allocations: [...remainderAllocation, ...outflowAllocations],
    incomeTotal,
    manualOutputTotal,
    categorySpendTotal,
    allocatedTotal,
    savedAmount,
    percentBasis
  };
}

function summarizeCategories(expenses: readonly ExpenseItem[]) {
  const totals = new Map<string, number>();

  for (const expense of expenses) {
    if (expense.amount <= 0) {
      continue;
    }

    const label = expense.category.trim() || "Other";
    totals.set(label, (totals.get(label) || 0) + expense.amount);
  }

  return [...totals.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .sort((left, right) => right.amount - left.amount);
}

function normalizeEntry(entry: CashFlowEntry, index: number): CashFlowEntry {
  return {
    id: entry.id.trim() || `${entry.kind}-${index + 1}`,
    kind: entry.kind,
    label:
      entry.label.trim() || (entry.kind === "input" ? "Income" : "Output"),
    amount: normalizeAmount(entry.amount),
    enabled: entry.enabled
  };
}

function parseEntry(value: unknown, index: number): CashFlowEntry | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const kind = parseKind(record.kind);
  const amount = parseAmount(record.amount);

  if (!kind || amount === null) {
    return null;
  }

  return normalizeEntry(
    {
      id: asString(record.id, `${kind}-${index + 1}`),
      kind,
      label: asString(record.label),
      amount,
      enabled: record.enabled !== false
    },
    index
  );
}

function parseKind(value: unknown): CashFlowEntryKind | null {
  return value === "input" || value === "output" ? value : null;
}

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function normalizeAmount(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function sumAmounts(entries: readonly CashFlowEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

function toPercent(amount: number, basis: number) {
  return basis > 0 ? (amount / basis) * 100 : 0;
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
