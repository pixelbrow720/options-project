import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Clock } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface CharmHeatmapProps {
  symbol: string;
  series: Array<{ ts: string; value: number }> | null;
  loading?: boolean;
  className?: string;
}

interface Row {
  ts: string;
  /** Minutes since midnight ET, used as the x-axis numeric value. */
  minute: number;
  /** Display label, e.g. "09:30". */
  label: string;
  value: number;
}

const VIOLET = "hsl(var(--violet))";

function toEtMinutes(iso: string): { minute: number; label: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Format in America/New_York to derive ET hours/minutes regardless of viewer TZ.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const minute = hh * 60 + mm;
  const label = `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
  return { minute, label };
}

function minuteToLabel(min: number): string {
  const hh = Math.floor(min / 60);
  const mm = Math.abs(min % 60);
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

interface TooltipEntry {
  payload?: Row;
  value?: number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
}

function ChartTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  const pctPerHour = row.value * 100;
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
      <div className="mt-0.5 font-mono tabular-nums text-[hsl(var(--violet))]">
        {pctPerHour >= 0 ? "+" : "−"}
        {Math.abs(pctPerHour).toFixed(3)}%/h
      </div>
    </div>
  );
}

export default function CharmHeatmap({
  symbol: _symbol,
  series,
  loading = false,
  className,
}: CharmHeatmapProps) {
  const reduce = useReducedMotion();

  const rows = useMemo<Row[]>(() => {
    if (!series || series.length === 0) return [];
    return series
      .map((p) => {
        const et = toEtMinutes(p.ts);
        if (!et) return null;
        return {
          ts: p.ts,
          minute: et.minute,
          label: et.label,
          value: p.value,
        } satisfies Row;
      })
      .filter((r): r is Row => r !== null)
      .sort((a, b) => a.minute - b.minute);
  }, [series]);

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
          Charm decay (0DTE)
        </div>
        <p
          className="mt-1 text-xs font-mono"
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          Theta-on-delta — accelerates after 14:00 ET on expiration day.
        </p>
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-[240px] w-full rounded-lg" />
          ) : hasData ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
                <defs>
                  <linearGradient id="charm-violet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIOLET} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={VIOLET} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="hsl(var(--border))"
                  strokeDasharray="2 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="minute"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => minuteToLabel(Number(v))}
                  tick={{
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  tickFormatter={(v) => `${(Number(v) * 100).toFixed(2)}%`}
                  tick={{
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                  stroke="hsl(var(--border))"
                  width={64}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
                  content={<ChartTooltip />}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={VIOLET}
                  strokeWidth={1.75}
                  fill="url(#charm-violet)"
                  isAnimationActive={false}
                />
                <ReferenceLine
                  x={9 * 60 + 30}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="3 3"
                  label={{
                    value: "open",
                    position: "insideTopLeft",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                />
                <ReferenceLine
                  x={14 * 60}
                  stroke="hsl(var(--violet))"
                  strokeDasharray="3 3"
                  label={{
                    value: "charm spike",
                    position: "insideTop",
                    fill: "hsl(var(--violet))",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                />
                <ReferenceLine
                  x={15 * 60 + 50}
                  stroke="hsl(var(--amber))"
                  strokeDasharray="3 3"
                  label={{
                    value: "MOC",
                    position: "insideTopRight",
                    fill: "hsl(var(--amber))",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex min-h-[240px] items-center justify-center">
              <EmptyState
                icon={<Clock />}
                headline="Charm series builds throughout the session."
                subline="Decay rate populates as the chain ticks across the day."
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
