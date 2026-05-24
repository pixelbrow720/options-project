/**
 * SpotTile — hero tile showing the resolved spot price + provenance.
 *
 * The Rev 4 spot resolver chains: futures-basis EMA → put-call parity →
 * stale cache. This tile surfaces the resolved price big, with the
 * source as a small chip + the futures basis as a sub-line.
 */

import { useEffect, useRef, useState } from "react";
import { CardBody, CardHeader, MetricTile, SurfaceCard } from "@/components/ui/surface";
import type { SpotPayload } from "@/lib/streamClient";
import { cn } from "@/lib/utils";

const SOURCE_STYLES: Record<string, { label: string; tone: string; tooltip: string }> = {
  futures_basis: {
    label: "FUT·BASIS",
    tone: "bg-positive-soft/40 text-positive border-positive/30",
    tooltip: "Resolved from front-month futures + EMA basis (preferred)",
  },
  parity: {
    label: "PARITY",
    tone: "bg-flip-soft/40 text-flip border-flip/30",
    tooltip: "Resolved from put-call parity (futures feed unavailable)",
  },
  stale_cache: {
    label: "STALE",
    tone: "bg-negative-soft/40 text-negative border-negative/30",
    tooltip: "Last-known cached value — feed degraded",
  },
};

export interface SpotTileProps {
  spot: SpotPayload | undefined;
  symbol: string;
}

export function SpotTile({ spot, symbol }: SpotTileProps) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (!spot || !Number.isFinite(spot.price)) return;
    if (prev.current !== null && prev.current !== spot.price) {
      setFlash(spot.price > prev.current ? "up" : "down");
      const t = window.setTimeout(() => setFlash(null), 600);
      prev.current = spot.price;
      return () => window.clearTimeout(t);
    }
    prev.current = spot.price;
  }, [spot]);

  const source = spot?.source ?? null;
  const sourceStyle = source ? SOURCE_STYLES[source] : null;
  const basis = spot?.basis;
  const basisAge = spot?.basis_age_seconds;
  const futures = spot?.futures_price;
  const parityDev = spot?.parity_deviation_pct;

  return (
    <SurfaceCard variant="accent" className="flex h-full flex-col">
      <CardHeader
        title={`${symbol} Spot`}
        subtitle="Resolved underlying"
        badge={
          sourceStyle && (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider",
                sourceStyle.tone,
              )}
              title={sourceStyle.tooltip}
            >
              {sourceStyle.label}
            </span>
          )
        }
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        <div
          className={cn(
            "transition-colors duration-base",
            flash === "up" && "text-positive",
            flash === "down" && "text-negative",
          )}
        >
          <MetricTile
            label="Last"
            value={spot ? spot.price.toFixed(2) : "—"}
            size="xl"
            className="leading-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border-subtle/60 pt-3 text-xs">
          <div className="flex flex-col">
            <span className="text-fg-faint uppercase tracking-wider text-[10px]">
              Futures
            </span>
            <span className="mt-0.5 font-mono tabular-nums text-fg-secondary">
              {futures != null ? futures.toFixed(2) : "—"}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-fg-faint uppercase tracking-wider text-[10px]">
              Basis
            </span>
            <span
              className={cn(
                "mt-0.5 font-mono tabular-nums",
                basis != null && basis < 0
                  ? "text-negative"
                  : basis != null && basis > 0
                    ? "text-positive"
                    : "text-fg-muted",
              )}
            >
              {basis != null ? `${basis >= 0 ? "+" : ""}${basis.toFixed(2)}` : "—"}
              {basisAge != null && (
                <span className="ml-1 text-[10px] text-fg-faint">
                  ({basisAge.toFixed(0)}s)
                </span>
              )}
            </span>
          </div>
          {parityDev != null && (
            <div className="col-span-2 flex items-center justify-between text-[11px]">
              <span className="text-fg-faint">Parity deviation</span>
              <span
                className={cn(
                  "font-mono tabular-nums",
                  parityDev > 0.5 ? "text-flip" : "text-fg-muted",
                )}
              >
                {parityDev.toFixed(3)}%
              </span>
            </div>
          )}
        </div>
      </CardBody>
    </SurfaceCard>
  );
}
