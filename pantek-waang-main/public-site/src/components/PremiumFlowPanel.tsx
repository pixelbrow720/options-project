import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Waves } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatDollarsCompact,
  formatNumber,
  formatTimeShort,
} from "@/lib/format";

export interface PremiumFlowSeriesPoint {
  ts: string;
  call_prem: number;
  put_prem: number;
  net: number;
}

export interface PremiumFlowBlock {
  ts: string;
  size: number;
  premium: number;
  type: string;
  side: string;
  strike: number;
}

interface PremiumFlowPanelProps {
  symbol: string;
  cumulativeCallPremium: number;
  cumulativePutPremium: number;
  netPremium: number;
  series: PremiumFlowSeriesPoint[] | null;
  topBlocks: PremiumFlowBlock[] | null;
  loading?: boolean;
  className?: string;
}

interface ChartRow {
  ts: string;
  tsLabel: string;
  call_prem: number;
  // Stored as a negative number so it draws as an area below zero.
  put_prem_neg: number;
  net: number;
}

interface TooltipEntry {
  payload?: ChartRow;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

function ChartTooltip({ active, payload }: ChartTooltipProps) {
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
        {row.tsLabel}
      </div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 font-mono tabular-nums">
        <span className="text-[hsl(var(--emerald))]">Calls</span>
        <span className="text-right" style={{ color: "var(--text-primary)" }}>
          {formatDollarsCompact(row.call_prem, false)}
        </span>
        <span className="text-[hsl(var(--rose))]">Puts</span>
        <span className="text-right" style={{ color: "var(--text-primary)" }}>
          {formatDollarsCompact(Math.abs(row.put_prem_neg), false)}
        </span>
        <span
          className={cn(
            row.net >= 0 ? "text-[hsl(var(--emerald))]" : "text-[hsl(var(--rose))]",
          )}
        >
          Net
        </span>
        <span className="text-right" style={{ color: "var(--text-primary)" }}>
          {formatDollarsCompact(row.net)}
        </span>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative" | "muted";
}) {
  const accent =
    tone === "positive"
      ? "var(--accent-foid)"
      : tone === "negative"
        ? "var(--accent-put)"
        : "var(--text-primary)";
  return (
    <div className="liquid-glass rounded-2xl p-4">
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
        className="mt-1 tabular-nums"
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "1.75rem",
          color: accent,
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function netTone(value: number): "positive" | "negative" | "muted" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "muted";
}

export function PremiumFlowPanel({
  symbol,
  cumulativeCallPremium,
  cumulativePutPremium,
  netPremium,
  series,
  topBlocks,
  loading = false,
  className,
}: PremiumFlowPanelProps) {
  const reduce = useReducedMotion();

  const rows = useMemo<ChartRow[]>(() => {
    if (!series || series.length === 0) return [];
    return series.map((p) => ({
      ts: p.ts,
      tsLabel: formatTimeShort(p.ts),
      call_prem: p.call_prem,
      put_prem_neg: -Math.abs(p.put_prem),
      net: p.net,
    }));
  }, [series]);

  const hasChart = rows.length > 0;
  const blocks = topBlocks ?? [];
  const isEmpty = !hasChart && blocks.length === 0;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn(className)}
    >
      <div className="liquid-glass overflow-hidden rounded-2xl p-5 sm:p-6">
        <div className="flex flex-row items-baseline justify-between gap-3">
          <div>
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Premium flow
            </div>
            <p
              className="mt-1 text-xs font-mono"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Net dollars flowing into calls vs puts (intraday).
            </p>
          </div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.18em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {symbol}
          </div>
        </div>
        <div className="mt-4 space-y-4">
          {loading ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Skeleton className="h-[68px] w-full rounded-lg" />
                <Skeleton className="h-[68px] w-full rounded-lg" />
                <Skeleton className="h-[68px] w-full rounded-lg" />
              </div>
              <Skeleton className="h-[200px] w-full rounded-lg" />
              <Skeleton className="h-[120px] w-full rounded-lg" />
            </>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <StatCell
                  label="Calls"
                  value={formatCurrency(cumulativeCallPremium)}
                  tone="positive"
                />
                <StatCell
                  label="Puts"
                  value={formatCurrency(cumulativePutPremium)}
                  tone="negative"
                />
                <StatCell
                  label="Net"
                  value={formatDollarsCompact(netPremium)}
                  tone={netTone(netPremium)}
                />
              </div>

              {isEmpty ? (
                <EmptyState
                  icon={<Waves />}
                  headline="Awaiting flow"
                  subline="Flow events build during RTH. Quiet so far."
                  pad="md"
                  inline
                />
              ) : (
                <>
                  {hasChart ? (
                    <div style={{ height: 200 }} className="w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={rows}
                          margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                          stackOffset="sign"
                        >
                          <defs>
                            <linearGradient id="prem-call" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="0%"
                                stopColor="hsl(var(--emerald))"
                                stopOpacity={0.55}
                              />
                              <stop
                                offset="100%"
                                stopColor="hsl(var(--emerald))"
                                stopOpacity={0.05}
                              />
                            </linearGradient>
                            <linearGradient id="prem-put" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="0%"
                                stopColor="hsl(var(--rose))"
                                stopOpacity={0.05}
                              />
                              <stop
                                offset="100%"
                                stopColor="hsl(var(--rose))"
                                stopOpacity={0.55}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            stroke="hsl(var(--border))"
                            strokeDasharray="2 4"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="tsLabel"
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                              fontFamily:
                                "JetBrains Mono, ui-monospace, monospace",
                            }}
                            stroke="hsl(var(--border))"
                            minTickGap={32}
                          />
                          <YAxis
                            tickFormatter={(v) =>
                              formatDollarsCompact(Number(v), false)
                            }
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                              fontFamily:
                                "JetBrains Mono, ui-monospace, monospace",
                            }}
                            stroke="hsl(var(--border))"
                            width={70}
                          />
                          <Tooltip
                            cursor={{
                              stroke: "hsl(var(--muted-foreground))",
                              strokeDasharray: "3 3",
                            }}
                            content={<ChartTooltip />}
                          />
                          <ReferenceLine y={0} stroke="hsl(var(--border))" />
                          <Area
                            type="monotone"
                            dataKey="call_prem"
                            stackId="flow"
                            stroke="hsl(var(--emerald))"
                            strokeWidth={1.5}
                            fill="url(#prem-call)"
                            isAnimationActive={false}
                          />
                          <Area
                            type="monotone"
                            dataKey="put_prem_neg"
                            stackId="flow"
                            stroke="hsl(var(--rose))"
                            strokeWidth={1.5}
                            fill="url(#prem-put)"
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="net"
                            stroke="hsl(var(--foreground))"
                            strokeWidth={1.75}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}

                  {blocks.length > 0 ? (
                    <div
                      className="rounded-2xl"
                      style={{ border: "1px solid var(--border-foid)" }}
                    >
                      <div
                        className="px-3 py-2 text-[10px] font-mono uppercase tracking-[0.2em]"
                        style={{
                          color: "var(--text-secondary)",
                          fontFamily: "var(--font-mono-foid)",
                          borderBottom: "1px solid var(--border-foid)",
                        }}
                      >
                        Top block trades
                      </div>
                      <ul>
                        {blocks.slice(0, 5).map((b, idx) => {
                          const isCall =
                            b.type.toUpperCase().startsWith("C") ||
                            b.type.toUpperCase() === "CALL";
                          return (
                            <li
                              key={`${b.ts}-${b.strike}-${idx}`}
                              className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                              style={
                                idx > 0
                                  ? { borderTop: "1px solid var(--border-foid)" }
                                  : undefined
                              }
                            >
                              <div
                                className="flex items-center gap-2 font-mono tabular-nums"
                                style={{ fontFamily: "var(--font-mono-foid)" }}
                              >
                                <span style={{ color: "var(--text-muted)" }}>
                                  {formatTimeShort(b.ts)}
                                </span>
                                <span style={{ color: "var(--text-muted)" }}>·</span>
                                <span style={{ color: "var(--text-primary)" }}>
                                  {formatNumber(b.size)}
                                </span>
                                <span style={{ color: "var(--text-muted)" }}>
                                  {symbol}
                                </span>
                                <span
                                  className={cn(
                                    isCall
                                      ? "text-[hsl(var(--emerald))]"
                                      : "text-[hsl(var(--rose))]",
                                  )}
                                >
                                  {isCall ? "C" : "P"}
                                </span>
                                <span style={{ color: "var(--text-primary)" }}>
                                  {formatNumber(b.strike)}
                                </span>
                              </div>
                              <div
                                className="flex items-center gap-2 font-mono tabular-nums"
                                style={{ fontFamily: "var(--font-mono-foid)" }}
                              >
                                <span style={{ color: "var(--text-primary)" }}>
                                  {formatCurrency(b.premium)}
                                </span>
                                <span
                                  className="liquid-glass rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]"
                                  style={{ color: "var(--text-secondary)" }}
                                >
                                  {b.side}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default PremiumFlowPanel;
