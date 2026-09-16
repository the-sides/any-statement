"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  systemPrefersDark,
  watchSystemTheme
} from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: LucideIcon;
}[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon }
];

// The preference lives in localStorage, so it is external state that the
// component subscribes to rather than React state seeded from an effect.
let cachedPreference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function getPreferenceSnapshot(): ThemePreference {
  if (cachedPreference === null) {
    cachedPreference = readStoredThemePreference();
  }

  return cachedPreference;
}

function getServerPreferenceSnapshot(): ThemePreference {
  return "system";
}

function subscribeToPreference(listener: () => void) {
  listeners.add(listener);

  // Keep other tabs of the ledger in step with the one that changed the theme.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) {
      return;
    }

    cachedPreference = readStoredThemePreference();
    applyResolvedTheme(resolveTheme(cachedPreference, systemPrefersDark()));
    notify();
  };

  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function choosePreference(next: ThemePreference) {
  cachedPreference = next;
  storeThemePreference(next);
  applyResolvedTheme(resolveTheme(next, systemPrefersDark()));
  notify();
}

/**
 * One button, not a three-way segmented control: the theme is a background
 * preference, and three always-visible buttons cost the header the width of
 * the whole month stepper. It shows the current preference and cycles
 * system -> light -> dark, which reaches every state in at most two taps.
 */
export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribeToPreference,
    getPreferenceSnapshot,
    getServerPreferenceSnapshot
  );

  useEffect(() => {
    if (preference !== "system") {
      return;
    }

    return watchSystemTheme((prefersDark) => {
      applyResolvedTheme(prefersDark ? "dark" : "light");
    });
  }, [preference]);

  const index = THEME_OPTIONS.findIndex(
    (option) => option.value === preference
  );
  const current = THEME_OPTIONS[index === -1 ? 0 : index];
  const next = THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length];
  const { Icon } = current;

  return (
    <button
      className="icon-button theme-button"
      type="button"
      title={`${current.label} theme - switch to ${next.label.toLowerCase()}`}
      aria-label={`Color theme: ${current.label}. Switch to ${next.label.toLowerCase()}.`}
      onClick={() => choosePreference(next.value)}
    >
      <Icon size={16} aria-hidden="true" suppressHydrationWarning />
    </button>
  );
}
