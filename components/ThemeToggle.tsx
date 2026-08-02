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

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={preference === value ? "active" : undefined}
          aria-pressed={preference === value}
          title={`${label} theme`}
          onClick={() => choosePreference(value)}
        >
          <Icon size={15} aria-hidden="true" suppressHydrationWarning />
          <span className="visually-hidden">{label} theme</span>
        </button>
      ))}
    </div>
  );
}
