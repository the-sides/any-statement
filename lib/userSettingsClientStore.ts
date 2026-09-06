import {
  CASH_FLOW_PLAN_STORAGE_KEY,
  parseCashFlowEntries,
  parseCashFlowPlan,
  type CashFlowEntry
} from "@/lib/cashFlowPlan";
import {
  DEFAULT_CASH_FLOW_ENTRIES,
  normalizeCategorizationNotes,
  parseUserSettings,
  type UserSettings
} from "@/lib/userSettings";

const WRITE_DEBOUNCE_MS = 500;
const LEGACY_CATEGORIZATION_NOTES_STORAGE_KEY =
  "statement-ledger.categorization-notes";

export type UserSettingsState = {
  status: "loading" | "ready" | "error";
  cashFlowEntries: readonly CashFlowEntry[];
  categorizationNotes: string;
  error: string;
};

const INITIAL_STATE: UserSettingsState = {
  status: "loading",
  cashFlowEntries: DEFAULT_CASH_FLOW_ENTRIES,
  categorizationNotes: "",
  error: ""
};

const listeners = new Set<() => void>();

let state = INITIAL_STATE;
let initialized = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let writeChain: Promise<unknown> = Promise.resolve();

export function subscribeToUserSettings(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  ensureInitialized();

  return () => {
    listeners.delete(onStoreChange);
  };
}

export function readUserSettingsSnapshot() {
  return state;
}

export function readInitialUserSettingsSnapshot() {
  return INITIAL_STATE;
}

/**
 * Edits apply to local state immediately and are flushed on a debounce, so
 * typing in the notes box does not issue a request per keystroke. Refused
 * before the stored settings have loaded: writing then would push the
 * placeholder plan over whatever the server still holds.
 */
export function updateCashFlowEntries(entries: readonly CashFlowEntry[]) {
  return update({ cashFlowEntries: parseCashFlowEntries(entries) });
}

export function updateCategorizationNotes(notes: string) {
  return update({ categorizationNotes: normalizeCategorizationNotes(notes) });
}

export async function flushUserSettings() {
  if (!takePendingWrite()) {
    return;
  }

  const settings = currentSettings();

  try {
    await enqueueWrite(() => putUserSettings(settings));
  } catch (error) {
    setState({
      error: errorMessage(error, "Saving your settings failed.")
    });
  }
}

function update(patch: Partial<Omit<UserSettingsState, "status" | "error">>) {
  if (state.status !== "ready") {
    return false;
  }

  setState({ ...patch, error: "" });
  scheduleWrite();

  return true;
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") {
    return;
  }

  initialized = true;
  registerUnloadHandlers();
  void initialize();
}

async function initialize() {
  try {
    const stored = await fetchUserSettings();
    const adopted = stored.configured ? null : readLegacySettings();

    setState({
      status: "ready",
      cashFlowEntries: adopted?.cashFlowEntries ?? stored.cashFlowEntries,
      categorizationNotes:
        adopted?.categorizationNotes ?? stored.categorizationNotes,
      error: ""
    });

    if (adopted) {
      await enqueueWrite(() => putUserSettings(currentSettings()));
    }

    clearLegacySettings();
  } catch (error) {
    setState({
      status: "error",
      error: errorMessage(error, "Loading your settings failed.")
    });
  }
}

function currentSettings(): UserSettings {
  return {
    cashFlowEntries: [...state.cashFlowEntries],
    categorizationNotes: state.categorizationNotes,
    updatedAt: ""
  };
}

function scheduleWrite() {
  pending = true;

  clearTimeout(flushTimer);

  flushTimer = setTimeout(() => {
    void flushUserSettings();
  }, WRITE_DEBOUNCE_MS);
}

function takePendingWrite() {
  const hadPending = pending;

  clearTimeout(flushTimer);
  flushTimer = undefined;

  pending = false;

  return hadPending;
}

function enqueueWrite<T>(task: () => Promise<T>) {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);

  return next;
}

async function fetchUserSettings() {
  const response = await fetch("/api/settings");
  const result = (await response.json()) as {
    settings?: unknown;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "Loading your settings failed.");
  }

  const payload = result.settings;
  const configured =
    typeof payload === "object" &&
    payload !== null &&
    "configured" in payload &&
    payload.configured === true;

  return { ...parseUserSettings(payload), configured };
}

async function putUserSettings(settings: UserSettings) {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(settings)
  });
  const result = (await response.json()) as { error?: string };

  if (!response.ok) {
    throw new Error(result.error || "Saving your settings failed.");
  }
}

function registerUnloadHandlers() {
  const flushOnUnload = () => {
    if (!takePendingWrite()) {
      return;
    }

    const settings = currentSettings();
    const sent = window.navigator.sendBeacon?.(
      "/api/settings",
      new Blob([JSON.stringify(settings)], { type: "application/json" })
    );

    if (!sent) {
      void enqueueWrite(() => putUserSettings(settings));
    }
  };

  window.addEventListener("pagehide", flushOnUnload);
  window.addEventListener("beforeunload", flushOnUnload);
  window.document.addEventListener("visibilitychange", () => {
    if (window.document.visibilityState === "hidden") {
      flushOnUnload();
    }
  });
}

/**
 * Settings used to live in localStorage. A user who has never saved to the
 * database keeps whatever that browser holds; once it has been adopted (or the
 * server already has a row) the local copies go, so a stale browser cannot
 * resurrect them later.
 */
function readLegacySettings() {
  try {
    const rawPlan = window.localStorage.getItem(CASH_FLOW_PLAN_STORAGE_KEY);
    const plan = rawPlan ? parseCashFlowPlan(JSON.parse(rawPlan)) : null;
    const notes = normalizeCategorizationNotes(
      window.localStorage.getItem(LEGACY_CATEGORIZATION_NOTES_STORAGE_KEY)
    );

    if (!plan && !notes) {
      return null;
    }

    return {
      cashFlowEntries: plan?.entries,
      categorizationNotes: notes || undefined
    };
  } catch {
    return null;
  }
}

function clearLegacySettings() {
  try {
    window.localStorage.removeItem(CASH_FLOW_PLAN_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_CATEGORIZATION_NOTES_STORAGE_KEY);
  } catch {
    // A browser that refuses storage has nothing to migrate away from.
  }
}

function setState(patch: Partial<UserSettingsState>) {
  state = { ...state, ...patch };

  for (const listener of listeners) {
    listener();
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
