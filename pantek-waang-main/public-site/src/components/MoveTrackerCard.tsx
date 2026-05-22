import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Gauge } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { decimalsFor, formatPct, formatPoints } from "@/lib/format";

export interface MoveTrackerCardProps {
  symbol: string;
  impliedMove: number | null;
  realizedMove: number | null;
  ratio: number | null;
  regime: "compressed" | "expanded" | "in_range";
  loading?: boolean;
}

const REGIME_META: Record<
  MoveTrackerCardProps["regime"],
  { label: string; pillColor: string; barColor: string }
> = {
  compressed: {
    label: "COMPRESSED",
    pillColor: "hsl(var(--emerald))",
    barColor: "bg-[hsl(var(--emerald))]",
  },
  in_range: {
    label: "IN RANGE",
    pillColor: "var(--accent-foid)",
    barColor: "bg-[var(--accent-foid)]",
  },
  expanded: {
    label: "EXPANDED",
    pillColor: "hsl(var(--rose))",
    barColor: "bg-[hsl(var(--rose))]",
  },
};

function regimeAnnotation(
  regime: MoveTrackerCardProps["regime"],
  ratioPct: number | null,
): string {
  if (ratioPct === null) return "@ — — awaiting move data";
  const pct = `${ratioPct.toFixed(0)}%`;
  if (regime === "compressed") return `@ ${pct} — coiled, well inside the cone`;
  if (regime === "expanded") return `@ ${pct} — broken outside the cone`;
  return `@ ${pct} — moving inside the cone`;
}

/**
 * Realized vs implied daily move tracker. Visualises whether spot is moving
 * inside, at, or beyond the chain-implied 1σ envelope for the session.
 */
export function MoveTrackerCard({
  symbol,
  impliedMove,
  realizedMove,
  ratio,
  regime,
  loading = false,
}: MoveTrackerCardProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);
  const meta = REGIME_META[regime];

  // Convert ratio (0..1+) to a percentage capped at 150% for the visual bar.
  const ratioPct = useMemo<number | null>(() => {
    if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return null;
    return ratio * 100;
  }, [ratio]);

  const fillPct = useMemo<number>(() => {
    if (ratioPct === null) return 0;
    return Math.max(0, Math.min(150, ratioPct));
  }, [ratioPct]);

  // Bar visual range scales 0..150%. Zone marks at 50% and 100%.
  const fillFraction = (fillPct / 150) * 100;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="liquid-glass rounded-2xl p-5"
    >
      <div className="flex flex-row items-start justify-between gap-3">
        <div>
          <div
            className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            <Gauge className="h-3.5 w-3.5" />
            Move Tracker
          </div>
          <p
            className="mt-1.5 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Realized vs implied daily move
          </p>
        </div>
        <span
          className="liquid-glass rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{
            color: meta.pillColor,
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          {meta.label}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="Implied"
                value={formatPoints(impliedMove, dec, false)}
                unit="pts"
                tone="var(--text-primary)"
              />
              <Stat
                label="Realized"
                value={formatPoints(realizedMove, dec, false)}
                unit="pts"
                tone="var(--text-primary)"
              />
              <Stat
                label="Ratio"
                value={formatPct(ratioPct, 0, false)}
                tone={
                  regime === "expanded"
                    ? "hsl(var(--rose))"
                    : regime === "compressed"
                      ? "hsl(var(--emerald))"
                      : "var(--accent-foid)"
                }
              />
            </div>

            {/* Range bar: 0% .. 150% with zone shading. */}
            <div className="space-y-1.5">
              <div
                className="relative h-2 overflow-hidden rounded-full"
                style={{
                  borderColor: "var(--border-foid)",
                  borderWidth: 1,
                  backgroundColor: "rgba(255,255,255,0.02)",
                }}
              >
                {/* Zones: 0-50 emerald, 50-100 accent, 100-150 rose */}
                <div className="absolute inset-y-0 left-0 w-1/3 bg-[hsl(var(--emerald)/0.16)]" />
                <div className="absolute inset-y-0 left-1/3 w-1/3 bg-[var(--accent-foid)] opacity-15" />
                <div className="absolute inset-y-0 left-2/3 w-1/3 bg-[hsl(var(--rose)/0.16)]" />
                <div
                  className="absolute inset-y-0 left-1/3 w-px"
                  style={{ backgroundColor: "var(--border-foid-strong)" }}
                  aria-hidden
                />
                <div
                  className="absolute inset-y-0 left-2/3 w-px"
                  style={{ backgroundColor: "var(--border-foid-strong)" }}
                  aria-hidden
                />
                <motion.div
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${fillFraction}%` }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-r-full",
                    meta.barColor,
                  )}
                />
              </div>
              <div
                className="flex justify-between font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
                <span>150%</span>
              </div>
            </div>

            <div
              className="liquid-glass rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              <span style={{ color: "var(--text-primary)" }}>{">"}</span>{" "}
              {regimeAnnotation(regime, ratioPct)}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

interface StatProps {
  label: string;
  value: string;
  unit?: string;
  tone: string;
}

function Stat({ label, value, unit, tone }: StatProps) {
  return (
    <div className="liquid-glass rounded-xl px-2.5 py-2">
      <div
        className="font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className="font-mono text-base font-semibold tabular-nums"
          style={{ color: tone, fontFamily: "var(--font-mono-foid)" }}
        >
          {value}
        </span>
        {unit ? (
          <span
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default MoveTrackerCard;
