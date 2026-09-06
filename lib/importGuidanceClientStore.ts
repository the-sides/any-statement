import { MAX_IMPORT_GUIDANCE_LENGTH } from "@/lib/importGuidance";

/**
 * Import Guidance lives in Postgres, one row per user, so it follows the user
 * between the desktop and the phone instead of being stranded in one browser's
 * localStorage. Typing stays local and optimistic; the row is written on a
 * debounce and flushed before the page goes away, matching how month documents
 * are saved.
 */
const WRITE_DEBOUNCE_MS = 600;
const LEGACY_STORAGE_KEY = "statement-ledger.categorization-notes";
const ENDPOINT = "/api/import-guidance";

export type ImportGuidanceState = {
  status: "loading" | "ready";
  guidance: string;
  /** True while a write is scheduled or in flight, so the panel can say so. */
  pending: boolean;
  error: string;
};

const INITIAL_STATE: ImportGuidanceState = {
  status: "loading",
  guidance: "",
  pending: false,
  error: ""
};

const listeners = new Set<() => void>();

let state = INITIAL_STATE;
let initialized = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingGuidance: string | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

export function subscribeToImportGuidance(onStoreChange: () => void) {
  ensureInitialized();
  listeners.add(onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
  };
}

export function readImportGuidanceSnapshot() {
  return state;
}

export function readInitialImportGuidanceSnapshot() {
  return INITIAL_STATE;
}

/** State updates immediately; the row is written on a debounce. */
export function setImportGuidance(value: string) {
  const guidance = value.slice(0, MAX_IMPORT_GUIDANCE_LENGTH);

  setState({ guidance, pending: true, error: "" });
  pendingGuidance = guidance;

  clearTimeout(flushTimer ?? undefined);

  flushTimer = setTimeout(() => {
    void flushImportGuidance();
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Awaited before an upload: extraction reads the stored row, so a debounce
 * still in flight would extract against the previous guidance.
 */
export async function flushImportGuidance() {
  const pending = takePendingWrite();

  if (pending === null) {
    await writeChain;

    return;
  }

  await enqueueWrite(() => putImportGuidance(pending));
}

function ensureInitialized() {
  if (initialized) {
    return;
  }

  initialized = true;
  registerUnloadHandlers();
  void initialize();
}

async function initialize() {
  try {
    const response = await fetch(ENDPOINT);
    const result = (await response.json()) as {
      guidance?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(result.error || "Loading import guidance failed.");
    }

    // A reviewer who started typing before the fetch returned owns the text;
    // the stored copy is older than what is on screen.
    if (pendingGuidance !== null) {
      setState({ status: "ready" });

      return;
    }

    const stored = result.guidance || "";
    const guidance = stored || takeLegacyGuidance();

    setState({ status: "ready", guidance });

    if (guidance !== stored) {
      await enqueueWrite(() => putImportGuidance(guidance));
    }
  } catch (error) {
    setState({
      status: "ready",
      error: errorMessage(error, "Loading import guidance failed.")
    });
  }
}

/**
 * Guidance used to live in this browser's localStorage. Adopting it on the
 * first server-backed load is what keeps a reviewer's accumulated correction
 * rules from disappearing the day they upgrade; the key is dropped once the
 * row exists so a second browser cannot resurrect an older copy over it.
 */
function takeLegacyGuidance() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const legacy =
      window.localStorage.getItem(LEGACY_STORAGE_KEY)?.slice(
        0,
        MAX_IMPORT_GUIDANCE_LENGTH
      ) || "";

    window.localStorage.removeItem(LEGACY_STORAGE_KEY);

    return legacy;
  } catch {
    return "";
  }
}

function takePendingWrite() {
  const pending = pendingGuidance;

  clearTimeout(flushTimer ?? undefined);
  flushTimer = null;

  pendingGuidance = null;

  return pending;
}

function enqueueWrite<T>(task: () => Promise<T>) {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);

  return next;
}

async function putImportGuidance(guidance: string) {
  try {
    const response = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guidance })
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      throw new Error(result.error || "Saving import guidance failed.");
    }

    setState({ pending: pendingGuidance !== null, error: "" });
  } catch (error) {
    setState({
      pending: pendingGuidance !== null,
      error: errorMessage(error, "Saving import guidance failed.")
    });

    throw error;
  }
}

function registerUnloadHandlers() {
  if (typeof window === "undefined") {
    return;
  }

  const flushOnUnload = () => {
    const pending = takePendingWrite();

    if (pending === null) {
      return;
    }

    const sent = window.navigator.sendBeacon?.(
      ENDPOINT,
      new Blob([JSON.stringify({ guidance: pending })], {
        type: "application/json"
      })
    );

    if (!sent) {
      void enqueueWrite(() => putImportGuidance(pending));
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

function setState(patch: Partial<ImportGuidanceState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
