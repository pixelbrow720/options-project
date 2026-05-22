import { useMemo } from "react";

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "hsl(var(--brand-primary))",
  className,
}: Props) {
  const path = useMemo(() => {
    if (data.length === 0) return "";
    const finite = data.filter((d) => Number.isFinite(d));
    if (finite.length === 0) return "";
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    return data
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * height;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
