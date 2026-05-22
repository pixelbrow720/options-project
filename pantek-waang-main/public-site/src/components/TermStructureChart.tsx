import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export interface TermPoint {
  dte: number;
  iv: number;
  expiry: string;
}

export interface TermStructureChartProps {
  symbol: string;
  points: TermPoint[] | null;
  isInverted: boolean;
  frontBackSpread: number | null;
  loading?: boolean;
}

interface TermTooltipPayload {
  payload?: TermPoint;
}

interface TermTooltipProps {
  active?: boolean;
  payload?: TermTooltipPayload[];
}

function TermTooltip({ active, payload }: TermTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div
      className="liquid-glass-strong rounded-xl p-3 text-xs"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <div
        className="uppercase tracking-[0.18em]"
        style={{ color: "var(--text-muted)" }}
      >
        {row.dte === 0 ? "0DTE" : `${row.dte}D`}
      </div>
      <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {row.expiry}
      </div>
      <div
        className="mt-1 font-semibold tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        IV {(row.iv * 100).toFixed(2)}%
      </div>
    </div>
  );
}

function formatVolPts(value: number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

/**
 * Term structure: ATM IV plotted by days-to-expiry. Upward sloping = contango
 * (normal). Downward sloping = backwardation / inverted = stress signal.
 */
export function TermStructureChart({
  symbol: _symbol,
  points,
  isInverted,
  frontBackSpread,
  loading = false,
}: TermStructureChartProps) {
  const reduce = useReducedMotion();

  const rows = useMemo<TermPoint[]>(() => {
    if (!points) return [];
    return points.slice().sort((a, b) => a.dte - b.dte);
  }, [points]);

  const hasData = rows.length > 1;
  const front = rows[0] ?? null;

  const lineColor = isInverted ? "hsl(var(--amber))" : "hsl(var(--accent))";
  const dotFill = isInverted ? "hsl(var(--amber))" : "hsl(var(--accent))";

  const badgeColor = isInverted
    ? "hsl(var(--amber))"
    : "var(--text-secondary)";
  const badgeLabel = isInverted ? "Inverted · stress" : "Contango";

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
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Vol Term Structure
          </div>
          <p
            className="mt-1.5 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
            title="ATM IV by days-to-expiry — normal = upward sloping (contango)"
          >
            ATM IV by days-to-expiry · normal = upward sloping
          </p>
        </div>
        {hasData ? (
          <span
            className="liquid-glass rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{
              color: badgeColor,
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {badgeLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-[220px] w-full rounded-xl" />
        ) : hasData ? (
          <div className="space-y-2">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart
                data={rows}
                margin={{ top: 14, right: 16, left: 0, bottom: 6 }}
              >
                <CartesianGrid
                  stroke="var(--border-foid)"
                  strokeDasharray="2 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="dte"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => (Number(v) === 0 ? "0DTE" : `${v}D`)}
                  tick={{
                    fill: "var(--text-muted)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono-foid)",
                  }}
                  stroke="var(--border-foid)"
                />
                <YAxis
                  tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                  tick={{
                    fill: "var(--text-muted)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono-foid)",
                  }}
                  stroke="var(--border-foid)"
                  width={48}
                />
                <Tooltip
                  cursor={{
                    stroke: "var(--text-muted)",
                    strokeDasharray: "3 3",
                  }}
                  content={<TermTooltip />}
                />
                <Line
                  type="monotone"
                  dataKey="iv"
                  stroke={lineColor}
                  strokeWidth={2}
                  isAnimationActive={!reduce}
                  dot={{ r: 3, fill: dotFill, stroke: dotFill, strokeWidth: 1 }}
                  activeDot={{ r: 5, fill: dotFill }}
                />
                {front ? (
                  <ReferenceDot
                    x={front.dte}
                    y={front.iv}
                    r={5}
                    fill={dotFill}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                    ifOverflow="extendDomain"
                    label={{
                      value: "0DTE",
                      position: "top",
                      fill: "var(--text-primary)",
                      fontSize: 10,
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
            <div
              className="flex items-center justify-between pt-2 font-mono text-[11px] tabular-nums"
              style={{
                borderTop: "1px solid var(--border-foid)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              <span
                className="uppercase tracking-[0.18em]"
                style={{ color: "var(--text-muted)" }}
              >
                0DTE − 30D
              </span>
              <span
                className="font-semibold"
                style={{
                  color:
                    frontBackSpread === null || frontBackSpread === undefined
                      ? "var(--text-muted)"
                      : frontBackSpread > 0
                        ? "hsl(var(--amber))"
                        : "hsl(var(--accent))",
                }}
              >
                {formatVolPts(frontBackSpread)} vol pts
              </span>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center">
            <EmptyState
              icon={<TrendingUp />}
              headline="Term structure builds when chain populates."
              subline="ATM IV across expiries appears once the chain has fitted IVs along the curve."
              pad="md"
              inline
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default TermStructureChart;
