/**
 * Single source of truth for FOID theme state.
 *
 * - Persists to localStorage under `foid-theme`.
 * - Writes both `data-theme` (FOID CSS tokens in index.css) and `.dark`
 *   (Tailwind dark variant) to <html> so the two systems stay in sync.
 * - Backed by a zustand store, so multiple consumers stay in sync within
 *   a tab (a toggle in Layout updates ThemeToggle / pages instantly).
 * - Listens for `storage` events to sync across tabs.
 *
 * The matching synchronous bootstrap lives in `index.html` so the first
 * paint already has `data-theme` set and we avoid a flash of unstyled tokens.
 */

import { useEffect } from "react";
import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "foid-theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

function applyToDom(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = theme;
}

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: readStoredTheme(),
  setTheme(theme) {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, theme);
      }
    } catch {
      /* ignore quota errors */
    }
    applyToDom(theme);
    set({ theme });
  },
  toggle() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
}));

let storageListenerAttached = false;
function ensureStorageListener(): void {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    if (event.newValue !== "light" && event.newValue !== "dark") return;
    applyToDom(event.newValue);
    useThemeStore.setState({ theme: event.newValue });
  });
}

export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
} {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const toggle = useThemeStore((s) => s.toggle);

  useEffect(() => {
    // Re-assert on mount. Cheap idempotent operation, and guarantees the
    // class/attribute survive route changes that mutate <html> for any reason.
    applyToDom(theme);
    ensureStorageListener();
  }, [theme]);

  return { theme, toggle, setTheme };
}
