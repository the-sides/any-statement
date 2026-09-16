"use client";

import {
  ArrowLeft,
  ChevronDown,
  FileText,
  LoaderCircle,
  RefreshCw,
  TriangleAlert
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { formatCurrency } from "@/lib/currency";
import {
  EMPTY_DOCUMENTS_INDEX,
  type DocumentsIndex,
  type LedgerDocument
} from "@/lib/documents";
import { formatMonthLabel } from "@/lib/months";
import { flushMonths } from "@/lib/monthsClientStore";

type IndexStatus = "loading" | "ready" | "error";

/**
 * Every uploaded statement, with the rows it produced, its totals, and the
 * months they were filed into. Read-only: the review table on `/` owns the
 * write path and the undo history, so a month chip is the way to edit.
 */
export function DocumentManager() {
  const [index, setIndex] = useState<DocumentsIndex>(EMPTY_DOCUMENTS_INDEX);
  const [status, setStatus] = useState<IndexStatus>("loading");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        // The workspace writes the active month on a debounce, so an unflushed
        // edit would otherwise be missing from the document it belongs to.
        await flushMonths();

        const response = await fetch("/api/documents", { cache: "no-store" });
        const payload = (await response.json()) as {
          index?: DocumentsIndex;
          error?: string;
        };

        if (!response.ok || !payload.index) {
          throw new Error(
            payload.error || "Loading the document manager failed."
          );
        }

        if (!active) {
          return;
        }

        setIndex(payload.index);
        setStatus("ready");
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Loading the document manager failed."
        );
        setStatus("error");
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const currency = index.currency;

  return (
    <main className="app-shell docs-shell">
      <header className="app-header docs-header">
        <div className="brand-lockup">
          <Link
            className="mini-icon-button docs-back"
            href="/"
            title="Back to the ledger"
            aria-label="Back to the ledger"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>
          <div className="brand-mark">SL</div>
          <div>
            <p className="eyebrow">Statement Ledger</p>
            <h1>Documents</h1>
          </div>
        </div>

        <div className="docs-header-actions">
          <button
            className="icon-button"
            type="button"
            title="Reload documents"
            aria-label="Reload documents"
            disabled={status === "loading"}
            onClick={() => {
              setStatus("loading");
              setError("");
              setReloadKey((current) => current + 1);
            }}
          >
            {status === "loading" ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            )}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <section className="workspace docs-workspace" aria-label="Documents">
        <div className="workspace-top">
          <div>
            <p className="eyebrow">Uploads</p>
            <h2>
              {index.documents.length}{" "}
              {index.documents.length === 1 ? "statement" : "statements"}
            </h2>
          </div>

          <div className="stats-strip docs-stats">
            <DocumentStat
              label="Months"
              value={String(index.monthCount)}
            />
            <DocumentStat label="Rows" value={String(index.expenseCount)} />
            <DocumentStat
              label="Spend"
              value={formatCurrency(index.grossTotal, currency)}
            />
            <DocumentStat
              label="Net"
              value={formatCurrency(index.netTotal, currency)}
            />
            <DocumentStat
              label="Income"
              value={formatCurrency(index.incomeTotal, currency)}
            />
          </div>
        </div>

        {status === "error" ? (
          <div className="notice error">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {status !== "error" && index.documents.length === 0 ? (
          <div className="empty-state">
            {status === "loading"
              ? "Loading every uploaded statement."
              : "No statements uploaded yet. Extract one on the ledger and it shows up here."}
          </div>
        ) : null}

        {index.documents.length > 0 ? (
          <div className="docs-list">
            {index.documents.map((document) => (
              <DocumentCard
                currency={currency}
                document={document}
                expanded={expandedIds.has(document.id)}
                key={document.id}
                onToggle={() =>
                  setExpandedIds((current) => {
                    const next = new Set(current);

                    if (!next.delete(document.id)) {
                      next.add(document.id);
                    }

                    return next;
                  })
                }
              />
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function DocumentCard({
  currency,
  document,
  expanded,
  onToggle
}: {
  currency: string;
  document: LedgerDocument;
  expanded: boolean;
  onToggle: () => void;
}) {
  const reimbursed = document.reimbursedTotal > 0;

  return (
    <article className="docs-card">
      <button
        className="docs-card-top"
        type="button"
        aria-expanded={expanded}
        title={expanded ? "Hide transactions" : "Show transactions"}
        onClick={onToggle}
      >
        <span className="docs-card-icon">
          <FileText size={18} aria-hidden="true" />
        </span>
        <span className="docs-card-title">
          <strong>{document.sourceFileName || "Untitled upload"}</strong>
          <small>
            {[
              document.institution,
              document.accountMask ? `•••• ${document.accountMask}` : "",
              document.statementType.replace("_", " "),
              document.importedAt
                ? `uploaded ${document.importedAt.slice(0, 10)}`
                : ""
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
        <span className="docs-card-period">
          {document.periodStart || document.periodEnd
            ? `${document.periodStart || "?"} - ${document.periodEnd || "?"}`
            : "No period"}
        </span>
        <span className="docs-card-figure">
          <em>
            {document.expenseCount}{" "}
            {document.expenseCount === 1 ? "row" : "rows"}
          </em>
          <strong>{formatCurrency(document.grossTotal, currency)}</strong>
          {reimbursed ? (
            <span className="net-amount">
              net {formatCurrency(document.netTotal, currency)}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={`docs-card-chevron ${expanded ? "open" : ""}`}
          size={18}
          aria-hidden="true"
        />
      </button>

      <div className="docs-card-months">
        {document.months.map((month) => (
          <Link
            className="statement-chip"
            href={`/?month=${month}`}
            key={month}
            title="Open this month on the ledger"
          >
            {formatMonthLabel(month)}
          </Link>
        ))}
        {document.segments.length > 1 ? (
          <span className="docs-split-note">
            Split across {document.segments.length} months by row date
          </span>
        ) : null}
        {document.incomeTotal !== 0 ? (
          <span className="docs-split-note">
            {formatCurrency(document.incomeTotal, currency)} income
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div className="docs-card-body">
          {document.segments.length > 1 ? (
            <div className="docs-table" aria-label="Months covered">
              <p className="eyebrow">Per month</p>
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Period</th>
                      <th>Rows</th>
                      <th>Spend</th>
                      <th>Income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.segments.map((segment) => (
                      <tr key={segment.statementId}>
                        <td>
                          <Link
                            className="statement-chip"
                            href={`/?month=${segment.month}`}
                            title="Open this month on the ledger"
                          >
                            {formatMonthLabel(segment.month)}
                          </Link>
                        </td>
                        <td>
                          {segment.periodStart || "?"} -{" "}
                          {segment.periodEnd || "?"}
                        </td>
                        <td>{segment.expenseCount}</td>
                        <td>{formatCurrency(segment.grossTotal, currency)}</td>
                        <td>
                          {segment.incomeTotal === 0
                            ? "-"
                            : formatCurrency(segment.incomeTotal, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="docs-table" aria-label="Transactions">
            <p className="eyebrow">
              Transactions ({document.transactions.length})
            </p>
            {document.transactions.length === 0 ? (
              <div className="empty-state">
                This statement produced no expense rows.
              </div>
            ) : (
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
                    {document.transactions.map((transaction) => (
                      <tr key={`${transaction.month}-${transaction.id}`}>
                        <td>{transaction.date || "-"}</td>
                        <td>{formatMonthLabel(transaction.month)}</td>
                        <td className="docs-cell-text">
                          {transaction.merchant || "-"}
                        </td>
                        <td className="docs-cell-text">
                          {transaction.description}
                        </td>
                        <td>{transaction.category}</td>
                        <td>
                          {formatCurrency(transaction.amount, currency)}
                          {transaction.reimbursedAmount > 0 ? (
                            <span className="net-amount">
                              net{" "}
                              {formatCurrency(
                                transaction.amount -
                                  transaction.reimbursedAmount,
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
            )}
          </div>

          {document.incomes.length > 0 ? (
            <div className="docs-table" aria-label="Income">
              <p className="eyebrow">Income ({document.incomes.length})</p>
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Month</th>
                      <th>Source</th>
                      <th>Kind</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.incomes.map((income) => (
                      <tr key={`${income.month}-${income.id}`}>
                        <td>{income.date || "-"}</td>
                        <td>{formatMonthLabel(income.month)}</td>
                        <td className="docs-cell-text">
                          {income.source || "-"}
                        </td>
                        <td>{income.kind}</td>
                        <td>{formatCurrency(income.amount, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function DocumentStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
