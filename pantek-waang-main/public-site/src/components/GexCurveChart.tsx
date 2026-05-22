import { useMemo } from "react";
import { LineChart as LineChartIcon } from "lucide-react";
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
import { decimalsFor, formatDollarsCompact, formatPrice } from "@/lib/format";
import type { GexPayload } from "@/lib/api";

interface GexCurveChartProps {
  symbol: string;
  title: string;
  subtitle?: string;
  data: GexPayload | null | undefined;
  spot: number | null;
  zeroGamma?: number | null;
  height?: number;
  variant?: "primary" | "secondary";
  className?: string;
  /** When true, render skeleton placeholder instead of empty state. */
  loading?: boolean;
}

interface ChartRow {
  strike: number;
  positive: number | null;
  negative: number | null;
  net: number;
}

function buildRows(curve: GexPayload["curve"]): ChartRow[] {
  return curve
    .slice()
    .sort((a, b) => a.strike - b.strike)
    .map((pt) => ({
      strike: pt.strike,
      positive: pt.net_gex >= 0 ? pt.net_gex : null,
      negative: pt.net_gex < 0 ? pt.net_gex : null,
      net: pt.net_gex,
    }));
}

interface TooltipPayloadEntry {
  payload?: ChartRow;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: number | string;
  decimals: number;
}

function ChartTooltip({ active, payload, label, decimals }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  return (
    <div
      className="liquid-glass-strong rounded-md px-3 py-2 text-xs"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <div
        className="font-mono tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        Strike {formatPrice(typeof label === "number" ? label : row.strike, decimals)}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono tabular-nums",
          row.net >= 0
            ? "text-[hsl(var(--emerald))]"
            : "text-[hsl(var(--rose))]",
        )}
      >
        Net GEX {formatDollarsCompact(row.net)}
      </div>
    </div>
  );
}

export function GexCurveChart({
  symbol,
  title,
  subtitle,
  data,
  spot,
  zeroGamma,
  height = 280,
  variant = "primary",
  className,
  loading = false,
}: GexCurveChartProps) {
  const dec = decimalsFor(symbol);

  const rows = useMemo<ChartRow[]>(() => {
    if (!data || !data.curve || data.curve.length === 0) return [];
    return buildRows(data.curve);
  }, [data]);

  const hasData = rows.length > 0;
  const positiveColor = "hsl(var(--emerald))";
  const negativeColor = "hsl(var(--rose))";

  return (
    <div className={cn("liquid-glass rounded-2xl p-5 sm:p-6", className)}>
      <div className="flex flex-row items-baseline justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <p
              className="mt-1 text-xs font-mono"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {hasData && data?.net_total !== undefined ? (
          <div className="text-right">
            <div
              className="text-[10px] font-mono uppercase tracking-[0.18em]"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Net total
            </div>
            <div
              className="tabular-nums"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "1.5rem",
                color:
                  data.net_total >= 0
                    ? "var(--accent-foid)"
                    : "var(--accent-put)",
                lineHeight: 1.1,
              }}
            >
              {formatDollarsCompact(data.net_total)}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-4">
        {loading ? (
          <Skeleton style={{ height }} className="w-full rounded-lg" />
        ) : hasData ? (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
              <defs>
                <linearGradient id={`${variant}-pos`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positiveColor} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={positiveColor} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id={`${variant}-neg`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={negativeColor} stopOpacity={0.05} />
                  <stop offset="100%" stopColor={negativeColor} stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="strike"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatPrice(Number(v), dec)}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "JetBrains Mono, ui-monospace, monospace" }}
                stroke="hsl(var(--border))"
              />
              <YAxis
                tickFormatter={(v) => formatDollarsCompact(Number(v), false)}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "JetBrains Mono, ui-monospace, monospace" }}
                stroke="hsl(var(--border))"
                width={70}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
                content={<ChartTooltip decimals={dec} />}
              />
              <Area
                type="monotone"
                dataKey="positive"
                stroke={positiveColor}
                strokeWidth={1.5}
                fill={`url(#${variant}-pos)`}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="negative"
                stroke={negativeColor}
                strokeWidth={1.5}
                fill={`url(#${variant}-neg)`}
                isAnimationActive={false}
                connectNulls={false}
              />
              {spot !== null ? (
                <ReferenceLine
                  x={spot}
                  stroke="hsl(var(--foreground))"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: `Spot ${formatPrice(spot, dec)}`,
                    position: "top",
                    fill: "hsl(var(--foreground))",
                    fontSize: 11,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                />
              ) : null}
              {typeof zeroGamma === "number" && zeroGamma !== null ? (
                <ReferenceLine
                  x={zeroGamma}
                  stroke="hsl(var(--violet))"
                  strokeDasharray="2 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: `Zero Γ`,
                    position: "insideTop",
                    fill: "hsl(var(--violet))",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                />
              ) : null}
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ minHeight: height }} className="flex items-center justify-center">
            <EmptyState
              icon={<LineChartIcon />}
              headline="GEX curve will appear here"
              subline="Once today's chain has computed, you'll see the dealer net gamma curve build out across the strikes."
              pad="md"
              inline
            />
          </div>
        )}
      </div>
    </div>
  );
}
