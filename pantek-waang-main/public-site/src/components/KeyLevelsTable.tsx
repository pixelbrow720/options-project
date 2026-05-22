import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { decimalsFor, formatPoints, formatPrice } from "@/lib/format";
import type { FuturesKeyLevel, FuturesKeyLevelKind } from "@/lib/api";

const KIND_META: Record<
  FuturesKeyLevelKind,
  { label: string; dot: string; tone: string }
> = {
  flip: {
    label: "0DTE Flip",
    dot: "bg-[hsl(var(--violet))]",
    tone: "text-[hsl(var(--violet))]",
  },
  wall_call: {
    label: "Call Wall",
    dot: "bg-[hsl(var(--emerald))]",
    tone: "text-[hsl(var(--emerald))]",
  },
  wall_put: {
    label: "Put Wall",
    dot: "bg-[hsl(var(--rose))]",
    tone: "text-[hsl(var(--rose))]",
  },
  max_pain: {
    label: "Max Pain",
    dot: "bg-[hsl(var(--amber))]",
    tone: "text-[hsl(var(--amber))]",
  },
  gex_pos: {
    label: "GEX +",
    dot: "bg-[hsl(var(--emerald))]",
    tone: "text-[hsl(var(--emerald))]",
  },
  gex_neg: {
    label: "GEX -",
    dot: "bg-[hsl(var(--rose))]",
    tone: "text-[hsl(var(--rose))]",
  },
};

type TabFilter = "all" | "walls" | "gex" | "flip";
type ViewMode = "cash" | "futures";

interface KeyLevelsTableProps {
  symbol: string;
  levels: FuturesKeyLevel[];
  futuresPrice: number | null;
  cashSpot: number | null;
  highlightStrike: number | null;
  onHighlight: (strike: number | null) => void;
  className?: string;
  /** When true, render skeleton rows instead of empty state. */
  loading?: boolean;
}

const VIEW_KEY = "pw_levels_view_mode";

function readView(): ViewMode {
  if (typeof window === "undefined") return "cash";
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "futures" ? "futures" : "cash";
  } catch {
    return "cash";
  }
}

function tabMatches(kind: FuturesKeyLevelKind, tab: TabFilter): boolean {
  if (tab === "all") return true;
  if (tab === "walls") return kind === "wall_call" || kind === "wall_put";
  if (tab === "gex") return kind === "gex_pos" || kind === "gex_neg";
  if (tab === "flip") return kind === "flip";
  return true;
}

function maxAbsWeight(levels: FuturesKeyLevel[]): number {
  let max = 0;
  for (const lvl of levels) {
    if (lvl.weight_value !== null && Math.abs(lvl.weight_value) > max) {
      max = Math.abs(lvl.weight_value);
    }
  }
  return max || 1;
}

const SKELETON_ROW_KEYS = Array.from({ length: 8 }, (_, i) => `skeleton-${i}`);

export function KeyLevelsTable({
  symbol,
  levels,
  futuresPrice,
  cashSpot,
  highlightStrike,
  onHighlight,
  className,
  loading = false,
}: KeyLevelsTableProps) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<TabFilter>("all");
  const [view, setView] = useState<ViewMode>(() => readView());

  const dec = decimalsFor(symbol);

  const filtered = useMemo(
    () =>
      levels
        .filter((lvl) => tabMatches(lvl.kind, tab))
        .slice()
        .sort((a, b) => b.futures_level - a.futures_level),
    [levels, tab],
  );

  const weightMax = useMemo(() => maxAbsWeight(filtered), [filtered]);

  function setMode(next: ViewMode) {
    setView(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(VIEW_KEY, next);
      } catch {
        // Best-effort: ignore storage failures (private mode, quota, etc.).
      }
    }
  }

  return (
    <div className={cn("liquid-glass overflow-hidden rounded-2xl p-5 sm:p-6", className)}>
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Key levels
          </div>
          <p
            className="mt-1 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Spot source:{" "}
            <span style={{ color: "var(--text-primary)" }}>
              {view === "cash" ? "Cash" : "Futures"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="walls">Walls</TabsTrigger>
              <TabsTrigger value="gex">GEX</TabsTrigger>
              <TabsTrigger value="flip">Flip</TabsTrigger>
            </TabsList>
          </Tabs>
          <div
            className="liquid-glass inline-flex rounded-full p-0.5"
            role="group"
            aria-label="Spot reference"
          >
            <Button
              variant={view === "cash" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setMode("cash")}
              aria-pressed={view === "cash"}
            >
              Cash
            </Button>
            <Button
              variant={view === "futures" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setMode("futures")}
              aria-pressed={view === "futures"}
            >
              Futures
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-4 -mx-5 sm:-mx-6">
        <div className="scrollbar-thin max-h-[440px] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead
              className="sticky top-0 z-10 text-[9px] font-mono uppercase tracking-[0.18em]"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
                backgroundColor: "var(--bg-surface)",
                backdropFilter: "blur(8px)",
              }}
            >
              <tr>
                <th
                  className="px-4 py-2 text-left font-medium"
                  style={{ borderBottom: "1px solid var(--border-foid)" }}
                >
                  Level
                </th>
                <th
                  className="px-4 py-2 text-left font-medium"
                  style={{ borderBottom: "1px solid var(--border-foid)" }}
                >
                  Label
                </th>
                <th
                  className="px-4 py-2 text-right font-medium"
                  style={{ borderBottom: "1px solid var(--border-foid)" }}
                >
                  Cash
                </th>
                <th
                  className="hidden px-4 py-2 text-right font-medium sm:table-cell"
                  style={{ borderBottom: "1px solid var(--border-foid)" }}
                >
                  Futures
                </th>
                <th
                  className="px-4 py-2 text-right font-medium"
                  style={{ borderBottom: "1px solid var(--border-foid)" }}
                >
                  Distance
                </th>
                <th
                  className="hidden px-4 py-2 text-left font-medium md:table-cell"
                  style={{ borderBottom: "1px solid var(--border-foid)" }}
                >
                  Strength
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                SKELETON_ROW_KEYS.map((k) => (
                  <tr
                    key={k}
                    style={{ borderTop: "1px solid var(--border-foid)" }}
                  >
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-20 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-3 w-24 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="ml-auto h-4 w-16 rounded" />
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <Skeleton className="ml-auto h-4 w-16 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="ml-auto h-4 w-12 rounded" />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <Skeleton className="h-2 w-24 rounded-full" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-2">
                    <EmptyState
                      icon={<BarChart3 />}
                      headline="Awaiting market session"
                      subline="Real-time GEX walls and key levels populate as the chain ticks. Last close snapshot pending."
                      pad="md"
                      inline
                    />
                  </td>
                </tr>
              ) : (
                <AnimatePresence initial={false}>
                  {filtered.map((lvl) => {
                    const meta = KIND_META[lvl.kind];
                    const ref = view === "cash" ? cashSpot : futuresPrice;
                    const target = view === "cash" ? lvl.cash_strike : lvl.futures_level;
                    const distance =
                      ref !== null && ref !== undefined ? target - ref : lvl.distance_pts;
                    const weight = lvl.weight_value ?? 0;
                    const weightPct = weightMax > 0 ? Math.abs(weight) / weightMax : 0;
                    const isHighlighted = highlightStrike === lvl.cash_strike;
                    return (
                      <motion.tr
                        layout={!reduce}
                        key={`${lvl.kind}-${lvl.cash_strike}-${lvl.label}`}
                        initial={reduce ? false : { opacity: 0, y: -2 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? undefined : { opacity: 0, y: 2 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className={cn(
                          "transition-colors",
                          isHighlighted && "bg-white/[0.03]",
                        )}
                        style={{ borderTop: "1px solid var(--border-foid)" }}
                        onMouseEnter={() => onHighlight(lvl.cash_strike)}
                        onMouseLeave={() => onHighlight(null)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="inline-flex items-center gap-2">
                            <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                            <span
                              className={cn("text-xs font-mono", meta.tone)}
                              style={{ fontFamily: "var(--font-mono-foid)" }}
                            >
                              {meta.label}
                            </span>
                          </div>
                        </td>
                        <td
                          className="px-4 py-2.5 text-xs font-mono"
                          style={{
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono-foid)",
                          }}
                        >
                          {lvl.label}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right font-mono tabular-nums"
                          style={{
                            color: "var(--text-primary)",
                            fontFamily: "var(--font-mono-foid)",
                          }}
                        >
                          {formatPrice(lvl.cash_strike, dec)}
                        </td>
                        <td
                          className="hidden px-4 py-2.5 text-right font-mono tabular-nums sm:table-cell"
                          style={{
                            color: "var(--text-secondary)",
                            fontFamily: "var(--font-mono-foid)",
                          }}
                        >
                          {formatPrice(lvl.futures_level, 2)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right font-mono tabular-nums"
                          style={{
                            color:
                              distance === null
                                ? "var(--text-muted)"
                                : distance >= 0
                                  ? "var(--accent-foid)"
                                  : "var(--accent-put)",
                            fontFamily: "var(--font-mono-foid)",
                          }}
                        >
                          {distance !== null ? formatPoints(distance, 2) : "—"}
                        </td>
                        <td className="hidden px-4 py-2.5 md:table-cell">
                          <div
                            className="flex h-2 w-full max-w-[120px] overflow-hidden rounded-full"
                            style={{ backgroundColor: "var(--border-foid)" }}
                          >
                            <motion.div
                              initial={reduce ? false : { width: 0 }}
                              animate={{ width: `${Math.max(4, weightPct * 100)}%` }}
                              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                              className={cn(
                                "h-full rounded-full",
                                weight >= 0
                                  ? "bg-[hsl(var(--emerald))]"
                                  : "bg-[hsl(var(--rose))]",
                              )}
                            />
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
