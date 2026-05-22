import { type ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: number | null | undefined;
  format?: (v: number) => string;
  showSign?: boolean;
  className?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function DeltaBadge({ value, format, showSign = true, className, prefix, suffix }: Props) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("font-mono text-xs text-fg-faint", className)}>—</span>;
  }
  const tone = value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  const display = format ? format(Math.abs(value)) : Math.abs(value).toFixed(2);
  const sign = showSign ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  const toneStyles = {
    positive: "text-positive bg-positive/10",
    negative: "text-negative bg-negative/10",
    neutral: "text-fg-muted bg-fg-muted/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums",
        toneStyles[tone],
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {prefix}
      {sign}
      {display}
      {suffix}
    </span>
  );
}
