"use client";

import {
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useEffect, useState } from "react";

import CashFlowSankey from "@/components/CashFlowSankey";
import {
  EMPTY_MONTHS_TIMELINE,
  type MonthTimelineEntry,
  type MonthsTimeline
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

  return (
    <section className="workspace all-months" aria-label="All months">
      <div className="workspace-top">
        <div>
          <p className="eyebrow">All months</p>
          <h2>
            {timeline.months.length > 0
              ? `${formatMonthLabel(timeline.months[0].month)} - ${formatMonthLabel(
                  timeline.months[timeline.months.length - 1].month
                )}`
              : "Nothing filed yet"}
          </h2>
        </div>

        <div className="stats-strip all-months-stats">
          <AllMonthsStat label="Months" value={String(timeline.months.length)} />
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
        </div>
      </div>

      <div className="all-months-toolbar">
        <p>
          Every month&apos;s cash flow side by side. Savings climb out of the
          top of a month&apos;s frame; overspending pours in from the top.
          Click a month to open it.
        </p>
        <div className="graph-zoom-controls" aria-label="Graph zoom controls">
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

      {timeline.months.length > 0 ? (
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
              width={Math.round(MONTH_CARD_WIDTH * zoom)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MonthFlowCard({
  currency,
  month,
  onSelect,
  width
}: {
  currency: string;
  month: MonthTimelineEntry;
  onSelect: (month: string) => void;
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
