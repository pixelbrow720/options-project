import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Layers, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  decimalsFor,
  formatDollarsCompact,
  formatPrice,
} from "@/lib/format";

export interface ChainStrike {
  strike: number;
  abs_gamma: number;
  net_gamma: number;
}

export interface FullChainHeatmapProps {
  symbol: string;
  spot: number | null;
  strikes: ChainStrike[] | null;
  loading?: boolean;
  className?: string;
  onHighlight?: (strike: number | null) => void;
  highlightStrike?: number | null;
}

interface RowMeta {
  strike: number;
  abs_gamma: number;
  net_gamma: number;
  intensity: number;
  isSpotRow: boolean;
}

const SKELETON_KEYS = Array.from({ length: 18 }, (_, i) => `chain-sk-${i}`);

function findSpotRowStrike(
  strikes: ChainStrike[],
  spot: number | null,
): number | null {
  if (!spot || strikes.length === 0) return null;
  let best = strikes[0].strike;
  let bestDiff = Math.abs(strikes[0].strike - spot);
  for (let i = 1; i < strikes.length; i += 1) {
    const diff = Math.abs(strikes[i].strike - spot);
    if (diff < bestDiff) {
      best = strikes[i].strike;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Map a 0..1 intensity into the violet -> cyan -> muted gradient.
 */
function intensityBg(intensity: number): string {
  // Clamp.
  const t = Math.max(0, Math.min(1, intensity));
  if (t > 0.66) return "bg-[hsl(var(--violet))]/80";
  if (t > 0.33) return "bg-[hsl(var(--accent))]/70";
  if (t > 0.12) return "bg-[hsl(var(--accent))]/40";
  return "bg-white/10";
}

function FullChainHeatmapImpl({
  symbol,
  spot,
  strikes,
  loading = false,
  className,
  onHighlight,
  highlightStrike,
}: FullChainHeatmapProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);
  const [query, setQuery] = useState("");
  const [activeStrike, setActiveStrike] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const allRows = useMemo<RowMeta[]>(() => {
    if (!strikes || strikes.length === 0) return [];
    const maxAbs = strikes.reduce(
      (acc, r) => (r.abs_gamma > acc ? r.abs_gamma : acc),
      0,
    );
    const denom = maxAbs > 0 ? maxAbs : 1;
    const spotStrike = findSpotRowStrike(strikes, spot);
    const sorted = strikes
      .slice()
      .sort((a, b) => b.strike - a.strike);
    return sorted.map((s) => ({
      strike: s.strike,
      abs_gamma: s.abs_gamma,
      net_gamma: s.net_gamma,
      intensity: s.abs_gamma / denom,
      isSpotRow: spotStrike !== null && s.strike === spotStrike,
    }));
  }, [strikes, spot]);

  const filteredRows = useMemo<RowMeta[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return allRows;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return allRows;
    // Filter to within 5% of typed strike, else if user typed 4+ chars, narrow more.
    const window = Math.max(1, Math.abs(num) * 0.04);
    return allRows.filter((r) => Math.abs(r.strike - num) <= window);
  }, [allRows, query]);

  // Scroll to the spot row (or matched query) on mount and when data changes.
  useEffect(() => {
    if (!scrollRef.current) return;
    const target =
      highlightStrike ??
      activeStrike ??
      (allRows.find((r) => r.isSpotRow)?.strike ?? null);
    if (target === null) return;
    const el = scrollRef.current.querySelector<HTMLDivElement>(
      `[data-strike="${target}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
  }, [allRows, highlightStrike, activeStrike, reduce]);

  function handleQuery(value: string) {
    setQuery(value);
    const trimmed = value.trim();
    if (!trimmed) {
      // Clearing the query clears any search-driven highlight.
      if (activeStrike !== null) {
        setActiveStrike(null);
        onHighlight?.(null);
      }
      return;
    }
    const num = Number(trimmed);
    if (Number.isFinite(num) && allRows.length > 0) {
      // Snap to the nearest available strike.
      let nearest = allRows[0].strike;
      let nearestDiff = Math.abs(nearest - num);
      for (const r of allRows) {
        const d = Math.abs(r.strike - num);
        if (d < nearestDiff) {
          nearest = r.strike;
          nearestDiff = d;
        }
      }
      setActiveStrike(nearest);
      onHighlight?.(nearest);
    }
  }

  function handleRowClick(strike: number) {
    const next = activeStrike === strike ? null : strike;
    setActiveStrike(next);
    onHighlight?.(next);
  }

  const showEmpty = !loading && allRows.length === 0;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn("liquid-glass rounded-2xl p-5", className)}
    >
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Strike Heatmap · 0DTE
            </div>
            <p
              className="mt-1.5 text-xs font-mono"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              All strikes · color = absolute gamma · sign indicator
            </p>
          </div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.18em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {allRows.length > 0 ? `${allRows.length} strikes` : symbol}
          </div>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="number"
            inputMode="decimal"
            placeholder="Go to strike…"
            value={query}
            onChange={(e) => handleQuery(e.target.value)}
            className="liquid-glass w-full rounded-full px-4 py-2 pl-9 font-mono text-xs tabular-nums focus:outline-none"
            style={{
              fontFamily: "var(--font-mono-foid)",
              color: "var(--text-primary)",
              backgroundColor: "transparent",
            }}
          />
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="space-y-1">
            {SKELETON_KEYS.map((k) => (
              <Skeleton key={k} className="h-6 w-full rounded-sm" />
            ))}
          </div>
        ) : showEmpty ? (
          <EmptyState
            icon={<Layers />}
            headline="Strike heatmap awaits"
            subline="Per-strike gamma populates as the chain ticks."
            pad="md"
          />
        ) : (
          <div
            ref={scrollRef}
            className="scrollbar-thin max-h-[520px] overflow-y-auto"
          >
            <div
              className="sticky top-0 z-10 grid grid-cols-[64px_1fr_28px_88px] items-center gap-2 px-2 py-1.5 text-[9px] font-mono uppercase tracking-[0.18em]"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
                background: "rgba(0,0,0,0.4)",
                backdropFilter: "blur(8px)",
                borderBottom: "1px solid var(--border-foid)",
              }}
            >
              <span>Strike</span>
              <span>Gamma intensity</span>
              <span className="text-center">±</span>
              <span className="text-right">$ Gamma</span>
            </div>
            <div className="space-y-[2px] pt-1">
              {filteredRows.length === 0 ? (
                <div
                  className="px-2 py-6 text-center text-xs font-mono"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  No strikes match &ldquo;{query}&rdquo;.
                </div>
              ) : (
                filteredRows.map((row) => {
                  const positive = row.net_gamma >= 0;
                  const isActive =
                    activeStrike === row.strike ||
                    highlightStrike === row.strike;
                  const widthPct = Math.max(2, row.intensity * 100);
                  return (
                    <button
                      type="button"
                      key={row.strike}
                      data-strike={row.strike}
                      onClick={() => handleRowClick(row.strike)}
                      onMouseEnter={() => onHighlight?.(row.strike)}
                      onMouseLeave={() => onHighlight?.(null)}
                      className={cn(
                        "group relative grid w-full grid-cols-[64px_1fr_28px_88px] items-center gap-2 rounded-sm border-l-2 border-transparent px-2 py-[3px] text-left text-[11px] font-mono tabular-nums transition-colors",
                        "hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-foid-strong)]",
                        positive
                          ? "border-l-[hsl(var(--emerald))]/50"
                          : "border-l-[hsl(var(--rose))]/60",
                        row.isSpotRow && "bg-white/[0.05]",
                        isActive && "bg-white/[0.08]",
                      )}
                      style={{ fontFamily: "var(--font-mono-foid)" }}
                      aria-label={`Strike ${row.strike} gamma ${formatDollarsCompact(row.net_gamma)}`}
                    >
                      <div className="flex items-center gap-1 font-semibold tabular-nums">
                        <span
                          style={{
                            color: row.isSpotRow
                              ? "var(--text-primary)"
                              : "var(--text-secondary)",
                          }}
                        >
                          {formatPrice(row.strike, dec)}
                        </span>
                        {row.isSpotRow ? (
                          <span
                            className="liquid-glass rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.18em]"
                            style={{
                              color: "var(--accent-foid)",
                              fontFamily: "var(--font-mono-foid)",
                            }}
                          >
                            ← SPOT
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="relative h-3 w-full overflow-hidden rounded-sm"
                        style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                      >
                        <div
                          className={cn(
                            "h-full rounded-sm transition-all",
                            intensityBg(row.intensity),
                          )}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <div className="flex justify-center">
                        <span
                          className={cn(
                            "inline-flex h-4 w-4 items-center justify-center rounded-sm font-mono text-[10px] font-bold",
                            positive
                              ? "bg-[hsl(var(--emerald))]/15 text-[hsl(var(--emerald))]"
                              : "bg-[hsl(var(--rose))]/15 text-[hsl(var(--rose))]",
                          )}
                        >
                          {positive ? "+" : "−"}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "text-right tabular-nums",
                          positive
                            ? "text-[hsl(var(--emerald))]"
                            : "text-[hsl(var(--rose))]",
                        )}
                      >
                        {formatDollarsCompact(row.net_gamma)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const FullChainHeatmap = memo(FullChainHeatmapImpl);

export default FullChainHeatmap;
