import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { formatDollarsCompact, formatTimeShort } from "@/lib/format";

export interface HiroPoint {
  ts: string;
  cumulative: number;
  call_premium?: number;
  put_premium?: number;
  net_signed?: number;
}

export interface HiroChartProps {
  symbol: string;
  series: HiroPoint[] | null;
  currentCumulative: number;
  currentSigned: number;
  trend: "bullish" | "bearish" | "neutral";
  loading?: boolean;
  className?: string;
}

interface ChartRow {
  ts: string;
  tsLabel: string;
  cumulative: number;
  positive: number | null;
  negative: number | null;
  net_signed: number;
  call_premium: number;
  put_premium: number;
}

interface TooltipEntry {
  payload?: ChartRow;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
}

function ChartTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  const positive = row.cumulative >= 0;
  return (
    <div
      className="liquid-glass-strong rounded-xl p-3 text-xs"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <div
        className="tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        {row.tsLabel}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          positive
            ? "text-[hsl(var(--emerald))]"
            : "text-[hsl(var(--rose))]",
        )}
      >
        Cum {formatDollarsCompact(row.cumulative)}
      </div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span
          className={cn(
            row.net_signed >= 0
              ? "text-[hsl(var(--emerald))]"
              : "text-[hsl(var(--rose))]",
          )}
        >
          Net
        </span>
        <span
          className="text-right"
          style={{ color: "var(--text-primary)" }}
        >
          {formatDollarsCompact(row.net_signed)}
        </span>
        {row.call_premium !== 0 ? (
          <>
            <span className="text-[hsl(var(--emerald))]">Calls</span>
            <span
              className="text-right"
              style={{ color: "var(--text-primary)" }}
            >
              {formatDollarsCompact(row.call_premium, false)}
            </span>
          </>
        ) : null}
        {row.put_premium !== 0 ? (
          <>
            <span className="text-[hsl(var(--rose))]">Puts</span>
            <span
              className="text-right"
              style={{ color: "var(--text-primary)" }}
            >
              {formatDollarsCompact(row.put_premium, false)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface TrendChipProps {
  trend: "bullish" | "bearish" | "neutral";
  size?: "sm" | "lg";
}

function trendTone(trend: "bullish" | "bearish" | "neutral"): {
  text: string;
  label: string;
} {
  if (trend === "bullish") {
    return {
      text: "text-[hsl(var(--emerald))]",
      label: "Bullish",
    };
  }
  if (trend === "bearish") {
    return {
      text: "text-[hsl(var(--rose))]",
      label: "Bearish",
    };
  }
  return {
    text: "",
    label: "Neutral",
  };
}

function TrendChip({ trend, size = "sm" }: TrendChipProps) {
  const tone = trendTone(trend);
  const Icon =
    trend === "bullish"
      ? ArrowUpRight
      : trend === "bearish"
        ? ArrowDownRight
        : Minus;
  return (
    <span
      className={cn(
        "liquid-glass inline-flex items-center gap-1.5 rounded-full font-mono uppercase",
        size === "lg"
          ? "px-3 py-1 text-[11px] tracking-[0.18em]"
          : "px-2.5 py-0.5 text-[10px] tracking-[0.18em]",
        tone.text,
      )}
      style={{
        fontFamily: "var(--font-mono-foid)",
        color: trend === "neutral" ? "var(--text-secondary)" : undefined,
      }}
    >
      <Icon className={cn(size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3")} />
      {tone.label}
    </span>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  tone: "bullish" | "bearish" | "neutral";
  trail?: React.ReactNode;
}

function StatTile({ label, value, tone, trail }: StatTileProps) {
  const t = trendTone(tone);
  return (
    <div className="liquid-glass rounded-xl p-3">
      <div
        className="text-[10px] font-mono uppercase tracking-[0.2em]"
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-mono font-semibold tabular-nums",
          t.text,
        )}
        style={{
          fontFamily: "var(--font-mono-foid)",
          color: tone === "neutral" ? "var(--text-primary)" : undefined,
        }}
      >
        {value}
      </div>
      {trail ? <div className="mt-1.5">{trail}</div> : null}
    </div>
  );
}

function inferTone(value: number): "bullish" | "bearish" | "neutral" {
  if (value > 0) return "bullish";
  if (value < 0) return "bearish";
  return "neutral";
}

function HiroChartImpl({
  symbol,
  series,
  currentCumulative,
  currentSigned,
  trend,
  loading = false,
  className,
}: HiroChartProps) {
  const reduce = useReducedMotion();

  const rows = useMemo<ChartRow[]>(() => {
    if (!series || series.length === 0) return [];
    return series.map((p) => ({
      ts: p.ts,
      tsLabel: formatTimeShort(p.ts),
      cumulative: p.cumulative,
      positive: p.cumulative >= 0 ? p.cumulative : null,
      negative: p.cumulative < 0 ? p.cumulative : null,
      net_signed: p.net_signed ?? 0,
      call_premium: p.call_premium ?? 0,
      put_premium: p.put_premium ?? 0,
    }));
  }, [series]);

  const hasData = rows.length > 0;

  const lastBucketTone = inferTone(currentSigned);
  const cumulativeTone = inferTone(currentCumulative);
  const headlineColor =
    trend === "bullish"
      ? "hsl(var(--emerald))"
      : trend === "bearish"
        ? "hsl(var(--rose))"
        : "var(--text-primary)";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn("liquid-glass-strong rounded-3xl p-6 sm:p-7", className)}
    >
      <div className="space-y-4">
        <div className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-mono uppercase tracking-[0.2em]"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                HIRO · Cumulative flow
              </span>
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
            <p
              className="mt-1.5 text-xs font-mono"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Hi-Resolution Order flow · Aggressive call vs put premium
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className="tabular-nums leading-none"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "clamp(2rem, 5vw, 3.5rem)",
                color: headlineColor,
              }}
            >
              {formatDollarsCompact(currentCumulative)}
            </span>
            <TrendChip trend={trend} size="lg" />
          </div>
        </div>

        {loading ? (
          <>
            <Skeleton className="h-[320px] w-full rounded-2xl" />
            <div className="grid gap-2 sm:grid-cols-3">
              <Skeleton className="h-[78px] w-full rounded-xl" />
              <Skeleton className="h-[78px] w-full rounded-xl" />
              <Skeleton className="h-[78px] w-full rounded-xl" />
            </div>
          </>
        ) : hasData ? (
          <>
            <div style={{ height: 320 }} className="w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rows}
                  margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="hiro-pos" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="hsl(var(--emerald))"
                        stopOpacity={0.6}
                      />
                      <stop
                        offset="100%"
                        stopColor="hsl(var(--emerald))"
                        stopOpacity={0.04}
                      />
                    </linearGradient>
                    <linearGradient id="hiro-neg" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="hsl(var(--rose))"
                        stopOpacity={0.04}
                      />
                      <stop
                        offset="100%"
                        stopColor="hsl(var(--rose))"
                        stopOpacity={0.6}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="var(--border-foid)"
                    strokeDasharray="2 4"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="tsLabel"
                    tick={{
                      fill: "var(--text-muted)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono-foid)",
                    }}
                    stroke="var(--border-foid)"
                    minTickGap={32}
                  />
                  <YAxis
                    tickFormatter={(v) =>
                      formatDollarsCompact(Number(v), false)
                    }
                    tick={{
                      fill: "var(--text-muted)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono-foid)",
                    }}
                    stroke="var(--border-foid)"
                    width={70}
                  />
                  <Tooltip
                    cursor={{
                      stroke: "var(--text-muted)",
                      strokeDasharray: "3 3",
                    }}
                    content={<ChartTooltip />}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="var(--border-foid-strong)"
                    strokeWidth={1}
                  />
                  <Area
                    type="monotone"
                    dataKey="positive"
                    stroke="hsl(var(--emerald))"
                    strokeWidth={1.75}
                    fill="url(#hiro-pos)"
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="negative"
                    stroke="hsl(var(--rose))"
                    strokeWidth={1.75}
                    fill="url(#hiro-neg)"
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <StatTile
                label="Current"
                value={formatDollarsCompact(currentCumulative)}
                tone={cumulativeTone}
                trail={<TrendChip trend={trend} />}
              />
              <StatTile
                label="Last bucket"
                value={formatDollarsCompact(currentSigned)}
                tone={lastBucketTone}
                trail={
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                      lastBucketTone === "bullish"
                        ? "text-[hsl(var(--emerald))]"
                        : lastBucketTone === "bearish"
                          ? "text-[hsl(var(--rose))]"
                          : "",
                    )}
                    style={{
                      fontFamily: "var(--font-mono-foid)",
                      color:
                        lastBucketTone === "neutral"
                          ? "var(--text-muted)"
                          : undefined,
                    }}
                  >
                    {lastBucketTone === "bullish" ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : lastBucketTone === "bearish" ? (
                      <ArrowDownRight className="h-3 w-3" />
                    ) : (
                      <Minus className="h-3 w-3" />
                    )}
                    Net signed
                  </span>
                }
              />
              <StatTile
                label="Trend"
                value={trendTone(trend).label}
                tone={trend}
                trail={
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.18em]"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  >
                    {trend === "bullish"
                      ? "Calls overwhelming puts"
                      : trend === "bearish"
                        ? "Puts overwhelming calls"
                        : "Balanced flow"}
                  </span>
                }
              />
            </div>
          </>
        ) : (
          <div
            style={{ minHeight: 320 }}
            className="flex items-center justify-center"
          >
            <EmptyState
              icon={<Activity />}
              headline="Flow series builds during RTH."
              subline="HIRO accumulates aggressive call and put premium tick by tick. Check back during the session."
              pad="md"
              inline
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const HiroChart = memo(HiroChartImpl);

export default HiroChart;
