"use client";

import {
  AlertTriangle,
  Check,
  Database,
  FileText,
  LoaderCircle,
  NotebookPen,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Tags,
  Trash2,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  PAYMENT_METHODS,
  STATEMENT_SECTIONS,
  STATEMENT_TYPES,
  FALLBACK_CATEGORY_NAME,
  getDefaultCategoryName,
  getEnabledCategoryNames,
  type ExpenseCategory,
  type ExpenseCategoryDefinition,
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

type CategoryResponse = {
  categories: ExpenseCategoryDefinition[];
  enabledCategories?: ExpenseCategoryDefinition[];
  imported?: number;
  error?: string;
};

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const CATEGORIZATION_NOTES_STORAGE_KEY =
  "statement-ledger.categorization-notes";
const CATEGORIZATION_NOTES_STORAGE_EVENT =
  "statement-ledger-categorization-notes";
const APP_CATEGORY_VISIBILITY_STORAGE_KEY =
  "statement-ledger.include-app-categories";
const APP_CATEGORY_VISIBILITY_STORAGE_EVENT =
  "statement-ledger-include-app-categories";
const MAX_CATEGORIZATION_NOTES_LENGTH = 4000;

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
  const [categoryBusy, setCategoryBusy] = useState<
    "idle" | "loading" | "importing" | "updating"
  >("loading");
  const [categories, setCategories] = useState<ExpenseCategoryDefinition[]>(
    DEFAULT_EXPENSE_CATEGORY_DEFINITIONS
  );
  const [notice, setNotice] = useState<Notice>({
    tone: "neutral",
    message: "Sample rows are loaded."
  });
  const [lastSave, setLastSave] = useState<SaveExpensesResult | null>(null);
  const categorizationNotes = useSyncExternalStore(
    subscribeToCategorizationNotes,
    readCategorizationNotes,
    () => ""
  );
  const appCategoriesPreference = useSyncExternalStore(
    subscribeToAppCategoryVisibilityPreference,
    readAppCategoryVisibilityPreference,
    () => null
  );

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );
  const totalAmount = selectedItems.reduce((sum, item) => sum + item.amount, 0);
  const currency = extraction.statement.currency || "USD";
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const notionCategoryCount = categories.filter(
    (category) => category.source === "notion"
  ).length;
  const appCategoryCount = categories.filter(
    (category) => category.source === "app"
  ).length;
  const hasNotionCategories = notionCategoryCount > 0;
  const includeAppCategories =
    !hasNotionCategories || (appCategoriesPreference ?? false);
  const activeCategories = useMemo(
    () =>
      includeAppCategories
        ? categories
        : categories.filter((category) => category.source !== "app"),
    [categories, includeAppCategories]
  );
  const enabledCategoryNames = useMemo(
    () => getEnabledCategoryNames(activeCategories),
    [activeCategories]
  );
  const bulkCategoryOptions = useMemo(
    () => enabledCategoryOptions(activeCategories),
    [activeCategories]
  );
  const controlsDisabled = busy !== "idle" || categoryBusy !== "idle";

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      try {
        const response = await fetch("/api/categories");
        const result = (await response.json()) as CategoryResponse;

        if (!response.ok) {
          throw new Error(result.error || "Category loading failed.");
        }

        if (active) {
          setCategories(result.categories);
        }
      } catch {
        if (active) {
          setNotice({
            tone: "neutral",
            message: "Using built-in categories."
          });
        }
      } finally {
        if (active) {
          setCategoryBusy("idle");
        }
      }
    }

    loadCategories();

    return () => {
      active = false;
    };
  }, []);

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

      const notes = categorizationNotes.trim();
      if (notes) {
        formData.append("categorizationNotes", notes);
      }
      formData.append("includeAppCategories", String(includeAppCategories));

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

  async function importCategories() {
    setCategoryBusy("importing");
    setNotice({ tone: "neutral", message: "Importing categories..." });

    try {
      const response = await fetch("/api/categories/import", {
        method: "POST"
      });
      const result = (await response.json()) as CategoryResponse;

      if (!response.ok) {
        throw new Error(result.error || "Category import failed.");
      }

      setCategories(result.categories);
      setNotice({
        tone: "success",
        message: `Imported ${result.imported || 0} categories.`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Category import failed."
      });
    } finally {
      setCategoryBusy("idle");
    }
  }

  async function toggleCategory(name: string, enabled: boolean) {
    const previousCategories = categories;

    setCategoryBusy("updating");
    setCategories((current) =>
      current.map((category) =>
        category.name === name ? { ...category, enabled } : category
      )
    );

    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, enabled })
      });
      const result = (await response.json()) as CategoryResponse;

      if (!response.ok) {
        throw new Error(result.error || "Category update failed.");
      }

      setCategories(result.categories);
    } catch (error) {
      setCategories(previousCategories);
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Category update failed."
      });
    } finally {
      setCategoryBusy("idle");
    }
  }

  function toggleAppCategoryVisibility(enabled: boolean) {
    if (!writeAppCategoryVisibilityPreference(enabled)) {
      setNotice({
        tone: "error",
        message: "APP category preference could not be saved in this browser."
      });
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

  function recategorizeSelected(category: ExpenseCategory) {
    const selectedCount = selectedItems.length;

    if (selectedCount === 0) {
      setNotice({ tone: "error", message: "Select at least one row." });
      return;
    }

    setItems((current) =>
      current.map((item) =>
        selectedIds.has(item.id) ? { ...item, category } : item
      )
    );
    setNotice({
      tone: "success",
      message: `Updated ${selectedCount} ${
        selectedCount === 1 ? "row" : "rows"
      } to ${category}.`
    });
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
      category: getDefaultCategoryName(enabledCategoryNames),
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
            disabled={controlsDisabled}
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
            disabled={controlsDisabled}
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

        <section className="panel note-panel">
          <div className="panel-heading panel-heading-split">
            <div className="panel-heading-title">
              <NotebookPen size={18} aria-hidden="true" />
              <h2>AI Notes</h2>
            </div>
            <span className="panel-count">
              {categorizationNotes.trim() ? "Local" : "Empty"}
            </span>
          </div>

          <textarea
            className="note-textarea"
            value={categorizationNotes}
            maxLength={MAX_CATEGORIZATION_NOTES_LENGTH}
            onChange={(event) => {
              if (!writeCategorizationNotes(event.target.value)) {
                setNotice({
                  tone: "error",
                  message: "AI notes could not be saved in this browser."
                });
              }
            }}
            placeholder="Steam, Valve, and STEAMGAMES.COM should be Entertainment, not Charity."
          />
          <div className="note-meta">
            <span>Saved locally</span>
            <span>
              {categorizationNotes.length}/{MAX_CATEGORIZATION_NOTES_LENGTH}
            </span>
          </div>
        </section>

        <section className="panel category-panel">
          <div className="panel-heading panel-heading-split">
            <div className="panel-heading-title">
              <Tags size={18} aria-hidden="true" />
              <h2>Categories</h2>
            </div>
            <span className="panel-count">
              {enabledCategoryNames.length}/{activeCategories.length}
            </span>
          </div>

          <button
            className="secondary-button"
            type="button"
            title="Import categories"
            disabled={controlsDisabled}
            onClick={importCategories}
          >
            {categoryBusy === "importing" ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            )}
            Import
          </button>

          <label
            className={`category-source-toggle ${
              includeAppCategories ? "enabled" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={includeAppCategories}
              disabled={!hasNotionCategories || controlsDisabled}
              onChange={(event) =>
                toggleAppCategoryVisibility(event.target.checked)
              }
            />
            <span className="category-source-copy">
              <strong>APP categories</strong>
              <small>
                {hasNotionCategories
                  ? `${appCategoryCount} built-in / ${notionCategoryCount} Notion`
                  : `${appCategoryCount} built-in defaults`}
              </small>
            </span>
          </label>

          <div className="category-list">
            {activeCategories.map((category) => (
              <label
                className={`category-toggle ${category.enabled ? "enabled" : ""}`}
                key={`${category.source}-${category.sourceId || category.name}`}
              >
                <input
                  type="checkbox"
                  checked={category.enabled}
                  disabled={categoryBusy !== "idle" || busy !== "idle"}
                  onChange={(event) =>
                    toggleCategory(category.name, event.target.checked)
                  }
                />
                <span className="category-toggle-main">
                  <strong>{category.name}</strong>
                  <small>{category.source}</small>
                </span>
              </label>
            ))}
          </div>
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
          <label className="bulk-category-control">
            <Tags size={16} aria-hidden="true" />
            <select
              value=""
              aria-label="Category for selected rows"
              disabled={selectedItems.length === 0 || controlsDisabled}
              onChange={(event) => {
                const category = event.target.value as ExpenseCategory;

                if (category) {
                  recategorizeSelected(category);
                }
              }}
            >
              <option value="">Set category</option>
              {bulkCategoryOptions.map((category) => (
                <option
                  key={`${category.source}-${category.sourceId || category.name}`}
                  value={category.name}
                >
                  {category.name}
                </option>
              ))}
            </select>
          </label>
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
                      {categoryOptionsForItem(
                        item.category,
                        activeCategories
                      ).map((category) => (
                        <option key={category.name} value={category.name}>
                          {category.name}
                          {category.enabled ? "" : " (off)"}
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

function subscribeToCategorizationNotes(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === CATEGORIZATION_NOTES_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(CATEGORIZATION_NOTES_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(
      CATEGORIZATION_NOTES_STORAGE_EVENT,
      onStoreChange
    );
  };
}

function readCategorizationNotes() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(CATEGORIZATION_NOTES_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeCategorizationNotes(value: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(CATEGORIZATION_NOTES_STORAGE_KEY, value);
    window.dispatchEvent(new Event(CATEGORIZATION_NOTES_STORAGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function subscribeToAppCategoryVisibilityPreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_CATEGORY_VISIBILITY_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(
    APP_CATEGORY_VISIBILITY_STORAGE_EVENT,
    onStoreChange
  );

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(
      APP_CATEGORY_VISIBILITY_STORAGE_EVENT,
      onStoreChange
    );
  };
}

function readAppCategoryVisibilityPreference() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(
      APP_CATEGORY_VISIBILITY_STORAGE_KEY
    );

    if (stored === "true") {
      return true;
    }

    if (stored === "false") {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

function writeAppCategoryVisibilityPreference(value: boolean) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(
      APP_CATEGORY_VISIBILITY_STORAGE_KEY,
      String(value)
    );
    window.dispatchEvent(new Event(APP_CATEGORY_VISIBILITY_STORAGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function categoryOptionsForItem(
  value: string,
  categories: readonly ExpenseCategoryDefinition[]
) {
  const normalizedValue = value.trim().toLowerCase();
  const options = categories.filter(
    (category) =>
      category.enabled || category.name.toLowerCase() === normalizedValue
  );

  if (
    value &&
    !options.some((category) => category.name.toLowerCase() === normalizedValue)
  ) {
    return [
      ...options,
      {
        name: value,
        enabled: false,
        description: "",
        source: "app" as const
      }
    ];
  }

  if (options.length > 0) {
    return options;
  }

  return [
    {
      name: FALLBACK_CATEGORY_NAME,
      enabled: true,
      description: "",
      source: "app" as const
    }
  ];
}

function enabledCategoryOptions(
  categories: readonly ExpenseCategoryDefinition[]
) {
  const options = categories.filter((category) => category.enabled);

  if (options.length > 0) {
    return options;
  }

  return [
    {
      name: FALLBACK_CATEGORY_NAME,
      enabled: true,
      description: "",
      source: "app" as const
    }
  ];
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
