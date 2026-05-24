/**
 * GexChart V2 — premium per-strike Gamma Exposure visualisation.
 *
 * Rendered with lightweight-charts (TradingView) as a bar chart, with
 * positive (call-dominant) bars green and negative (put-dominant) bars
 * rose, plus reference lines for spot and zero-gamma. Ticks the
 * SpotGamma aesthetic for "where the dealer hedges flip".
 */

import {
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  CardBody,
  CardFooter,
  CardHeader,
  MetricTile,
  SurfaceCard,
} from "@/components/ui/surface";
import type { GexPayload } from "@/lib/streamClient";
import { cn } from "@/lib/utils";

const COLORS = {
  positive: "#14E0A0",
  negative: "#F94D6D",
  spot: "#FFB033",
  zeroGamma: "#B299FF",
  grid: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.08)",
  text: "rgba(232,234,242,0.85)",
};

function formatStrike(value: number): string {
  return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toString();
}

function formatGex(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export interface GexChartProps {
  payload: GexPayload | undefined;
  title?: string;
  description?: string;
}

function GexChartImpl({ payload, title = "GEX", description }: GexChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const data = useMemo(() => {
    const curve = payload?.curve ?? [];
    return [...curve]
      .filter(
        (p) =>
          Number.isFinite(p.strike) && Number.isFinite(p.net_gex),
      )
      .sort((a, b) => a.strike - b.strike)
      .map((p) => ({
        // Lightweight-charts indexes time-axis as UTC seconds; we abuse it
        // here as a strike axis by encoding strike directly. The chart
        // displays the value via a custom formatter; a real time-axis is
        // unnecessary for this distribution chart.
        time: Math.round(p.strike) as UTCTimestamp,
        value: p.net_gex,
        color: p.net_gex >= 0 ? COLORS.positive : COLORS.negative,
      }));
  }, [payload]);

  const zeroGamma = payload?.zero_gamma ?? null;
  const underlying = payload?.underlying_price ?? null;
  const netTotal = payload?.net_total ?? 0;
  const positive = netTotal >= 0;

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
        tickMarkFormatter: (time: number) => formatStrike(time),
        fixLeftEdge: true,
        fixRightEdge: true,
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
      autoSize: true,
    });
    chartRef.current = chart;

    seriesRef.current = chart.addHistogramSeries({
      priceFormat: {
        type: "custom",
        formatter: formatGex,
        minMove: 1,
      },
      base: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Push data + reference lines.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    series.setData(data);

    // Clear and re-add reference price lines (lightweight-charts requires
    // explicit removal, but we re-create the series implicitly here by
    // dropping all then adding). For reference *price-lines* we use
    // ``createPriceLine`` instead — but those don't support time-axis
    // markers. Strike axis is on time, so we render markers via series
    // markers below.

    series.setMarkers([
      ...(underlying !== null && Number.isFinite(underlying)
        ? [
            {
              time: Math.round(underlying as number) as UTCTimestamp,
              position: "aboveBar" as const,
              color: COLORS.spot,
              shape: "arrowDown" as const,
              text: `Spot ${(underlying as number).toFixed(0)}`,
            },
          ]
        : []),
      ...(zeroGamma !== null && Number.isFinite(zeroGamma)
        ? [
            {
              time: Math.round(zeroGamma as number) as UTCTimestamp,
              position: "belowBar" as const,
              color: COLORS.zeroGamma,
              shape: "arrowUp" as const,
              text: `0γ ${(zeroGamma as number).toFixed(0)}`,
            },
          ]
        : []),
    ]);

    if (data.length > 0) chart.timeScale().fitContent();
  }, [data, underlying, zeroGamma]);

  return (
    <SurfaceCard
      variant={positive ? "positive" : "negative"}
      className="flex h-full flex-col"
    >
      <CardHeader
        title={title}
        subtitle={description ?? "Per-strike dealer gamma exposure"}
        action={
          <MetricTile
            label="Net total"
            value={formatGex(netTotal)}
            tone={positive ? "positive" : "negative"}
            size="sm"
            className="text-right items-end"
          />
        }
      />
      <CardBody className="flex flex-1 flex-col">
        {data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-fg-muted">
            No GEX data yet.
          </div>
        ) : (
          <div ref={containerRef} className="min-h-[260px] flex-1" />
        )}
      </CardBody>
      <CardFooter className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-3 text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-3 rounded-sm"
              style={{ background: COLORS.positive }}
            />
            Long γ
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-3 rounded-sm"
              style={{ background: COLORS.negative }}
            />
            Short γ
          </span>
        </div>
        <div className={cn("font-mono uppercase tracking-wider", "text-fg-faint")}>
          {data.length} strikes
        </div>
      </CardFooter>
    </SurfaceCard>
  );
}

export const GexChart = memo(GexChartImpl, (prev, next) => {
  if (prev.title !== next.title || prev.description !== next.description) return false;
  const a = prev.payload;
  const b = next.payload;
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    (a.curve?.length ?? 0) === (b.curve?.length ?? 0) &&
    a.net_total === b.net_total &&
    a.zero_gamma === b.zero_gamma &&
    a.underlying_price === b.underlying_price
  );
});
