export type CalendarExpense = {
  date: string;
  category: string;
  amount: number;
};

export function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Gross positive charges, by actual transaction date. Never invent a day for undated rows. */
export function summarizeCalendar(month: string, expenses: readonly CalendarExpense[]) {
  const first = calendarDate(`${month}-01`);
  if (!first) return null;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, "0")}`,
    day: index + 1,
    categories: new Map<string, number>(),
    total: 0,
    count: 0
  }));
  let excluded = 0;
  for (const row of expenses) {
    const date = calendarDate(row.date);
    if (!date || !row.date.startsWith(`${month}-`) || !Number.isFinite(row.amount) || row.amount <= 0) {
      excluded++;
      continue;
    }
    const day = days[date.getUTCDate() - 1];
    const category = row.category.trim() || "Uncategorized";
    // Aggregate cents to avoid a long tail of floating point rounding in the heights.
    const amount = Math.round(row.amount * 100) / 100;
    day.categories.set(category, (day.categories.get(category) ?? 0) + amount);
    day.total += amount;
    day.count++;
  }
  const totals = new Map<string, number>();
  for (const day of days) for (const [category, amount] of day.categories) {
    totals.set(category, (totals.get(category) ?? 0) + amount);
  }
  return {
    days, excluded, offset: first.getUTCDay(),
    weeks: Math.ceil((first.getUTCDay() + count) / 7),
    peak: Math.max(0, ...days.map(day => day.total)),
    total: days.reduce((sum, day) => sum + day.total, 0),
    categories: [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  };
}

const COLORS = ["--cobalt", "--coral", "--teal", "--gold", "--magenta", "--violet", "--accent", "--positive"];
/** Name-based colors remain stable when navigating months or changing category totals. */
export function calendarCategoryColor(category: string) {
  let hash = 0;
  for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(${COLORS[hash % COLORS.length]})`;
}
