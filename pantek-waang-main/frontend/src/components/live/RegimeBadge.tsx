import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { RegimePayload } from "@/lib/streamClient";

export type RegimeKind = "bullish" | "neutral" | "bearish";

function classifyLabel(label: string | undefined): RegimeKind {
  const v = (label ?? "").toLowerCase();
  if (v === "bullish" || v === "bull") return "bullish";
  if (v === "bearish" || v === "bear") return "bearish";
  return "neutral";
}

function pickEntry(
  regime: RegimePayload | undefined,
): { label: string; score: number } | null {
  if (!regime) return null;
  if (regime.label) {
    return { label: String(regime.label), score: Number(regime.score ?? 0) };
  }
  if (regime.oi) return { label: regime.oi.label, score: regime.oi.score };
  if (regime.vol) return { label: regime.vol.label, score: regime.vol.score };
  return null;
}

export interface RegimeBadgeProps {
  regime: RegimePayload | undefined;
}

const STYLES: Record<RegimeKind, { bg: string; text: string; dot: string; ring: string }> = {
  bullish: {
    bg: "bg-positive-soft/40 border-positive/30",
    text: "text-positive",
    dot: "bg-positive",
    ring: "shadow-[0_0_12px_hsl(var(--positive)_/_0.45)]",
  },
  neutral: {
    bg: "bg-flip-soft/40 border-flip/30",
    text: "text-flip",
    dot: "bg-flip",
    ring: "shadow-[0_0_10px_hsl(var(--flip)_/_0.45)]",
  },
  bearish: {
    bg: "bg-negative-soft/40 border-negative/30",
    text: "text-negative",
    dot: "bg-negative",
    ring: "shadow-[0_0_12px_hsl(var(--negative)_/_0.45)]",
  },
};

export function RegimeBadge({ regime }: RegimeBadgeProps) {
  const entry = pickEntry(regime);
  const kind = classifyLabel(entry?.label);
  const text = entry ? entry.label.toUpperCase() : "UNKNOWN";
  const style = STYLES[kind];

  return (
    <motion.div
      layout
      data-testid="regime-badge"
      data-kind={kind}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        style.bg,
        style.text,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full pulse-soft", style.dot, style.ring)} />
      <span>{text}</span>
      {entry && (
        <span className="font-mono text-[10px] font-normal opacity-70 tabular-nums">
          {entry.score >= 0 ? "+" : ""}
          {entry.score.toFixed(2)}
        </span>
      )}
    </motion.div>
  );
}
