export type ExpenseCategorySource = "app" | "notion";

export type ExpenseCategoryDefinition = {
  name: string;
  enabled: boolean;
  description: string;
  source: ExpenseCategorySource;
  sourceId?: string;
  sortOrder?: number;
};

export type ExpenseCategoryDefinitionInput = {
  name: string;
  enabled?: boolean;
  description?: string;
  source?: ExpenseCategorySource;
  sourceId?: string;
  sortOrder?: number;
};

export const FALLBACK_CATEGORY_NAME = "Other";

export const DEFAULT_EXPENSE_CATEGORY_DEFINITIONS: ExpenseCategoryDefinition[] = [
  {
    name: "Meals",
    enabled: true,
    description: "Restaurants, catering, coffee, food delivery, and business meals.",
    source: "app",
    sortOrder: 10
  },
  {
    name: "Travel",
    enabled: true,
    description: "Flights, hotels, rideshare, taxis, parking, fuel, and trip expenses.",
    source: "app",
    sortOrder: 20
  },
  {
    name: "Software",
    enabled: true,
    description: "SaaS, cloud tools, subscriptions, apps, hosting, and digital services.",
    source: "app",
    sortOrder: 30
  },
  {
    name: "Office",
    enabled: true,
    description: "Office operations, workplace expenses, postage, and equipment.",
    source: "app",
    sortOrder: 40
  },
  {
    name: "Utilities",
    enabled: true,
    description: "Internet, phone, power, water, and other recurring utility bills.",
    source: "app",
    sortOrder: 50
  },
  {
    name: "Bank Fees",
    enabled: true,
    description: "Wire fees, account fees, card fees, interest, and other bank charges.",
    source: "app",
    sortOrder: 60
  },
  {
    name: "Payroll",
    enabled: true,
    description: "Payroll, contractor payroll platforms, benefits, and wage-related costs.",
    source: "app",
    sortOrder: 70
  },
  {
    name: "Rent",
    enabled: true,
    description: "Office rent, coworking space, storage rent, and lease payments.",
    source: "app",
    sortOrder: 80
  },
  {
    name: "Taxes",
    enabled: true,
    description: "Tax payments, filings, government fees, and compliance charges.",
    source: "app",
    sortOrder: 90
  },
  {
    name: "Insurance",
    enabled: true,
    description: "Business insurance, liability coverage, health plans, and premiums.",
    source: "app",
    sortOrder: 100
  },
  {
    name: "Marketing",
    enabled: true,
    description: "Ads, sponsorships, design, content, events, and promotional spending.",
    source: "app",
    sortOrder: 110
  },
  {
    name: "Professional Services",
    enabled: true,
    description: "Legal, accounting, consulting, recruiting, and other expert services.",
    source: "app",
    sortOrder: 120
  },
  {
    name: "Supplies",
    enabled: true,
    description: "Materials, small equipment, store purchases, shipping supplies, and parts.",
    source: "app",
    sortOrder: 130
  },
  {
    name: "Transfer",
    enabled: true,
    description: "Business transfers, balance transfers, cash advances, and internal movement.",
    source: "app",
    sortOrder: 140
  },
  {
    name: FALLBACK_CATEGORY_NAME,
    enabled: true,
    description: "Use only when no more specific enabled category fits the transaction.",
    source: "app",
    sortOrder: 150
  }
];

export const EXPENSE_CATEGORIES = DEFAULT_EXPENSE_CATEGORY_DEFINITIONS.map(
  (category) => category.name
);

export const PAYMENT_METHODS = [
  "card",
  "ach",
  "wire",
  "check",
  "cash",
  "unknown"
] as const;

export const STATEMENT_SECTIONS = [
  "purchase",
  "payment",
  "fee",
  "interest",
  "transfer",
  "withdrawal",
  "deposit",
  "other"
] as const;

export const STATEMENT_TYPES = ["credit_card", "bank", "other"] as const;

export type ExpenseCategory = string;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type StatementSection = (typeof STATEMENT_SECTIONS)[number];
export type StatementType = (typeof STATEMENT_TYPES)[number];

export function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCategoryDefinitions(
  categories: readonly ExpenseCategoryDefinitionInput[]
): ExpenseCategoryDefinition[] {
  const definitions = new Map<string, ExpenseCategoryDefinition>();

  categories.forEach((category, index) => {
    const name = normalizeCategoryName(category.name || "");

    if (!name) {
      return;
    }

    const key = name.toLowerCase();
    const existing = definitions.get(key);
    const next: ExpenseCategoryDefinition = {
      name,
      enabled: category.enabled !== false,
      description: normalizeDescription(category.description),
      source: category.source || "app",
      sourceId: category.sourceId,
      sortOrder: category.sortOrder ?? existing?.sortOrder ?? (index + 1) * 10
    };

    definitions.set(key, mergeCategoryDefinition(existing, next));
  });

  return sortCategoryDefinitions([...definitions.values()]);
}

export function mergeCategoryDefinitions(
  existing: readonly ExpenseCategoryDefinitionInput[],
  incoming: readonly ExpenseCategoryDefinitionInput[]
) {
  const definitions = new Map(
    normalizeCategoryDefinitions(existing).map((category) => [
      category.name.toLowerCase(),
      category
    ])
  );

  for (const category of incoming) {
    const name = normalizeCategoryName(category.name || "");

    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const current = definitions.get(key);
    const next: ExpenseCategoryDefinition = {
      name,
      enabled: category.enabled ?? current?.enabled ?? true,
      description:
        normalizeDescription(category.description) || current?.description || "",
      source: category.source || current?.source || "app",
      sourceId: category.sourceId || current?.sourceId,
      sortOrder: category.sortOrder ?? current?.sortOrder
    };

    definitions.set(key, mergeCategoryDefinition(current, next));
  }

  return sortCategoryDefinitions([...definitions.values()]);
}

export function getEnabledCategoryDefinitions(
  categories: readonly ExpenseCategoryDefinitionInput[]
) {
  const enabled = normalizeCategoryDefinitions(categories).filter(
    (category) => category.enabled
  );

  if (enabled.length > 0) {
    return enabled;
  }

  return [
    {
      name: FALLBACK_CATEGORY_NAME,
      enabled: true,
      description: "Fallback category used when every stored category is disabled.",
      source: "app" as const,
      sortOrder: 9999
    }
  ];
}

export function getEnabledCategoryNames(
  categories: readonly ExpenseCategoryDefinitionInput[]
) {
  return getEnabledCategoryDefinitions(categories).map((category) => category.name);
}

export function getDefaultCategoryName(categoryNames: readonly string[]) {
  return (
    categoryNames.find(
      (category) => category.toLowerCase() === FALLBACK_CATEGORY_NAME.toLowerCase()
    ) ||
    categoryNames[0] ||
    FALLBACK_CATEGORY_NAME
  );
}

export function coerceCategoryName(
  value: unknown,
  categoryNames: readonly string[]
) {
  const fallback = getDefaultCategoryName(categoryNames);

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = normalizeCategoryName(value);
  const match = categoryNames.find(
    (category) => category.toLowerCase() === normalized.toLowerCase()
  );

  return match || fallback;
}

function mergeCategoryDefinition(
  existing: ExpenseCategoryDefinition | undefined,
  next: ExpenseCategoryDefinition
) {
  return {
    ...existing,
    ...next,
    description: next.description || existing?.description || "",
    sourceId: next.sourceId || existing?.sourceId,
    sortOrder: next.sortOrder ?? existing?.sortOrder
  };
}

function normalizeDescription(value: string | undefined) {
  return normalizeCategoryName(value || "");
}

function sortCategoryDefinitions(categories: ExpenseCategoryDefinition[]) {
  return categories.sort((a, b) => {
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return a.name.localeCompare(b.name);
  });
}
