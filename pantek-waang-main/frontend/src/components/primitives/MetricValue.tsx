import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";
type Tone = "neutral" | "positive" | "negative" | "flip";

interface Props {
  value: number | string | null | undefined;
  format?: (v: number) => string;
  size?: Size;
  tone?: Tone;
  flashOnChange?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
}

const sizeClass: Record<Size, string> = {
  sm: "text-metric-sm",
  md: "text-metric-md",
  lg: "text-metric-lg",
  xl: "text-metric-xl",
};

const toneClass: Record<Tone, string> = {
  neutral: "text-fg-primary",
  positive: "text-positive",
  negative: "text-negative",
  flip: "text-flip",
};

export function MetricValue({
  value,
  format,
  size = "md",
  tone = "neutral",
  flashOnChange = false,
  prefix,
  suffix,
  className,
}: Props) {
  const [flash, setFlash] = useState<"positive" | "negative" | null>(null);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (!flashOnChange || typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }
    if (prev.current !== null && value !== prev.current) {
      setFlash(value > prev.current ? "positive" : "negative");
      const t = setTimeout(() => setFlash(null), 600);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value, flashOnChange]);

  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "number"
        ? Number.isFinite(value)
          ? format
            ? format(value)
            : value.toLocaleString()
          : "—"
        : value;

  return (
    <span
      className={cn(
        "font-mono tabular-nums tracking-tight transition-colors",
        sizeClass[size],
        toneClass[tone],
        flash === "positive" && "animate-flash-positive",
        flash === "negative" && "animate-flash-negative",
        className,
      )}
    >
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
