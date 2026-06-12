"use client";

import {
  AlertTriangle,
  Check,
  Database,
  FileText,
  LoaderCircle,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES,
  type ExpenseCategory,
  type PaymentMethod,
  type StatementSection,
  type StatementType
} from "@/lib/categories";
import { sampleExtraction } from "@/lib/sample";
import type {
  ExpenseItem,
  SaveExpensesResult,
  StatementExtraction,
  StatementSummary
} from "@/lib/types";

type Notice = {
  tone: "neutral" | "success" | "error";
  message: string;
};

type ExtractionResponse = {
  extraction: StatementExtraction;
  artifact?: {
    dir: string;
    pdfPath: string;
  };
};

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

export function StatementWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] =
    useState<StatementExtraction>(sampleExtraction);
  const [items, setItems] = useState<ExpenseItem[]>(
    sampleExtraction.expenses
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(sampleExtraction.expenses.map((item) => item.id))
  );
  const [dataSourceId, setDataSourceId] = useState("");
  const [busy, setBusy] = useState<"idle" | "extracting" | "saving">("idle");
  const [notice, setNotice] = useState<Notice>({
    tone: "neutral",
    message: "Sample rows are loaded."
  });
  const [lastSave, setLastSave] = useState<SaveExpensesResult | null>(null);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );
  const totalAmount = selectedItems.reduce((sum, item) => sum + item.amount, 0);
  const currency = extraction.statement.currency || "USD";
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  async function extractStatement() {
    if (!file) {
      setNotice({ tone: "error", message: "Choose a PDF statement first." });
      return;
    }

    setBusy("extracting");
    setLastSave(null);
    setNotice({ tone: "neutral", message: "Extracting statement rows..." });

    try {
      const formData = new FormData();
      formData.append("statementPdf", file);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData
      });
      const result = (await response.json()) as
        | ExtractionResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          ("error" in result && result.error) || "Extraction failed."
        );
      }

      const extractionResult = result as ExtractionResponse;
      const rowCount = extractionResult.extraction.expenses.length;
      const artifactMessage = extractionResult.artifact?.dir
        ? ` Artifacts: ${extractionResult.artifact.dir}`
        : "";

      loadExtraction(extractionResult.extraction);
      setNotice({
        tone: rowCount > 0 ? "success" : "error",
        message:
          rowCount > 0
            ? `Extracted ${rowCount} expenses.${artifactMessage}`
            : `Metadata extracted, but OpenRouter returned no expense rows.${artifactMessage}`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Extraction failed."
      });
    } finally {
      setBusy("idle");
    }
  }

  async function saveToNotion() {
    if (!selectedItems.length) {
      setNotice({ tone: "error", message: "Select at least one row." });
      return;
    }

    setBusy("saving");
    setLastSave(null);
    setNotice({ tone: "neutral", message: "Saving selected rows..." });

    try {
      const response = await fetch("/api/notion/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dataSourceId: dataSourceId.trim() || undefined,
          sourceFileName: file?.name || "sample-statement.pdf",
          statement: extraction.statement,
          expenses: selectedItems
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Save failed.");
      }

      setLastSave(result);
      setNotice({
        tone: "success",
        message: `Saved ${result.saved} rows to Notion.`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Save failed."
      });
    } finally {
      setBusy("idle");
    }
  }

  function loadExtraction(nextExtraction: StatementExtraction) {
    setExtraction(nextExtraction);
    setItems(nextExtraction.expenses);
    setSelectedIds(new Set(nextExtraction.expenses.map((item) => item.id)));
  }

  function updateStatement<K extends keyof StatementSummary>(
    key: K,
    value: StatementSummary[K]
  ) {
    setExtraction((current) => ({
      ...current,
      statement: {
        ...current.statement,
        [key]: value
      }
    }));
  }

  function updateItem(id: string, patch: Partial<ExpenseItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function toggleItem(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  function addRow() {
    const id = crypto.randomUUID();
    const row: ExpenseItem = {
      id,
      date: new Date().toISOString().slice(0, 10),
      postedDate: "",
      description: "",
      merchant: "",
      amount: 0,
      currency,
      category: "Other",
      subcategory: "",
      paymentMethod: "unknown",
      statementSection: "purchase",
      confidence: 0.7,
      notes: ""
    };

    setItems((current) => [row, ...current]);
    setSelectedIds((current) => new Set([id, ...current]));
  }

  function removeRow(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  return (
    <main className="app-shell">
      <aside className="side-panel" aria-label="Statement controls">
        <div className="brand-lockup">
          <div className="brand-mark">SL</div>
          <div>
            <p className="eyebrow">Statement Ledger</p>
            <h1>Expense intake</h1>
          </div>
        </div>

        <section className="panel upload-panel">
          <div className="panel-heading">
            <FileText size={18} aria-hidden="true" />
            <h2>Statement</h2>
          </div>

          <label className="file-drop" htmlFor="statement-upload">
            <Upload size={22} aria-hidden="true" />
            <span>{file ? file.name : "Choose PDF"}</span>
            <small>{file ? formatBytes(file.size) : "Credit card or bank"}</small>
          </label>
          <input
            id="statement-upload"
            className="visually-hidden"
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />

          <button
            className="primary-button"
            type="button"
            title="Extract expenses"
            disabled={busy !== "idle"}
            onClick={extractStatement}
          >
            {busy === "extracting" ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <Sparkles size={18} aria-hidden="true" />
            )}
            Extract
          </button>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <Database size={18} aria-hidden="true" />
            <h2>Notion</h2>
          </div>
          <label className="field">
            <span>Data source ID</span>
            <input
              value={dataSourceId}
              onChange={(event) => setDataSourceId(event.target.value)}
              placeholder="Uses env when blank"
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            title="Save selected expenses"
            disabled={busy !== "idle"}
            onClick={saveToNotion}
          >
            {busy === "saving" ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <Save size={18} aria-hidden="true" />
            )}
            Save
          </button>
        </section>

        <section className="panel statement-card">
          <h2>Review</h2>
          <label className="field">
            <span>Institution</span>
            <input
              value={extraction.statement.institution}
              onChange={(event) =>
                updateStatement("institution", event.target.value)
              }
            />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Type</span>
              <select
                value={extraction.statement.statementType}
                onChange={(event) =>
                  updateStatement(
                    "statementType",
                    event.target.value as StatementType
                  )
                }
              >
                {STATEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Account</span>
              <input
                value={extraction.statement.accountMask}
                onChange={(event) =>
                  updateStatement("accountMask", event.target.value)
                }
              />
            </label>
          </div>
          <div className="field-grid">
            <label className="field">
              <span>Start</span>
              <input
                type="date"
                value={extraction.statement.periodStart}
                onChange={(event) =>
                  updateStatement("periodStart", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>End</span>
              <input
                type="date"
                value={extraction.statement.periodEnd}
                onChange={(event) =>
                  updateStatement("periodEnd", event.target.value)
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Currency</span>
            <input
              value={extraction.statement.currency}
              onChange={(event) =>
                updateStatement("currency", event.target.value.toUpperCase())
              }
            />
          </label>
        </section>
      </aside>

      <section className="workspace" aria-label="Expense review table">
        <div className="workspace-top">
          <div>
            <p className="eyebrow">Review queue</p>
            <h2>{extraction.statement.institution}</h2>
          </div>

          <div className="stats-strip">
            <Stat label="Rows" value={String(items.length)} />
            <Stat label="Selected" value={String(selectedItems.length)} />
            <Stat label="Amount" value={formatCurrency(totalAmount, currency)} />
          </div>
        </div>

        <div className={`notice ${notice.tone}`} role="status">
          {notice.tone === "error" ? (
            <AlertTriangle size={16} aria-hidden="true" />
          ) : notice.tone === "success" ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <FileText size={16} aria-hidden="true" />
          )}
          <span>{notice.message}</span>
          {lastSave?.pages[0]?.url ? (
            <a href={lastSave.pages[0].url} target="_blank" rel="noreferrer">
              Open first page
            </a>
          ) : null}
        </div>

        <div className="table-actions">
          <button
            className="icon-button"
            type="button"
            title={allSelected ? "Clear selection" : "Select all"}
            onClick={toggleAll}
          >
            <Check size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Add expense"
            onClick={addRow}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <span>{currencyNames.of(currency) || currency}</span>
        </div>

        <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th aria-label="Selected" />
                <th>Date</th>
                <th>Merchant</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Method</th>
                <th>Section</th>
                <th>Confidence</th>
                <th>Notes</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <div className="empty-state">
                      No expense rows returned. Re-upload the PDF and inspect the
                      saved artifact directory shown above.
                    </div>
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      aria-label={`Select ${item.merchant || item.description}`}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={item.date}
                      onChange={(event) =>
                        updateItem(item.id, { date: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={item.merchant}
                      onChange={(event) =>
                        updateItem(item.id, { merchant: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={item.description}
                      onChange={(event) =>
                        updateItem(item.id, { description: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="amount-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(event) =>
                        updateItem(item.id, {
                          amount: Number(event.target.value)
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={item.category}
                      onChange={(event) =>
                        updateItem(item.id, {
                          category: event.target.value as ExpenseCategory
                        })
                      }
                    >
                      {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={item.paymentMethod}
                      onChange={(event) =>
                        updateItem(item.id, {
                          paymentMethod: event.target.value as PaymentMethod
                        })
                      }
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={item.statementSection}
                      onChange={(event) =>
                        updateItem(item.id, {
                          statementSection: event.target
                            .value as StatementSection
                        })
                      }
                    >
                      {STATEMENT_SECTIONS.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="confidence">
                      <span>{Math.round(item.confidence * 100)}%</span>
                      <meter min="0" max="1" value={item.confidence} />
                    </div>
                  </td>
                  <td>
                    <input
                      value={item.notes}
                      onChange={(event) =>
                        updateItem(item.id, { notes: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="icon-button danger"
                      type="button"
                      title="Remove row"
                      onClick={() => removeRow(item.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
