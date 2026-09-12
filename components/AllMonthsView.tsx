"use client";

import {
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import CashFlowSankey from "@/components/CashFlowSankey";
import SpendingCalendar from "@/components/SpendingCalendar";
import { calendarDate } from "@/lib/spendingCalendar";
import {
  EMPTY_MONTHS_TIMELINE,
  type MonthTimelineEntry,
  type MonthsTimeline,
  type TimelineTransaction,
  type YearTimelineEntry
} from "@/lib/allMonths";
import { formatCurrency } from "@/lib/currency";
import {
  DEFAULT_GRAPH_ZOOM,
  MAX_GRAPH_ZOOM,
  MIN_GRAPH_ZOOM,
  nextGraphZoomLevel
} from "@/lib/graphZoom";
import { formatMonthLabel } from "@/lib/months";
import { flushMonths } from "@/lib/monthsClientStore";

type TimelineStatus = "loading" | "ready" | "error";

/**
 * The overview renders the same cash flow graph two ways: `compare` is one
 * card per month side by side, `year` is a single graph over every transaction
 * in one calendar year, so a category is one ribbon for the year rather than
 * twelve slices to eyeball across cards.
 */
type OverviewMode = "compare" | "year" | "calendar";

const OVERVIEW_MODES: { value: OverviewMode; label: string }[] = [
  { value: "compare", label: "Compare" },
  { value: "year", label: "Year" },
  { value: "calendar", label: "3D Calendar" }
];

/**
 * Width of one month card at 100%. The Sankey is 1360 user units wide, so this
 * renders its labels at roughly the size the single-month panel shows them:
 * legible first, with the row scrolling sideways to reach the other months,
 * rather than every month squeezed into one screen and unreadable.
 */
const MONTH_CARD_WIDTH = 1040;

export function AllMonthsView({
  onSelectMonth
}: {
  onSelectMonth: (month: string) => void;
}) {
  const [timeline, setTimeline] = useState<MonthsTimeline>(
    EMPTY_MONTHS_TIMELINE
  );
  const [status, setStatus] = useState<TimelineStatus>("loading");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_GRAPH_ZOOM);
  const [mode, setMode] = useState<OverviewMode>("compare");
  const [selectedYear, setSelectedYear] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [calendarMonth, setCalendarMonth] = useState("");
  // Actual transaction months can differ from the month a billing cycle was filed in.
  const calendarMonths = useMemo(() => [...new Set([
    ...timeline.months.map(entry => entry.month),
    ...timeline.transactions.filter(row => calendarDate(row.date)).map(row => row.date.slice(0, 7)),
    ...timeline.incomes.filter(row => calendarDate(row.date)).map(row => row.date.slice(0, 7))
  ])].sort(), [timeline.months, timeline.transactions, timeline.incomes]);
  const activeCalendarMonth = calendarMonths.includes(calendarMonth) ? calendarMonth : calendarMonths.at(-1);
  const calendarExpenses = useMemo(() => timeline.transactions.filter(row => row.date.startsWith(`${activeCalendarMonth}-`)), [timeline.transactions, activeCalendarMonth]);

  const calendarIncomes = useMemo(() => timeline.incomes.filter(row => row.date.startsWith(`${activeCalendarMonth}-`)), [timeline.incomes, activeCalendarMonth]);

  /** Clicking the category that is already filtered clears the filter. */
  function toggleCategory(category: string) {
    setCategoryFilter((current) => (current === category ? "" : category));
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        // The workspace writes the active month on a debounce, so an unflushed
        // edit would otherwise be missing from the month shown beside it.
        await flushMonths();

        const response = await fetch("/api/months/overview", {
          cache: "no-store"
        });
        const payload = (await response.json()) as {
          timeline?: MonthsTimeline;
          error?: string;
        };

        if (!response.ok || !payload.timeline) {
          throw new Error(
            payload.error || "Loading the all-months overview failed."
          );
        }

        if (!active) {
          return;
        }

        setTimeline(payload.timeline);
        setStatus("ready");
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Loading the all-months overview failed."
        );
        setStatus("error");
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  function reload() {
    setStatus("loading");
    setError("");
    setReloadKey((current) => current + 1);
  }

  const currency = timeline.currency;
  const savedTotal = timeline.savedTotal;
  const years = timeline.years;
  // A year picked by hand survives a reload; otherwise fall to the current
  // calendar year, and to the most recent filed year when this year is empty -
  // an overview that opens on a blank year would look like data loss.
  const activeYear = useMemo(
    () => resolveYear(years, selectedYear),
    [years, selectedYear]
  );
  // Year mode lists that year's rows; Compare spans every filed month, so its
  // table is the whole ledger in the same order. A category picked in any
  // graph narrows whichever set that is.
  const transactions = useMemo(() => {
    const scoped =
      mode === "year"
        ? timeline.transactions.filter(
            (transaction) => transaction.month.slice(0, 4) === activeYear?.year
          )
        : timeline.transactions;

    return categoryFilter
      ? scoped.filter(
          (transaction) => transaction.category === categoryFilter
        )
      : scoped;
  }, [activeYear, categoryFilter, mode, timeline.transactions]);

  return (
    <section className="workspace all-months" aria-label="All months">
      <div className="workspace-top">
        <div>
          <p className="eyebrow">{mode === "year" ? "Year" : "All months"}</p>
          <h2>{describeHeading(mode, timeline, activeYear)}</h2>
        </div>

        <div className="stats-strip all-months-stats">
          {mode === "year" && activeYear ? (
            <>
              <AllMonthsStat
                label="Months"
                value={String(activeYear.monthCount)}
              />
              <AllMonthsStat
                label="Income"
                value={formatCurrency(
                  activeYear.summary.incomeTotal,
                  currency
                )}
              />
              <AllMonthsStat
                label="Spend"
                value={formatCurrency(
                  activeYear.summary.allocatedTotal,
                  currency
                )}
              />
              <AllMonthsStat
                label={activeYear.summary.savedAmount < 0 ? "Overspent" : "Saved"}
                value={formatCurrency(
                  Math.abs(activeYear.summary.savedAmount),
                  currency
                )}
              />
            </>
          ) : (
            <>
              <AllMonthsStat
                label="Months"
                value={String(timeline.months.length)}
              />
              <AllMonthsStat
                label="Income"
                value={formatCurrency(timeline.incomeTotal, currency)}
              />
              <AllMonthsStat
                label="Spend"
                value={formatCurrency(timeline.spendTotal, currency)}
              />
              <AllMonthsStat
                label={savedTotal < 0 ? "Overspent" : "Saved"}
                value={formatCurrency(Math.abs(savedTotal), currency)}
              />
            </>
          )}
        </div>
      </div>

      <div className="all-months-toolbar">
        <div className="all-months-modes">
          <div className="graph-type-control" aria-label="Overview mode">
            {OVERVIEW_MODES.map((option) => (
              <button
                className={mode === option.value ? "active" : ""}
                key={option.value}
                type="button"
                aria-pressed={mode === option.value}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p>
            {mode === "calendar"
              ? "Daily spending by transaction date. Choose a month, then drag to explore its category-colored towers."
              : mode === "year"
              ? "Every transaction in the year as one cash flow, the same graph the month view draws. Savings climb out of the top; overspending pours in from it."
              : "Every month's cash flow side by side. Savings climb out of the top of a month's frame; overspending pours in from the top. Click a month to open it."}
          </p>
        </div>
        <div className="graph-zoom-controls" aria-label="Graph zoom controls">
          <span className="calendar-overview-zoom" hidden={mode === "calendar"}>
          <button
            className="mini-icon-button"
            type="button"
            title="Zoom out"
            aria-label="Zoom out months"
            disabled={zoom <= MIN_GRAPH_ZOOM}
            onClick={() => setZoom((current) => nextGraphZoomLevel(current, "out"))}
          >
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <button
            className="graph-zoom-reset"
            type="button"
            title="Reset zoom"
            aria-label="Reset month zoom"
            disabled={zoom === DEFAULT_GRAPH_ZOOM}
            onClick={() => setZoom(DEFAULT_GRAPH_ZOOM)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="mini-icon-button"
            type="button"
            title="Zoom in"
            aria-label="Zoom in months"
            disabled={zoom >= MAX_GRAPH_ZOOM}
            onClick={() => setZoom((current) => nextGraphZoomLevel(current, "in"))}
          >
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          </span>
          <button
            className="icon-button"
            type="button"
            title="Reload all months"
            aria-label="Reload all months"
            disabled={status === "loading"}
            onClick={reload}
          >
            {status === "loading" ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {status === "error" ? (
        <div className="notice error all-months-notice">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {status !== "error" && timeline.months.length === 0 ? (
        <div className="empty-state">
          {status === "loading"
            ? "Loading every filed month."
            : "No months filed yet. Extract a statement to start the timeline."}
        </div>
      ) : null}

      {mode === "calendar" && activeCalendarMonth ? <div className="calendar-overview">
        <label className="calendar-month-picker">Calendar month
          <select value={activeCalendarMonth} onChange={event => setCalendarMonth(event.target.value)}>
            {calendarMonths.map(month => <option key={month} value={month}>{formatMonthLabel(month)}</option>)}
          </select>
        </label>
        <SpendingCalendar month={activeCalendarMonth} expenses={calendarExpenses} incomes={calendarIncomes} currency={currency} />
        {timeline.transactions.some(row => !calendarDate(row.date)) ? <p className="calendar-excluded">Rows without valid transaction dates remain in the table below and cannot be placed on a calendar.</p> : null}
      </div> : null}

      {mode === "year" && years.length > 1 ? (
        <div className="graph-type-control all-months-years" aria-label="Year">
          {years.map((year) => (
            <button
              className={year.year === activeYear?.year ? "active" : ""}
              key={year.year}
              type="button"
              aria-pressed={year.year === activeYear?.year}
              onClick={() => setSelectedYear(year.year)}
            >
              {year.year}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "year" && activeYear ? (
        // The riser leaves through the top of the frame, so the chart is
        // clipped by its own card exactly as a month card clips it.
        <div
          className={`all-months-year-chart ${
            activeYear.summary.savedAmount < 0 ? "overspent" : "saved"
          }`}
        >
          <CashFlowSankey
            currency={currency}
            idPrefix={`sankey-year-${activeYear.year}`}
            onSelectCategory={toggleCategory}
            selectedCategory={categoryFilter}
            summary={activeYear.summary}
            zoom={zoom}
          />
        </div>
      ) : null}

      {mode === "compare" && timeline.months.length > 0 ? (
        <div
          className="all-months-row"
          aria-label="Cash flow per month"
        >
          {timeline.months.map((month) => (
            <MonthFlowCard
              currency={currency}
              key={month.month}
              month={month}
              onSelect={onSelectMonth}
              onSelectCategory={toggleCategory}
              selectedCategory={categoryFilter}
              width={Math.round(MONTH_CARD_WIDTH * zoom)}
            />
          ))}
        </div>
      ) : null}

      {timeline.transactions.length > 0 ? (
        <TransactionsTable
          categoryFilter={categoryFilter}
          currency={currency}
          onClearCategory={() => setCategoryFilter("")}
          onSelectMonth={onSelectMonth}
          transactions={transactions}
        />
      ) : null}
    </section>
  );
}

/** Hand-picked year, else this calendar year, else the most recent filed one. */
function resolveYear(
  years: readonly YearTimelineEntry[],
  selected: string
): YearTimelineEntry | null {
  if (years.length === 0) {
    return null;
  }

  return (
    years.find((year) => year.year === selected) ??
    years.find((year) => year.year === String(new Date().getFullYear())) ??
    years[years.length - 1]
  );
}

function describeHeading(
  mode: OverviewMode,
  timeline: MonthsTimeline,
  year: YearTimelineEntry | null
) {
  if (mode === "year") {
    return year ? year.year : "Nothing filed yet";
  }

  if (timeline.months.length === 0) {
    return "Nothing filed yet";
  }

  return `${formatMonthLabel(timeline.months[0].month)} - ${formatMonthLabel(
    timeline.months[timeline.months.length - 1].month
  )}`;
}

/**
 * The rows behind the graphs, read-only: editing a row means opening its month,
 * where the review table owns the optimistic write path and the undo history.
 * The month cell is the way in.
 */
function TransactionsTable({
  categoryFilter,
  currency,
  onClearCategory,
  onSelectMonth,
  transactions
}: {
  categoryFilter: string;
  currency: string;
  onClearCategory: () => void;
  onSelectMonth: (month: string) => void;
  transactions: readonly TimelineTransaction[];
}) {
  const grossTotal = transactions.reduce(
    (total, transaction) => total + transaction.amount,
    0
  );
  const netTotal = transactions.reduce(
    (total, transaction) =>
      total + transaction.amount - transaction.reimbursedAmount,
    0
  );

  return (
    <section className="all-months-transactions" aria-label="Transactions">
      <div className="all-months-transactions-heading">
        <p className="eyebrow">Transactions</p>
        {categoryFilter ? (
          <button
            className="category-filter-chip"
            type="button"
            title="Clear the category filter"
            onClick={onClearCategory}
          >
            <span>{categoryFilter}</span>
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
        <p>
          {transactions.length}{" "}
          {transactions.length === 1 ? "row" : "rows"} &middot;{" "}
          {formatCurrency(grossTotal, currency)}
          {netTotal === grossTotal
            ? ""
            : ` gross, ${formatCurrency(netTotal, currency)} net`}
        </p>
      </div>
      {transactions.length === 0 ? (
        <div className="empty-state">
          No {categoryFilter} rows here. Clear the filter, or pick another
          category in the graph.
        </div>
      ) : null}
      {transactions.length > 0 ? (
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Month</th>
              <th>Merchant</th>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={`${transaction.month}-${transaction.id}`}>
                <td>{transaction.date || "-"}</td>
                <td>
                  <button
                    className="statement-chip"
                    type="button"
                    title="Open this month"
                    onClick={() => onSelectMonth(transaction.month)}
                  >
                    {formatMonthLabel(transaction.month)}
                  </button>
                </td>
                <td>{transaction.merchant || "-"}</td>
                <td>{transaction.description}</td>
                <td>{transaction.category}</td>
                <td>
                  {formatCurrency(transaction.amount, currency)}
                  {transaction.reimbursedAmount > 0 ? (
                    <span className="net-amount">
                      net{" "}
                      {formatCurrency(
                        transaction.amount - transaction.reimbursedAmount,
                        currency
                      )}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : null}
    </section>
  );
}

function MonthFlowCard({
  currency,
  month,
  onSelect,
  onSelectCategory,
  selectedCategory,
  width
}: {
  currency: string;
  month: MonthTimelineEntry;
  onSelect: (month: string) => void;
  onSelectCategory: (category: string) => void;
  selectedCategory: string;
  /** Zoom is card width: the chart fills whatever it is given. */
  width: number;
}) {
  return (
    <article
      className={`all-months-month ${
        month.summary.savedAmount < 0 ? "overspent" : "saved"
      }`}
      style={{ width: `${width}px` }}
    >
      <button
        className="all-months-month-heading"
        type="button"
        title="Open this month"
        onClick={() => onSelect(month.month)}
      >
        {formatMonthLabel(month.month)}
      </button>
      {/* Riser shapes leave through the top of the card, which is what reads
          as money going off-page; the card clips them. */}
      <div className="all-months-month-chart">
        <CashFlowSankey
          currency={currency}
          fit
          idPrefix={`sankey-${month.month}`}
          onSelectCategory={onSelectCategory}
          selectedCategory={selectedCategory}
          summary={month.summary}
        />
      </div>
    </article>
  );
}

function AllMonthsStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
