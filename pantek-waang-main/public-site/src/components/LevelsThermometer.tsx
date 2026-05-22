import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { formatPrice, formatPoints, decimalsFor } from "@/lib/format";
import type { FuturesKeyLevel, FuturesKeyLevelKind } from "@/lib/api";

const KIND_COLORS: Record<FuturesKeyLevelKind, string> = {
  flip: "hsl(var(--violet))",
  wall_call: "hsl(var(--emerald))",
  wall_put: "hsl(var(--rose))",
  max_pain: "hsl(var(--amber))",
  gex_pos: "hsl(var(--emerald))",
  gex_neg: "hsl(var(--rose))",
};

function CardShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("liquid-glass rounded-2xl p-5 sm:p-6", className)}>
      {children}
    </div>
  );
}

function CardEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-mono uppercase tracking-[0.2em]"
      style={{
        color: "var(--text-secondary)",
        fontFamily: "var(--font-mono-foid)",
      }}
    >
      {children}
    </div>
  );
}

function CardSubtitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-1 text-xs font-mono"
      style={{
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono-foid)",
      }}
    >
      {children}
    </p>
  );
}

const KIND_LABELS: Record<FuturesKeyLevelKind, string> = {
  flip: "Flip",
  wall_call: "Call Wall",
  wall_put: "Put Wall",
  max_pain: "Max Pain",
  gex_pos: "GEX +",
  gex_neg: "GEX -",
};

interface LevelsThermometerProps {
  symbol: string;
  levels: FuturesKeyLevel[];
  futuresPrice: number | null;
  cashSpot: number | null;
  highlightStrike: number | null;
  onHighlight: (strike: number | null) => void;
  className?: string;
  /** When true, render skeleton placeholder instead of empty state. */
  loading?: boolean;
}

interface DerivedRange {
  min: number;
  max: number;
  span: number;
}

/**
 * Pick the 4 nearest levels above and below the futures price.
 */
function pickNearest(
  levels: FuturesKeyLevel[],
  ref: number,
  perSide = 4,
): FuturesKeyLevel[] {
  const above = levels
    .filter((lvl) => lvl.futures_level >= ref)
    .sort((a, b) => a.futures_level - b.futures_level)
    .slice(0, perSide);
  const below = levels
    .filter((lvl) => lvl.futures_level < ref)
    .sort((a, b) => b.futures_level - a.futures_level)
    .slice(0, perSide);
  return [...below, ...above];
}

function deriveRange(values: number[], pad = 0.005): DerivedRange {
  if (values.length === 0) {
    return { min: 0, max: 1, span: 1 };
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * pad;
  min -= padding;
  max += padding;
  return { min, max, span: max - min };
}

export function LevelsThermometer({
  symbol,
  levels,
  futuresPrice,
  cashSpot,
  highlightStrike,
  onHighlight,
  className,
  loading = false,
}: LevelsThermometerProps) {
  const reduce = useReducedMotion();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const ref = futuresPrice ?? cashSpot ?? null;

  const visible = useMemo(() => {
    if (!ref || !levels.length) return [] as FuturesKeyLevel[];
    return pickNearest(levels, ref, 4);
  }, [levels, ref]);

  const range = useMemo(() => {
    if (!ref) return { min: 0, max: 1, span: 1 };
    const xs = visible.map((l) => l.futures_level).concat([ref]);
    return deriveRange(xs, 0.05);
  }, [visible, ref]);

  if (loading) {
    return (
      <CardShell className={cn(className)}>
        <CardEyebrow>Spot vs key levels</CardEyebrow>
        <CardSubtitle>Nearest 8 levels around futures price.</CardSubtitle>
        <div className="mt-4">
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </CardShell>
    );
  }

  if (!ref || visible.length === 0) {
    return (
      <CardShell className={cn(className)}>
        <CardEyebrow>Spot vs key levels</CardEyebrow>
        <div className="mt-4">
          <EmptyState
            icon={<Activity />}
            headline="Building snapshot"
            subline="Levels populate as the chain ticks. Open a chart in another tab to keep an eye on the next compute window."
            pad="md"
            inline
          />
        </div>
      </CardShell>
    );
  }

  const dec = decimalsFor(symbol);

  function pct(value: number): number {
    return ((value - range.min) / range.span) * 100;
  }

  return (
    <CardShell className={cn(className)}>
      <CardEyebrow>Spot vs key levels</CardEyebrow>
      <CardSubtitle>Nearest 8 levels around futures price.</CardSubtitle>
      <div className="mt-4">
        {/* Compact pill list below `lg` */}
        <div className="flex flex-wrap gap-2 lg:hidden">
          {visible.map((lvl) => {
            const isHighlighted = highlightStrike === lvl.cash_strike;
            const color = KIND_COLORS[lvl.kind];
            return (
              <button
                type="button"
                key={`pill-${lvl.kind}-${lvl.cash_strike}-${lvl.label}`}
                onMouseEnter={() => onHighlight(lvl.cash_strike)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(lvl.cash_strike)}
                onBlur={() => onHighlight(null)}
                aria-label={`${KIND_LABELS[lvl.kind]} at ${formatPrice(lvl.cash_strike, dec)} cash`}
                className={cn(
                  "liquid-glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono tabular-nums transition-colors",
                  "focus:outline-none focus-visible:ring-2",
                  isHighlighted ? "opacity-100" : "opacity-90 hover:opacity-100",
                )}
                style={{ fontFamily: "var(--font-mono-foid)" }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span style={{ color }}>
                  {KIND_LABELS[lvl.kind]}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {formatPrice(lvl.futures_level, 2)}
                </span>
                {lvl.distance_pts !== null ? (
                  <span
                    className="text-[10px]"
                    style={{
                      color:
                        lvl.distance_pts >= 0
                          ? "var(--accent-foid)"
                          : "var(--accent-put)",
                    }}
                  >
                    {formatPoints(lvl.distance_pts, 1)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Thermometer at `lg` and above */}
        <div className="relative hidden h-28 w-full lg:block">
          {/* Background rail */}
          <div
            className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
            style={{ backgroundColor: "var(--border-foid)" }}
          />

          {/* Level ticks */}
          {visible.map((lvl, idx) => {
            const left = pct(lvl.futures_level);
            const isHighlighted = highlightStrike === lvl.cash_strike;
            const isHovered = hoverIndex === idx;
            const meta = KIND_COLORS[lvl.kind];
            return (
              <button
                type="button"
                key={`${lvl.kind}-${lvl.cash_strike}-${lvl.label}`}
                className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full focus:outline-none focus-visible:ring-2"
                style={{ left: `${left}%` }}
                onMouseEnter={() => {
                  setHoverIndex(idx);
                  onHighlight(lvl.cash_strike);
                }}
                onMouseLeave={() => {
                  setHoverIndex(null);
                  onHighlight(null);
                }}
                onFocus={() => {
                  setHoverIndex(idx);
                  onHighlight(lvl.cash_strike);
                }}
                onBlur={() => {
                  setHoverIndex(null);
                  onHighlight(null);
                }}
                aria-label={`${KIND_LABELS[lvl.kind]} at ${formatPrice(lvl.cash_strike, dec)} cash`}
              >
                <span
                  className={cn(
                    "block rounded-full transition-transform duration-200",
                    isHovered || isHighlighted
                      ? "h-5 w-5 scale-110 ring-2"
                      : "h-3.5 w-3.5",
                  )}
                  style={{ backgroundColor: meta }}
                />
                <span
                  className={cn(
                    "pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums transition-opacity",
                    idx % 2 === 0 ? "-bottom-7" : "-top-7",
                  )}
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  {formatPrice(lvl.futures_level, 2)}
                </span>

                {(isHovered || isHighlighted) && (
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="liquid-glass-strong pointer-events-none absolute left-1/2 top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs"
                    style={{ fontFamily: "var(--font-mono-foid)" }}
                  >
                    <div style={{ color: meta }}>
                      {KIND_LABELS[lvl.kind]}
                    </div>
                    <div
                      className="font-mono tabular-nums"
                      style={{ color: "var(--text-primary)" }}
                    >
                      Cash {formatPrice(lvl.cash_strike, dec)}
                    </div>
                    <div
                      className="font-mono tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Fut&nbsp;&nbsp;&nbsp;{formatPrice(lvl.futures_level, 2)}
                    </div>
                    {lvl.distance_pts !== null ? (
                      <div
                        className="font-mono tabular-nums"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Δ&nbsp;&nbsp;&nbsp;&nbsp;{formatPoints(lvl.distance_pts, 2)} pts
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </button>
            );
          })}

          {/* Spot marker */}
          <div
            className="absolute top-1/2 z-20 h-16 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${pct(ref)}%`,
              backgroundColor: "var(--text-primary)",
            }}
          />
          <div
            className="absolute z-20 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] tabular-nums"
            style={{
              left: `${pct(ref)}%`,
              top: "-22px",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {formatPrice(ref, 2)}
          </div>
        </div>
      </div>
    </CardShell>
  );
}
