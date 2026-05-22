import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BarChart3, Star } from "lucide-react";
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
import { decimalsFor, formatDollarsCompact, formatPrice } from "@/lib/format";

export interface AbsoluteGammaStrike {
  strike: number;
  abs_gamma: number;
  net_gamma: number;
}

interface AbsoluteGammaChartProps {
  symbol: string;
  spot: number | null;
  strikes: AbsoluteGammaStrike[] | null;
  topWalls: AbsoluteGammaStrike[] | null;
  loading?: boolean;
  className?: string;
}

const VIOLET = "hsl(var(--violet))";
const ROSE = "hsl(var(--rose))";

interface TooltipEntry {
  payload?: AbsoluteGammaStrike;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  decimals: number;
}

function ChartTooltip({ active, payload, decimals }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  const isPositive = row.net_gamma >= 0;
  return (
    <div
      className="liquid-glass-strong rounded-xl p-3 text-xs"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <div
        className="tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        Strike {formatPrice(row.strike, decimals)}
      </div>
      <div
        className="mt-0.5 font-semibold tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        |Γ| {formatDollarsCompact(row.abs_gamma, false)}
      </div>
      <div
        className={cn(
          "tabular-nums",
          isPositive ? "text-[hsl(var(--violet))]" : "text-[hsl(var(--rose))]",
        )}
      >
        Net Γ {formatDollarsCompact(row.net_gamma)}
      </div>
    </div>
  );
}

interface YTickProps {
  x?: number;
  y?: number;
  payload?: { value: number };
  decimals: number;
  walls: Set<number>;
}

function YTickLabel({ x = 0, y = 0, payload, decimals, walls }: YTickProps) {
  if (!payload) return null;
  const isWall = walls.has(payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      {isWall ? (
        <g transform="translate(-66, -7)">
          {/* Star icon rendered as inline SVG path so it sits cleanly next to the label */}
          <path
            d="M7 0.5 L8.7 4.7 L13.2 5.1 L9.7 8.1 L10.7 12.5 L7 10.1 L3.3 12.5 L4.3 8.1 L0.8 5.1 L5.3 4.7 Z"
            fill="hsl(var(--amber))"
            stroke="hsl(var(--amber))"
            strokeWidth={0.5}
            strokeLinejoin="round"
          />
        </g>
      ) : null}
      <text
        x={-8}
        y={4}
        textAnchor="end"
        fill={isWall ? "hsl(var(--amber))" : "var(--text-muted)"}
        fontFamily="var(--font-mono-foid)"
        fontSize={11}
        fontWeight={isWall ? 600 : 400}
      >
        {formatPrice(payload.value, decimals)}
      </text>
    </g>
  );
}

export function AbsoluteGammaChart({
  symbol,
  spot,
  strikes,
  topWalls,
  loading = false,
  className,
}: AbsoluteGammaChartProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);

  // Sort high → low so high strikes appear at top of vertical chart.
  const rows = useMemo<AbsoluteGammaStrike[]>(() => {
    if (!strikes || strikes.length === 0) return [];
    return strikes
      .filter((s) => Number.isFinite(s.abs_gamma) && s.abs_gamma > 0)
      .slice()
      .sort((a, b) => b.strike - a.strike);
  }, [strikes]);

  const hasData = rows.length > 0;

  // Set of top-wall strikes (top 5) for quick lookup.
  const wallSet = useMemo<Set<number>>(() => {
    const set = new Set<number>();
    if (topWalls && topWalls.length > 0) {
      for (const w of topWalls.slice(0, 5)) set.add(w.strike);
    } else if (rows.length > 0) {
      // Fall back to local top-5 by abs_gamma if no explicit walls were passed.
      const top = rows
        .slice()
        .sort((a, b) => b.abs_gamma - a.abs_gamma)
        .slice(0, 5);
      for (const w of top) set.add(w.strike);
    }
    return set;
  }, [topWalls, rows]);

  // Snap spot to nearest strike for ReferenceLine (category Y axis).
  const nearestSpotStrike = useMemo<number | null>(() => {
    if (spot === null || rows.length === 0) return null;
    let best = rows[0].strike;
    let bestDiff = Math.abs(rows[0].strike - spot);
    for (let i = 1; i < rows.length; i++) {
      const d = Math.abs(rows[i].strike - spot);
      if (d < bestDiff) {
        bestDiff = d;
        best = rows[i].strike;
      }
    }
    return best;
  }, [rows, spot]);

  const xMax = useMemo<number>(() => {
    if (!hasData) return 1;
    let max = 0;
    for (const r of rows) if (r.abs_gamma > max) max = r.abs_gamma;
    return max > 0 ? max * 1.05 : 1;
  }, [rows, hasData]);

  const ROW_HEIGHT = 18;
  const FIXED_HEIGHT = 400;
  const innerHeight = Math.max(FIXED_HEIGHT, rows.length * ROW_HEIGHT);
  const scrollable = rows.length * ROW_HEIGHT > FIXED_HEIGHT;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn("liquid-glass rounded-2xl p-5", className)}
    >
      <div className="flex flex-row items-baseline justify-between gap-3">
        <div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Absolute Gamma · 0DTE
          </div>
          <p
            className="mt-1.5 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            All gamma magnitude — these strikes are pinning forces.
          </p>
        </div>
        <div
          className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ fontFamily: "var(--font-mono-foid)" }}
        >
          <div
            className="inline-flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: VIOLET }}
              aria-hidden
            />
            Net +
          </div>
          <div
            className="inline-flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: ROSE }}
              aria-hidden
            />
            Net −
          </div>
          <div
            className="inline-flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <Star
              className="h-3 w-3 fill-[hsl(var(--amber))] text-[hsl(var(--amber))]"
              aria-hidden
            />
            Wall
          </div>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-[400px] w-full rounded-xl" />
        ) : hasData ? (
          <div
            className={cn(
              "w-full",
              scrollable && "scrollbar-thin max-h-[400px] overflow-y-auto",
            )}
          >
            <ResponsiveContainer width="100%" height={innerHeight}>
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 12, bottom: 6 }}
                barCategoryGap={1}
              >
                <CartesianGrid
                  stroke="var(--border-foid)"
                  strokeDasharray="2 4"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  domain={[0, xMax]}
                  tickFormatter={(v) => formatDollarsCompact(Number(v), false)}
                  tick={{
                    fill: "var(--text-muted)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono-foid)",
                  }}
                  stroke="var(--border-foid)"
                />
                <YAxis
                  dataKey="strike"
                  type="category"
                  interval={0}
                  tick={(props) => (
                    <YTickLabel {...props} decimals={dec} walls={wallSet} />
                  )}
                  stroke="var(--border-foid)"
                  width={84}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={<ChartTooltip decimals={dec} />}
                />
                {spot !== null && nearestSpotStrike !== null ? (
                  <ReferenceLine
                    y={nearestSpotStrike}
                    stroke="var(--text-primary)"
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={{
                      value: `SPOT ${formatPrice(spot, dec)}`,
                      position: "right",
                      fill: "var(--text-primary)",
                      fontSize: 10,
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  />
                ) : null}
                <Bar dataKey="abs_gamma" isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell
                      key={`abs-${r.strike}`}
                      fill={r.net_gamma >= 0 ? VIOLET : ROSE}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex min-h-[400px] items-center justify-center">
            <EmptyState
              icon={<BarChart3 />}
              headline="Gamma profile awaits chain data."
              subline="Per-strike absolute gamma populates as today's option chain settles."
              pad="md"
              inline
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default AbsoluteGammaChart;
