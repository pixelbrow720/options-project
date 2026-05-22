import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Gauge,
  Minus,
  Sigma,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type GexRegime = "positive" | "negative" | "neutral";
type VolRegime = "low" | "high";
type FlowRegime = "bullish" | "bearish" | "neutral";

interface RegimeBadgeProps {
  symbol: string;
  gexRegime: GexRegime | null;
  gexScore: number | null;
  volRegime: VolRegime | null;
  flowRegime: FlowRegime | null;
  summary: string | null;
  narrative: string | null;
  loading?: boolean;
  className?: string;
}

interface PillTone {
  /** Tailwind class (or inline style key) for the text + icon color. */
  fg: string;
  Icon: LucideIcon;
  label: string;
}

const GEX_TONE: Record<GexRegime, PillTone> = {
  positive: {
    fg: "text-[hsl(var(--violet))]",
    Icon: Sigma,
    label: "Positive Γ",
  },
  negative: {
    fg: "text-[hsl(var(--rose))]",
    Icon: Zap,
    label: "Negative Γ",
  },
  neutral: {
    fg: "",
    Icon: Minus,
    label: "Neutral Γ",
  },
};

const VOL_TONE: Record<VolRegime, PillTone> = {
  high: {
    fg: "text-[hsl(var(--amber))]",
    Icon: Activity,
    label: "High vol",
  },
  low: {
    fg: "text-[hsl(var(--accent))]",
    Icon: Waves,
    label: "Low vol",
  },
};

const FLOW_TONE: Record<FlowRegime, PillTone> = {
  bullish: {
    fg: "text-[hsl(var(--emerald))]",
    Icon: ArrowUpRight,
    label: "Bullish flow",
  },
  bearish: {
    fg: "text-[hsl(var(--rose))]",
    Icon: ArrowDownRight,
    label: "Bearish flow",
  },
  neutral: {
    fg: "",
    Icon: Minus,
    label: "Neutral flow",
  },
};

const NEUTRAL_FALLBACK: PillTone = {
  fg: "",
  Icon: Gauge,
  label: "—",
};

interface RegimePillProps {
  prefix: string;
  tone: PillTone;
}

function RegimePill({ prefix, tone }: RegimePillProps) {
  const { Icon } = tone;
  const isNeutral = tone.fg === "";
  return (
    <div
      className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-1.5"
    >
      <Icon
        className={cn("h-3.5 w-3.5", tone.fg)}
        style={isNeutral ? { color: "var(--text-secondary)" } : undefined}
        aria-hidden
      />
      <span
        className="text-[10px] font-mono uppercase tracking-[0.18em]"
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        {prefix}
      </span>
      <span
        className={cn(
          "text-[11px] font-mono font-semibold uppercase tracking-[0.12em]",
          tone.fg,
        )}
        style={{
          fontFamily: "var(--font-mono-foid)",
          color: isNeutral ? "var(--text-secondary)" : undefined,
        }}
      >
        {tone.label}
      </span>
    </div>
  );
}

function buildSummary(
  gex: GexRegime | null,
  vol: VolRegime | null,
  flow: FlowRegime | null,
): string {
  const parts: string[] = [];
  if (gex === "positive") parts.push("POSITIVE GAMMA");
  else if (gex === "negative") parts.push("NEGATIVE GAMMA");
  else if (gex === "neutral") parts.push("NEUTRAL GAMMA");
  if (vol === "high") parts.push("HIGH VOL");
  else if (vol === "low") parts.push("LOW VOL");
  if (flow === "bullish") parts.push("BULLISH FLOW");
  else if (flow === "bearish") parts.push("BEARISH FLOW");
  else if (flow === "neutral") parts.push("NEUTRAL FLOW");
  return parts.join(" · ");
}

export function RegimeBadge({
  symbol,
  gexRegime,
  gexScore,
  volRegime,
  flowRegime,
  summary,
  narrative,
  loading = false,
  className,
}: RegimeBadgeProps) {
  const reduce = useReducedMotion();

  const gexTone = gexRegime ? GEX_TONE[gexRegime] : NEUTRAL_FALLBACK;
  const volTone = volRegime ? VOL_TONE[volRegime] : NEUTRAL_FALLBACK;
  const flowTone = flowRegime ? FLOW_TONE[flowRegime] : NEUTRAL_FALLBACK;

  const computedSummary = useMemo(() => {
    if (summary && summary.trim().length > 0) return summary.toUpperCase();
    return buildSummary(gexRegime, volRegime, flowRegime);
  }, [summary, gexRegime, volRegime, flowRegime]);

  const scoreLabel = useMemo(() => {
    if (gexScore === null || !Number.isFinite(gexScore)) return null;
    const sign = gexScore > 0 ? "+" : gexScore < 0 ? "−" : "";
    return `${sign}${Math.abs(gexScore).toFixed(2)}`;
  }, [gexScore]);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn("liquid-glass rounded-2xl p-5", className)}
    >
      <div className="flex flex-row items-baseline justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Market regime
          </div>
          <p
            className="mt-1.5 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            GEX · vol · flow snapshot
          </p>
        </div>
        <div className="flex items-baseline gap-3">
          {scoreLabel ? (
            <span
              className="font-mono text-xs tabular-nums"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              score{" "}
              <span
                className={cn(
                  "font-semibold",
                  (gexScore ?? 0) > 0
                    ? "text-[hsl(var(--emerald))]"
                    : (gexScore ?? 0) < 0
                      ? "text-[hsl(var(--rose))]"
                      : "",
                )}
                style={
                  (gexScore ?? 0) === 0
                    ? { color: "var(--text-primary)" }
                    : undefined
                }
              >
                {scoreLabel}
              </span>
            </span>
          ) : null}
          <span
            className="text-[10px] font-mono uppercase tracking-[0.18em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {symbol}
          </span>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-32 rounded-full" />
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-32 rounded-full" />
            </div>
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-5/6 rounded" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <RegimePill prefix="GEX" tone={gexTone} />
              <RegimePill prefix="VOL" tone={volTone} />
              <RegimePill prefix="FLOW" tone={flowTone} />
            </div>

            {computedSummary ? (
              <div
                className="font-mono text-xs font-semibold uppercase tracking-[0.18em] tabular-nums"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                {computedSummary}
              </div>
            ) : null}

            {narrative ? (
              <p
                className="font-mono text-xs leading-relaxed"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                {narrative}
              </p>
            ) : (
              <p
                className="font-mono text-xs leading-relaxed"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                Narrative populates once today's regime classifier returns a
                stable read across GEX, vol, and flow inputs.
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default RegimeBadge;
