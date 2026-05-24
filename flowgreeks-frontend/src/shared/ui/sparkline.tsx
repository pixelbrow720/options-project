import { useMemo } from "react";

interface SparklineProps {
  values: ReadonlyArray<number>;
  width?: number;
  height?: number;
  /** Stroke color; defaults to the sign of the last delta. */
  color?: string;
  /** Render a baseline at 0 if values cross sign. */
  baseline?: boolean;
  ariaLabel?: string;
}

/**
 * Tiny sparkline — pure SVG, zero dependency. Used in row-level KPIs
 * (HIRO last 60min, basis last hour). For full charts use uPlot in
 * shared/charts.
 *
 * The color defaults to the sign of (last - first) so a trader sees
 * the bias at a glance without reading the legend.
 */
export function Sparkline({
  values,
  width = 80,
  height = 22,
  color,
  baseline = true,
  ariaLabel,
}: SparklineProps) {
  const path = useMemo(() => {
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = values.length > 1 ? width / (values.length - 1) : 0;
    let d = "";
    let zeroY: number | null = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i] ?? 0;
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }
    if (baseline && min < 0 && max > 0) {
      zeroY = height - ((0 - min) / span) * height;
    }
    return { d, zeroY };
  }, [values, width, height, baseline]);

  if (!path) return null;

  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const auto = last >= first ? "var(--color-long-strong)" : "var(--color-short-strong)";
  const stroke = color ?? auto;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel ?? "trend"}
      style={{ display: "block" }}
    >
      {path.zeroY != null ? (
        <line
          x1={0}
          x2={width}
          y1={path.zeroY}
          y2={path.zeroY}
          stroke="var(--color-border-subtle)"
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      ) : null}
      <path d={path.d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
