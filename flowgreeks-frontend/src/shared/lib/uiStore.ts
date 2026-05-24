import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light";
export type DensityMode = "compact" | "comfortable";
export type LayoutMode = "grid" | "focus";

export interface ThresholdFilters {
  /** Hide GEX strikes whose |net_gex| falls below this value (USD/pt). */
  gexMin: number;
  /** Hide HIRO bucket signals weaker than this (delta-notional, abs). */
  hiroMin: number;
  /** Show only flow events whose premium >= this dollar amount. */
  flowPremiumMin: number;
}

interface UiState {
  theme: ThemeMode;
  density: DensityMode;
  layout: LayoutMode;
  symbol: string;
  filters: ThresholdFilters;

  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setDensity: (density: DensityMode) => void;
  toggleDensity: () => void;
  setLayout: (layout: LayoutMode) => void;
  setSymbol: (symbol: string) => void;
  setFilter: <K extends keyof ThresholdFilters>(
    key: K,
    value: ThresholdFilters[K],
  ) => void;
}

const defaultFilters: ThresholdFilters = {
  gexMin: 0,
  hiroMin: 0,
  flowPremiumMin: 0,
};

/**
 * UI store — pure client state. NEVER store auth tokens or PII here.
 * Auth lives in shared/auth (sessionStorage / httpOnly cookie).
 *
 * Persistence: localStorage is fine for UI prefs (theme, density,
 * filters). Tokens MUST NOT be persisted via Zustand.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      density: "compact",
      layout: "grid",
      symbol: "SPXW",
      filters: defaultFilters,

      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setDensity: (density) => set({ density }),
      toggleDensity: () =>
        set((s) => ({
          density: s.density === "compact" ? "comfortable" : "compact",
        })),
      setLayout: (layout) => set({ layout }),
      setSymbol: (symbol) => set({ symbol: symbol.toUpperCase() }),
      setFilter: (key, value) =>
        set((s) => ({ filters: { ...s.filters, [key]: value } })),
    }),
    {
      name: "flowgreeks.ui",
      version: 1,
      // Whitelist what is safe to persist. Anything missing here will
      // hydrate from defaults — the store grows but the persisted blob
      // does not silently capture new private fields.
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        layout: s.layout,
        symbol: s.symbol,
        filters: s.filters,
      }),
    },
  ),
);
