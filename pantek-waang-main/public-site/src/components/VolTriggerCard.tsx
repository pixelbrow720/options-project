import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, Info, ShieldAlert, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { decimalsFor, formatPct, formatPoints, formatPrice } from "@/lib/format";

export interface VolTriggerCardProps {
  symbol: string;
  volTrigger: number | null;
  spot: number | null;
  distancePts: number | null;
  distancePct: number | null;
  belowTrigger: boolean;
  regime: "stable" | "vol_expansion";
  loading?: boolean;
}

const REGIME_META: Record<
  VolTriggerCardProps["regime"],
  {
    label: string;
    pillColor: string;
    icon: typeof ShieldCheck;
  }
> = {
  stable: {
    label: "STABLE",
    pillColor: "hsl(var(--emerald))",
    icon: ShieldCheck,
  },
  vol_expansion: {
    label: "VOL EXPANSION",
    pillColor: "hsl(var(--rose))",
    icon: ShieldAlert,
  },
};

/**
 * SpotGamma-style Vol Trigger card. Surfaces the strike below which dealers
 * flip to short gamma — the canonical regime-shift signal for index 0DTEs.
 */
export function VolTriggerCard({
  symbol,
  volTrigger,
  spot,
  distancePts,
  distancePct,
  belowTrigger,
  regime,
  loading = false,
}: VolTriggerCardProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);
  const meta = REGIME_META[regime];
  const Icon = meta.icon;

  // Position spot on a -3% .. +3% horizontal scale relative to vol trigger.
  const gaugeFill = useMemo(() => {
    if (distancePct === null || distancePct === undefined) return 50;
    const clamped = Math.max(-3, Math.min(3, distancePct));
    return ((clamped + 3) / 6) * 100;
  }, [distancePct]);

  const valueColor = belowTrigger
    ? "hsl(var(--rose))"
    : "hsl(var(--emerald))";

  const DistanceArrow =
    distancePts === null
      ? null
      : distancePts >= 0
        ? ArrowUp
        : ArrowDown;
  const distanceColor =
    distancePts === null
      ? "var(--text-muted)"
      : distancePts >= 0
        ? "hsl(var(--emerald))"
        : "hsl(var(--rose))";

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
            Vol Trigger
            <span
              className="inline-flex"
              title="Strike below which dealers flip net short gamma. When spot trades below this level, dealer hedging amplifies moves and realized volatility expands."
            >
              <Info className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
            </span>
          </div>
          <p
            className="mt-1.5 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Strike below which dealers go short gamma (volatility expands)
          </p>
        </div>
        <span
          className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{
            color: meta.pillColor,
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span
                className="tabular-nums leading-none"
                style={{
                  color: valueColor,
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "clamp(2rem, 5vw, 3.5rem)",
                }}
              >
                {formatPrice(volTrigger, dec)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                Spot
              </span>
              <span
                className="font-mono tabular-nums"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                {formatPrice(spot, dec)}
              </span>
              <span
                className="inline-flex items-center gap-1 font-mono text-xs tabular-nums"
                style={{
                  color: distanceColor,
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                {DistanceArrow ? <DistanceArrow className="h-3 w-3" /> : null}
                {formatPoints(distancePts, 2)}pts
                <span style={{ color: "var(--text-muted)" }}>
                  ({formatPct(distancePct, 2)})
                </span>
              </span>
            </div>

            {/* Gauge: spot's position relative to trigger over a +/- 3% band. */}
            <div className="space-y-1.5">
              <div
                className="flex justify-between font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                <span>-3%</span>
                <span>Trigger</span>
                <span>+3%</span>
              </div>
              <div
                className="relative h-2 overflow-hidden rounded-full"
                style={{
                  borderColor: "var(--border-foid)",
                  borderWidth: 1,
                  backgroundColor: "rgba(255,255,255,0.02)",
                }}
              >
                <div className="absolute inset-y-0 left-0 right-1/2 bg-[hsl(var(--rose)/0.18)]" />
                <div className="absolute inset-y-0 right-0 left-1/2 bg-[hsl(var(--emerald)/0.18)]" />
                <div
                  className="absolute inset-y-0 left-1/2 w-px"
                  style={{ backgroundColor: "var(--border-foid-strong)" }}
                />
                <motion.div
                  initial={reduce ? false : { left: "50%" }}
                  animate={{ left: `${gaugeFill}%` }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow",
                    belowTrigger
                      ? "bg-[hsl(var(--rose))]"
                      : "bg-[hsl(var(--emerald))]",
                  )}
                  style={{ borderColor: "var(--bg)" }}
                />
              </div>
              <div
                className="flex justify-between font-mono text-[10px] tabular-nums"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                <span>{belowTrigger ? "Spot in red zone" : "Stable zone"}</span>
                <span>
                  {distancePts !== null && distancePts !== undefined
                    ? `${formatPoints(distancePts, 2)}pts vs trigger`
                    : "—"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default VolTriggerCard;
