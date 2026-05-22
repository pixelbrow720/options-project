import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { GitCompare } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { decimalsFor, formatPrice } from "@/lib/format";

interface GammaFlipTrackerProps {
  symbol: string;
  spotSeries: Array<{ ts: string; value: number }> | null;
  flipSeries: Array<{ ts: string; value: number }> | null;
  loading?: boolean;
  className?: string;
}

interface Row {
  ts: string;
  /** Epoch ms; the x-axis numeric value. */
  t: number;
  label: string;
  spot: number | null;
  flip: number | null;
  /**
   * Stacked-band fields. Stacking in Recharts adds *increments*, so we encode
   * a transparent baseline at `min(spot, flip)` plus two visible deltas that
   * fill from that baseline to the higher of (spot, flip) — green when spot
   * is above flip, red when below.
   */
  bandBase: number;
  greenDelta: number;
  redDelta: number;
}

const CYAN = "hsl(var(--accent))";
const AMBER = "hsl(var(--amber))";
const EMERALD = "hsl(var(--emerald))";
const ROSE = "hsl(var(--rose))";

function fmtTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function buildRows(
  spotSeries: Array<{ ts: string; value: number }>,
  flipSeries: Array<{ ts: string; value: number }>,
): Row[] {
  // Index flip by ts for o(1) lookups; align on common timestamps if present,
  // otherwise carry-forward the most recent flip value at each spot tick.
  const flipByTs = new Map<string, number>();
  flipSeries.forEach((p) => flipByTs.set(p.ts, p.value));

  const sortedFlip = flipSeries
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  function flipAt(ts: string): number | null {
    if (flipByTs.has(ts)) return flipByTs.get(ts) as number;
    const t = new Date(ts).getTime();
    let last: number | null = null;
    for (const p of sortedFlip) {
      const pt = new Date(p.ts).getTime();
      if (pt <= t) last = p.value;
      else break;
    }
    return last;
  }

  return spotSeries
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .map<Row>((p) => {
      const t = new Date(p.ts).getTime();
      const spot = p.value;
      const flip = flipAt(p.ts);
      const haveBoth = flip !== null && spot !== null;
      const lo = haveBoth ? Math.min(spot, flip as number) : 0;
      const greenDelta =
        haveBoth && spot >= (flip as number) ? spot - (flip as number) : 0;
      const redDelta =
        haveBoth && spot < (flip as number) ? (flip as number) - spot : 0;
      return {
        ts: p.ts,
        t: Number.isFinite(t) ? t : 0,
        label: fmtTimeLabel(p.ts),
        spot,
        flip,
        bandBase: lo,
        greenDelta,
        redDelta,
      };
    });
}

interface TooltipEntry {
  payload?: Row;
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
  const regime =
    row.flip === null || row.spot === null
      ? null
      : row.spot >= row.flip
        ? "positive"
        : "negative";
  return (
    <div
      className="liquid-glass-strong rounded-md px-3 py-2 text-xs"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <div
        className="font-mono tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        {row.label} ET
      </div>
      <div className="mt-0.5 font-mono tabular-nums text-[hsl(var(--accent))]">
        Spot {row.spot !== null ? formatPrice(row.spot, decimals) : "—"}
      </div>
      <div className="font-mono tabular-nums text-[hsl(var(--amber))]">
        Flip {row.flip !== null ? formatPrice(row.flip, decimals) : "—"}
      </div>
      {regime ? (
        <div
          className={cn(
            "mt-0.5 font-mono text-[10px] uppercase tracking-wider",
            regime === "positive"
              ? "text-[hsl(var(--emerald))]"
              : "text-[hsl(var(--rose))]",
          )}
        >
          {regime} gamma
        </div>
      ) : null}
    </div>
  );
}

export default function GammaFlipTracker({
  symbol,
  spotSeries,
  flipSeries,
  loading = false,
  className,
}: GammaFlipTrackerProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);

  const rows = useMemo<Row[]>(() => {
    if (!spotSeries || spotSeries.length === 0) return [];
    return buildRows(spotSeries, flipSeries ?? []);
  }, [spotSeries, flipSeries]);

  const hasData = rows.length > 0;

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
          Gamma flip tracker
        </div>
        <p
          className="mt-1 text-xs font-mono"
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          Above flip — dealers hedge by selling rallies (mean revert). Below — they
          chase (trend day).
        </p>
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-[280px] w-full rounded-lg" />
          ) : hasData ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
                <defs>
                  <linearGradient id="flip-pos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={EMERALD} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={EMERALD} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="flip-neg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ROSE} stopOpacity={0.05} />
                    <stop offset="100%" stopColor={ROSE} stopOpacity={0.32} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="hsl(var(--border))"
                  strokeDasharray="2 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) =>
                    fmtTimeLabel(new Date(Number(v)).toISOString())
                  }
                  tick={{
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => formatPrice(Number(v), dec)}
                  tick={{
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                  stroke="hsl(var(--border))"
                  width={70}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
                  content={<ChartTooltip decimals={dec} />}
                />
                {/* Stacked-band trick: invisible baseline, then green / red deltas
                    fill from min(spot, flip) up to whichever is higher. */}
                <Area
                  type="monotone"
                  dataKey="bandBase"
                  stackId="band"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={false}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="greenDelta"
                  stackId="band"
                  stroke="none"
                  fill="url(#flip-pos)"
                  isAnimationActive={false}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="redDelta"
                  stackId="band"
                  stroke="none"
                  fill="url(#flip-neg)"
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="flip"
                  stroke={AMBER}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="spot"
                  stroke={CYAN}
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center">
              <EmptyState
                icon={<GitCompare />}
                headline="Spot vs flip series unavailable"
                subline="Once today's chain has computed, the spot path and zero-gamma flip will plot here together."
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
