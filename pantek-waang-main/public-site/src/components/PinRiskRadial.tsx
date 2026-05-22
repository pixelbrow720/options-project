import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { decimalsFor, formatNumber, formatPct, formatPrice } from "@/lib/format";

export interface PinRiskStrike {
  strike: number;
  probability: number;
  oi?: number | null;
}

interface PinRiskRadialProps {
  symbol: string;
  spot: number | null;
  strikes: PinRiskStrike[] | null;
  topPin: { strike: number; probability: number } | null;
  loading?: boolean;
  className?: string;
}

interface RankedStrike extends PinRiskStrike {
  /** Width as percent of the largest probability in the list. */
  widthPct: number;
  /** Distance from spot, in percent (signed). */
  distancePct: number | null;
  /** 0..1 closeness factor (1 = at spot). */
  closeness: number;
}

/**
 * Pick a fill color along the warm/cool axis based on closeness to spot.
 * Closest -> amber/red; furthest -> muted/violet.
 */
function colorForCloseness(closeness: number): string {
  if (closeness >= 0.85) return "hsl(var(--rose))";
  if (closeness >= 0.6) return "hsl(var(--amber))";
  if (closeness >= 0.35) return "hsl(var(--emerald))";
  return "hsl(var(--violet))";
}

function pickPercent(p: number): number {
  // Probabilities can come in as 0..1 or 0..100. Normalise to 0..100 for
  // display, but never exceed 100.
  const v = p > 1 ? p : p * 100;
  return Math.max(0, Math.min(100, v));
}

export function PinRiskRadial({
  symbol,
  spot,
  strikes,
  topPin,
  loading = false,
  className,
}: PinRiskRadialProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);

  const ranked = useMemo<RankedStrike[]>(() => {
    if (!strikes || strikes.length === 0) return [];
    const sorted = strikes
      .slice()
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 7);

    const top = sorted[0]?.probability ?? 0;
    const denom = top > 0 ? top : 1;

    // Build closeness scale based on max distance among the visible strikes.
    let maxDist = 0;
    if (spot !== null && spot > 0) {
      for (const s of sorted) {
        const d = Math.abs(s.strike - spot);
        if (d > maxDist) maxDist = d;
      }
    }
    const distDenom = maxDist > 0 ? maxDist : 1;

    return sorted.map((s) => {
      const distancePts = spot !== null ? s.strike - spot : null;
      const distancePct =
        spot !== null && spot > 0 ? ((s.strike - spot) / spot) * 100 : null;
      const absDist = distancePts !== null ? Math.abs(distancePts) : 0;
      const closeness = spot !== null ? 1 - absDist / distDenom : 0.5;
      return {
        ...s,
        widthPct: (s.probability / denom) * 100,
        distancePct,
        closeness: Math.max(0, Math.min(1, closeness)),
      };
    });
  }, [strikes, spot]);

  const topStrike = topPin ?? (ranked.length > 0 ? ranked[0] : null);

  const topDistanceLabel = useMemo(() => {
    if (!topStrike || spot === null || spot <= 0) return null;
    const pct = ((topStrike.strike - spot) / spot) * 100;
    const direction = pct > 0 ? "above" : pct < 0 ? "below" : "at";
    if (direction === "at") return "at spot";
    return `${formatPct(Math.abs(pct), 2, false)} ${direction} spot`;
  }, [topStrike, spot]);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn(className)}
    >
      <div className="liquid-glass overflow-hidden rounded-2xl p-5 sm:p-6">
        <div className="flex flex-row items-baseline justify-between gap-3">
          <div>
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Pin risk · 16:00 close
            </div>
            <p
              className="mt-1 text-xs font-mono"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Likelihood SPX/NDX closes at each strike.
            </p>
          </div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.18em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {symbol}
          </div>
        </div>
        <div className="mt-4">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="mx-auto h-16 w-48 rounded-lg" />
              <div className="space-y-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={`pin-skel-${i}`} className="h-7 w-full rounded" />
                ))}
              </div>
            </div>
          ) : ranked.length === 0 || !topStrike ? (
            <EmptyState
              icon={<Target />}
              headline="Pin probability not available"
              subline="Pin probability not available — needs settled chain."
              pad="md"
              inline
            />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-1 py-2">
                <div
                  className="text-[10px] font-mono uppercase tracking-[0.2em]"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Top pin candidate
                </div>
                <div
                  className="tabular-nums"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: "clamp(2rem, 4vw, 2.75rem)",
                    lineHeight: 1.05,
                  }}
                >
                  <span style={{ color: "var(--text-primary)" }}>
                    {formatPrice(topStrike.strike, dec)}
                  </span>
                  <span
                    className="px-2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    ·
                  </span>
                  <span style={{ color: "var(--accent-amber)" }}>
                    {formatPct(pickPercent(topStrike.probability), 0, false)}
                  </span>
                </div>
                {topDistanceLabel ? (
                  <div
                    className="text-xs font-mono"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  >
                    {topDistanceLabel}
                  </div>
                ) : null}
              </div>

              <ul className="space-y-1.5">
                {ranked.map((s) => {
                  const pct = pickPercent(s.probability);
                  const fill = colorForCloseness(s.closeness);
                  const isTop = topStrike && s.strike === topStrike.strike;
                  return (
                    <li
                      key={`pin-${s.strike}`}
                      className={cn(
                        "rounded-md px-2 py-1 transition-colors",
                        isTop && "bg-white/[0.04]",
                      )}
                      style={
                        isTop
                          ? { border: "1px solid var(--border-foid)" }
                          : { border: "1px solid transparent" }
                      }
                    >
                      <div className="flex items-center gap-3 text-xs">
                        <div
                          className="w-16 shrink-0 font-mono tabular-nums"
                          style={{
                            color: "var(--text-primary)",
                            fontFamily: "var(--font-mono-foid)",
                          }}
                        >
                          {formatPrice(s.strike, dec)}
                        </div>
                        <div
                          className="relative h-3 flex-1 overflow-hidden rounded-full"
                          style={{ backgroundColor: "var(--border-foid)" }}
                        >
                          <motion.div
                            initial={reduce ? false : { width: 0 }}
                            animate={{ width: `${Math.max(2, s.widthPct)}%` }}
                            transition={{
                              duration: 0.5,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: fill }}
                          />
                        </div>
                        <div
                          className="w-12 shrink-0 text-right font-mono tabular-nums"
                          style={{
                            color: fill,
                            fontFamily: "var(--font-mono-foid)",
                          }}
                        >
                          {formatPct(pct, 0, false)}
                        </div>
                        {s.oi !== null && s.oi !== undefined ? (
                          <div
                            className="hidden w-16 shrink-0 text-right font-mono tabular-nums sm:block"
                            style={{
                              color: "var(--text-muted)",
                              fontFamily: "var(--font-mono-foid)",
                            }}
                          >
                            {formatNumber(s.oi)}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default PinRiskRadial;
