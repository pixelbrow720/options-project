import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Layers } from "lucide-react";
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

type Side = "long" | "short" | "neutral";

interface StrikeRow {
  strike: number;
  dealer_gamma: number;
  side: Side;
}

interface DealerPositioningProps {
  symbol: string;
  spot: number | null;
  strikes: Array<StrikeRow> | null;
  loading?: boolean;
  className?: string;
}

const VIOLET = "hsl(var(--violet))";
const ROSE = "hsl(var(--rose))";
const NEUTRAL = "hsl(var(--muted-foreground))";

const SIDE_LABEL: Record<Side, string> = {
  long: "Long",
  short: "Short",
  neutral: "Neutral",
};

function colorForSide(side: Side): string {
  if (side === "long") return VIOLET;
  if (side === "short") return ROSE;
  return NEUTRAL;
}

interface TooltipEntry {
  payload?: StrikeRow;
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
  return (
    <div
      className="liquid-glass-strong rounded-md px-3 py-2 text-xs"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <div
        className="font-mono tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        Strike {formatPrice(row.strike, decimals)}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono tabular-nums",
          row.side === "long"
            ? "text-[hsl(var(--violet))]"
            : row.side === "short"
              ? "text-[hsl(var(--rose))]"
              : "text-muted-foreground",
        )}
      >
        Dealer {formatDollarsCompact(row.dealer_gamma)} · {SIDE_LABEL[row.side]}
      </div>
    </div>
  );
}

export default function DealerPositioning({
  symbol,
  spot,
  strikes,
  loading = false,
  className,
}: DealerPositioningProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);

  const rows = useMemo<StrikeRow[]>(() => {
    if (!strikes || strikes.length === 0) return [];
    if (spot === null || spot === 0) {
      return strikes.slice().sort((a, b) => a.strike - b.strike);
    }
    const lo = spot * 0.95;
    const hi = spot * 1.05;
    return strikes
      .filter((s) => s.strike >= lo && s.strike <= hi)
      .slice()
      .sort((a, b) => a.strike - b.strike);
  }, [strikes, spot]);

  const hasData = rows.length > 0;

  // Category Y axis only renders ReferenceLines that match a category exactly,
  // so snap to the nearest strike when spot lands between rungs.
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

  // Symmetric x-domain so the zero line is centered.
  const xDomain = useMemo<[number, number]>(() => {
    if (!hasData) return [-1, 1];
    let max = 0;
    for (const r of rows) {
      const a = Math.abs(r.dealer_gamma);
      if (a > max) max = a;
    }
    if (max === 0) return [-1, 1];
    const padded = max * 1.05;
    return [-padded, padded];
  }, [rows, hasData]);

  // Estimate height: ~22px per strike, clamped between 360 and a scrollable cap.
  const ROW_HEIGHT = 22;
  const innerHeight = Math.max(360, rows.length * ROW_HEIGHT);
  const scrollable = rows.length > 40;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className={cn("liquid-glass rounded-2xl p-5 sm:p-6", className)}>
        <div
          className="text-[10px] font-mono uppercase tracking-[0.2em]"
          style={{
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          Dealer positioning
        </div>
        <p
          className="mt-1 text-xs font-mono"
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          Long gamma (right) → dealers hedge by buying dips. Short gamma (left) → they
          sell rallies.
        </p>
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-[360px] w-full rounded-lg" />
          ) : hasData ? (
            <div
              className={cn(
                "w-full",
                scrollable && "scrollbar-thin max-h-[480px] overflow-y-auto",
              )}
            >
              <ResponsiveContainer width="100%" height={innerHeight}>
                <BarChart
                  data={rows}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 6 }}
                  barCategoryGap={2}
                >
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeDasharray="2 4"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    domain={xDomain}
                    tickFormatter={(v) => formatDollarsCompact(Number(v), false)}
                    tick={{
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 11,
                      fontFamily: "JetBrains Mono, ui-monospace, monospace",
                    }}
                    stroke="hsl(var(--border))"
                  />
                  <YAxis
                    dataKey="strike"
                    type="category"
                    reversed
                    tickFormatter={(v) => formatPrice(Number(v), dec)}
                    tick={{
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 11,
                      fontFamily: "JetBrains Mono, ui-monospace, monospace",
                    }}
                    stroke="hsl(var(--border))"
                    width={72}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    content={<ChartTooltip decimals={dec} />}
                  />
                  <ReferenceLine x={0} stroke="hsl(var(--border))" />
                  {spot !== null && nearestSpotStrike !== null ? (
                    <ReferenceLine
                      y={nearestSpotStrike}
                      stroke="hsl(var(--foreground))"
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                      label={{
                        value: `spot ${formatPrice(spot, dec)}`,
                        position: "right",
                        fill: "hsl(var(--foreground))",
                        fontSize: 10,
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                      }}
                    />
                  ) : null}
                  <Bar dataKey="dealer_gamma" isAnimationActive={false}>
                    {rows.map((r) => (
                      <Cell
                        key={`${r.strike}`}
                        fill={colorForSide(r.side)}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center">
              <EmptyState
                icon={<Layers />}
                headline="Dealer positioning loading..."
                subline="Per-strike dealer gamma populates as the chain ticks."
                pad="md"
                inline
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
