import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatDollarsCompact, formatPct, formatRate } from "@/lib/format";
import { useValueFlash } from "@/lib/useValueFlash";
import type { ZeroDtePayload } from "@/lib/api";

interface FlipSpeedStripProps {
  zeroDte: ZeroDtePayload | null;
  className?: string;
}

interface MetricCardProps {
  title: string;
  value: string;
  detail?: string;
  numeric: number | null;
  tone?: "default" | "positive" | "negative" | "muted";
  /** Tooltip text shown on hover/focus of the card title. */
  helpText?: string;
}

function tone(value: number | null | undefined): "positive" | "negative" | "muted" {
  if (value === null || value === undefined || Number.isNaN(value)) return "muted";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "muted";
}

function toneColor(t: "default" | "positive" | "negative" | "muted"): string {
  if (t === "positive") return "var(--accent-foid)";
  if (t === "negative") return "var(--accent-put)";
  if (t === "muted") return "var(--text-muted)";
  return "var(--text-primary)";
}

function MetricCard({
  title,
  value,
  detail,
  numeric,
  tone: t = "default",
  helpText,
}: MetricCardProps) {
  const reduce = useReducedMotion();
  const { flash, pulseKey } = useValueFlash(numeric, 650);
  const flashBg =
    flash === "up"
      ? "rgba(72, 187, 120, 0.16)"
      : flash === "down"
        ? "rgba(246, 135, 179, 0.16)"
        : "rgba(99, 179, 237, 0.14)";
  return (
    <div className="liquid-glass group relative rounded-2xl p-5 transition-all duration-300 sm:p-6">
      <div
        className="cursor-help text-[10px] font-mono uppercase tracking-[0.2em] decoration-dotted underline-offset-4 hover:underline"
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono-foid)",
        }}
        title={helpText}
      >
        {title}
      </div>
      <div className="relative mt-3">
        {!reduce && flash ? (
          <motion.span
            key={pulseKey}
            aria-hidden
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute -inset-x-2 -inset-y-1 -z-10 rounded-lg blur-md"
            style={{ backgroundColor: flashBg }}
          />
        ) : null}
        <div
          className="tabular-nums"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "clamp(2rem, 3.4vw, 2.75rem)",
            color: toneColor(t),
            lineHeight: 1,
          }}
        >
          {value}
        </div>
      </div>
      {detail ? (
        <div
          className="mt-2 text-xs font-mono"
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export function FlipSpeedStrip({ zeroDte, className }: FlipSpeedStripProps) {
  const netGex = zeroDte?.gex_oi.net_total ?? null;
  const flipSpeed = zeroDte?.flip_speed ?? null;
  const charmRate = zeroDte?.charm_decay_rate ?? null;
  const charmPctPerHour = charmRate !== null ? charmRate * 100 : null;

  return (
    <div className={cn("grid gap-3 sm:grid-cols-3", className)}>
      <MetricCard
        title="Net 0DTE GEX"
        value={netGex !== null ? formatDollarsCompact(netGex) : "—"}
        detail="Open-interest weighted gamma exposure"
        numeric={netGex}
        tone={tone(netGex)}
        helpText="Net dealer gamma across today's expiry. Positive = dampening; negative = amplifying."
      />
      <MetricCard
        title="Flip Speed"
        value={flipSpeed !== null ? formatRate(flipSpeed) : "—"}
        detail="Rate of change of zero-gamma point"
        numeric={flipSpeed}
        tone={tone(flipSpeed)}
        helpText="How quickly the zero-gamma flip is moving. High magnitude = unstable regime."
      />
      <MetricCard
        title="Charm Decay"
        value={
          charmPctPerHour !== null
            ? formatPct(charmPctPerHour, 4, true).replace("%", "%/h")
            : "—"
        }
        detail="Delta decay from passing time, per hour"
        numeric={charmPctPerHour}
        tone={tone(charmPctPerHour)}
        helpText="Rate at which option deltas decay each hour. Drives end-of-day pinning into expiry."
      />
    </div>
  );
}
