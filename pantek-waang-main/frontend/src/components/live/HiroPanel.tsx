/**
 * HiroPanel V2 — SpotGamma four-line breakdown.
 *
 * Renders the canonical HIRO chart per the spec:
 *   - Total / Purple   = net dealer hedge pressure
 *   - Calls / Orange   = call-only contribution
 *   - Puts / Blue      = put-only contribution
 *   - 0DTE / Green     = next-expiry isolated
 *
 * Prefers the ``*_delta_notional`` fields (canonical SpotGamma path) and
 * falls back to ``*_premium`` when delta wasn't available at compute time.
 * The bucket-level ``weight_source`` is surfaced via a chip so operators
 * know whether the chart is in canonical or fallback mode.
 *
 * Powered by lightweight-charts (TradingView) — drop-in replacement for
 * the previous recharts implementation, looks far more pro at the cost
 * of a slightly heavier bundle (acceptable for a trading dashboard).
 */

import {
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardBody, CardHeader, SurfaceCard } from "@/components/ui/surface";
import type { HiroPayload, HiroSeriesPoint } from "@/lib/streamClient";
import { cn } from "@/lib/utils";

// SpotGamma palette — keyed to design tokens (HSL space, premium).
const COLORS = {
  total: "#B299FF",     // accent / violet
  call: "#FFB033",      // flip / orange
  put: "#5B8FF9",       // brand-secondary / blue
  next: "#14E0A0",      // positive / emerald
  grid: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.08)",
  text: "rgba(232,234,242,0.85)",
  textFaint: "rgba(139,145,156,0.85)",
};

type SeriesKey = "total" | "call" | "put" | "next";

interface SeriesConfig {
  key: SeriesKey;
  label: string;
  color: string;
  /** Picks the right value from a HIRO bucket — delta-notional first,
   * falling back to signed-premium when delta wasn't available. */
  pick: (b: HiroSeriesPoint) => number;
}

const SERIES: SeriesConfig[] = [
  {
    key: "total",
    label: "Total",
    color: COLORS.total,
    pick: (b) => b.net_delta_notional ?? b.net_premium ?? 0,
  },
  {
    key: "call",
    label: "Calls",
    color: COLORS.call,
    pick: (b) => b.call_delta_notional ?? b.call_premium ?? 0,
  },
  {
    key: "put",
    label: "Puts",
    color: COLORS.put,
    pick: (b) => b.put_delta_notional ?? b.put_premium ?? 0,
  },
  {
    key: "next",
    label: "0DTE",
    color: COLORS.next,
    pick: (b) => b.next_expiry_delta_notional ?? b.next_expiry_premium ?? 0,
  },
];

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function toUtc(ts: string): UTCTimestamp {
  return Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp;
}

export interface HiroPanelProps {
  payload: HiroPayload | undefined;
}

export function HiroPanel({ payload }: HiroPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Record<SeriesKey, ISeriesApi<"Line"> | null>>({
    total: null,
    call: null,
    put: null,
    next: null,
  });

  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    total: true,
    call: true,
    put: true,
    next: true,
  });

  const series = payload?.series ?? [];
  const cumulative = payload?.cumulative ?? 0;
  const positive = cumulative >= 0;
  const weightSource =
    payload?.weight_source ??
    series[series.length - 1]?.weight_source ??
    "delta_notional";

  // Build per-series data once per payload change.
  const seriesData = useMemo(() => {
    const out: Record<SeriesKey, LineData[]> = {
      total: [],
      call: [],
      put: [],
      next: [],
    };
    for (const bucket of series) {
      const time = toUtc(bucket.ts);
      for (const cfg of SERIES) {
        const value = cfg.pick(bucket);
        if (Number.isFinite(value)) {
          out[cfg.key].push({ time, value });
        }
      }
    }
    return out;
  }, [series]);

  // ─────────── Chart init / teardown ───────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: {
        background: { color: "transparent" },
        textColor: COLORS.text,
        fontFamily: "Geist Mono, ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        horzLines: { color: COLORS.grid },
        vertLines: { color: COLORS.grid },
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: "rgba(178,153,255,0.4)",
          width: 1,
          style: LineStyle.Solid,
          labelBackgroundColor: "#1B1F2A",
        },
        horzLine: {
          color: "rgba(178,153,255,0.4)",
          width: 1,
          style: LineStyle.Solid,
          labelBackgroundColor: "#1B1F2A",
        },
      },
      width: el.clientWidth,
      height: el.clientHeight,
      autoSize: true,
    });
    chartRef.current = chart;

    // Build line series, in z-order: 0DTE → puts → calls → total (total on top).
    for (const cfg of SERIES) {
      const ls = chart.addLineSeries({
        color: cfg.color,
        lineWidth: cfg.key === "total" ? 2 : 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        priceFormat: {
          type: "custom",
          formatter: (v: number) => formatCompact(v),
          minMove: 1,
        },
      });
      seriesRef.current[cfg.key] = ls;
    }

    // Zero baseline overlay
    const zeroSeries = chart.addLineSeries({
      color: "rgba(255,255,255,0.18)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    seriesRef.current.total &&
      void zeroSeries; /* kept in scope for fitContent below */

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = { total: null, call: null, put: null, next: null };
    };
  }, []);

  // ─────────── Push data + visibility ───────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const cfg of SERIES) {
      const ls = seriesRef.current[cfg.key];
      if (!ls) continue;
      ls.setData(visible[cfg.key] ? seriesData[cfg.key] : []);
    }
    if (seriesData.total.length > 0) {
      chart.timeScale().fitContent();
    }
  }, [seriesData, visible]);

  return (
    <SurfaceCard
      variant={positive ? "positive" : "negative"}
      className="flex h-full flex-col"
    >
      <CardHeader
        title="HIRO"
        subtitle={
          <span className="flex items-center gap-2">
            <span>Hedging Impact of Real-time Options</span>
            <span className="text-fg-faint">·</span>
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {payload?.bucket_size ?? "1min"}
            </span>
          </span>
        }
        badge={
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
              weightSource === "delta_notional"
                ? "bg-accent/15 text-accent"
                : weightSource === "mixed"
                  ? "bg-flip-soft text-flip"
                  : "bg-bg-card-hover text-fg-muted",
            )}
            title={
              weightSource === "delta_notional"
                ? "Canonical delta-notional path"
                : weightSource === "mixed"
                  ? "Some buckets used signed-premium fallback"
                  : "Signed-premium fallback (no delta on chain)"
            }
          >
            {weightSource === "delta_notional" ? "Δ-notional" : weightSource}
          </span>
        }
        action={
          <div
            className={cn(
              "rounded-md px-2.5 py-1 font-mono text-sm font-semibold tabular-nums",
              positive
                ? "bg-positive-soft text-positive"
                : "bg-negative-soft text-negative",
            )}
          >
            {positive ? "+" : ""}
            {formatCompact(cumulative)}
          </div>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        {/* Legend / toggles */}
        <div className="flex flex-wrap gap-2">
          {SERIES.map((cfg) => (
            <button
              key={cfg.key}
              onClick={() =>
                setVisible((v) => ({ ...v, [cfg.key]: !v[cfg.key] }))
              }
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors duration-fast",
                visible[cfg.key]
                  ? "border-border-strong bg-bg-card-hover text-fg-primary"
                  : "border-border-subtle bg-transparent text-fg-faint hover:text-fg-muted",
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: visible[cfg.key] ? cfg.color : "transparent",
                  border: visible[cfg.key]
                    ? "none"
                    : `1px solid ${cfg.color}`,
                }}
              />
              {cfg.label}
            </button>
          ))}
        </div>

        {series.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            No HIRO data yet — waiting for the next pipeline tick.
          </div>
        ) : (
          <div ref={containerRef} className="min-h-[260px] flex-1" />
        )}

        {/* Footer caption */}
        <div className="flex items-center justify-between border-t border-border-subtle/60 pt-3 text-[10px] text-fg-faint">
          <span className="uppercase tracking-wider">
            Positive = dealer hedges by BUYING underlying
          </span>
          <span className="font-mono">SpotGamma convention</span>
        </div>
      </CardBody>
    </SurfaceCard>
  );
}
