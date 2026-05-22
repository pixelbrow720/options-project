import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export interface SkewByExpiry {
  expiry: string;
  skew: number;
  label: string;
}

export interface SkewChartProps {
  symbol: string;
  byExpiry: SkewByExpiry[] | null;
  current25dRr: number | null;
  loading?: boolean;
}

interface SkewTooltipPayload {
  payload?: SkewByExpiry;
  value?: number;
}

interface SkewTooltipProps {
  active?: boolean;
  payload?: SkewTooltipPayload[];
}

function SkewTooltip({ active, payload }: SkewTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const tone =
    row.skew < 0 ? "text-[hsl(var(--rose))]" : "text-[hsl(var(--emerald))]";
  return (
    <div
      className="liquid-glass-strong rounded-xl p-3 text-xs"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <div
        className="uppercase tracking-[0.18em]"
        style={{ color: "var(--text-muted)" }}
      >
        {row.label}
      </div>
      <div
        className="mt-0.5 text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        {row.expiry}
      </div>
      <div className={cn("mt-1 font-semibold tabular-nums", tone)}>
        {row.skew >= 0 ? "+" : ""}
        {row.skew.toFixed(3)} vol
      </div>
    </div>
  );
}

function formatSkew(value: number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

/**
 * IV skew across the term curve. Negative skew = puts richer than calls (fear);
 * positive skew = calls richer (euphoria / chase).
 */
export function SkewChart({
  symbol: _symbol,
  byExpiry,
  current25dRr,
  loading = false,
}: SkewChartProps) {
  const reduce = useReducedMotion();

  const rows = useMemo<SkewByExpiry[]>(() => {
    if (!byExpiry) return [];
    return byExpiry.slice();
  }, [byExpiry]);

  const hasData = rows.length > 0;
  const negColor = "hsl(var(--rose))";
  const posColor = "hsl(var(--emerald))";

  const rrColor =
    current25dRr === null || current25dRr === undefined
      ? "var(--text-muted)"
      : current25dRr < 0
        ? "hsl(var(--rose))"
        : "hsl(var(--emerald))";

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
            IV Skew · Term
          </div>
          <p
            className="mt-1.5 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Put-call IV differential across expiries
          </p>
        </div>
        <div className="liquid-glass rounded-xl px-3 py-2 text-right">
          <div
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            25Δ Risk Reversal
          </div>
          <div
            className="mt-0.5 font-mono text-base font-semibold tabular-nums"
            style={{ color: rrColor, fontFamily: "var(--font-mono-foid)" }}
          >
            {formatSkew(current25dRr)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-[240px] w-full rounded-xl" />
        ) : hasData ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={rows}
                margin={{ top: 10, right: 12, left: 0, bottom: 6 }}
              >
                <CartesianGrid
                  stroke="var(--border-foid)"
                  strokeDasharray="2 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{
                    fill: "var(--text-muted)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono-foid)",
                  }}
                  stroke="var(--border-foid)"
                />
                <YAxis
                  tickFormatter={(v) => formatSkew(Number(v), 2)}
                  tick={{
                    fill: "var(--text-muted)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono-foid)",
                  }}
                  stroke="var(--border-foid)"
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={<SkewTooltip />}
                />
                <ReferenceLine y={0} stroke="var(--border-foid-strong)" />
                <Bar
                  dataKey="skew"
                  isAnimationActive={!reduce}
                  radius={[2, 2, 0, 0]}
                >
                  {rows.map((row) => (
                    <Cell
                      key={row.expiry}
                      fill={row.skew < 0 ? negColor : posColor}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div
              className="hidden flex-col justify-center gap-3 pl-4 text-xs lg:flex"
              style={{
                borderLeft: "1px solid var(--border-foid)",
              }}
            >
              <div>
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.2em]"
                  style={{
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Read
                </div>
                <div
                  className="mt-1 font-mono leading-relaxed"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  <span className="text-[hsl(var(--rose))]">Negative</span>{" "}
                  bars: puts richer than calls — fear pricing.
                </div>
                <div
                  className="mt-1 font-mono leading-relaxed"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  <span className="text-[hsl(var(--emerald))]">Positive</span>{" "}
                  bars: calls richer — chase pricing.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[240px] items-center justify-center">
            <EmptyState
              icon={<Activity />}
              headline="Skew calculation pending."
              subline="Skew populates once both call and put IVs are available across the term curve."
              pad="md"
              inline
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default SkewChart;
