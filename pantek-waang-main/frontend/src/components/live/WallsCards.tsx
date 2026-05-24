/**
 * WallsCards V2 — Call walls / Put walls / Max pain.
 *
 * Premium tile design: each row shows strike + bar visualisation
 * (relative-to-max), so a row's importance is conveyed at a glance.
 * Max pain card lifts the aggregate strike as a hero number.
 */

import { motion } from "framer-motion";
import { useMemo } from "react";
import { CardBody, CardHeader, MetricTile, SurfaceCard } from "@/components/ui/surface";
import type { MaxPainPayload, WallsPayload, WallStrike } from "@/lib/streamClient";
import { cn } from "@/lib/utils";

function formatStrike(value: number): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatBig(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function topN(rows: WallStrike[] | undefined, n: number): WallStrike[] {
  if (!rows) return [];
  return [...rows].sort((a, b) => (a.rank || 999) - (b.rank || 999)).slice(0, n);
}

function WallTile({
  title,
  hint,
  rows,
  accent,
}: {
  title: string;
  hint: string;
  rows: WallStrike[];
  accent: "call" | "put";
}) {
  const max = rows.length ? Math.max(...rows.map((r) => r.value), 1) : 1;
  const tone = accent === "call" ? "text-positive" : "text-negative";
  const barTone =
    accent === "call"
      ? "from-positive/60 to-positive/0"
      : "from-negative/60 to-negative/0";

  return (
    <SurfaceCard variant={accent === "call" ? "positive" : "negative"} className="flex flex-col">
      <CardHeader title={title} subtitle={hint} />
      <CardBody className="space-y-2">
        {rows.length === 0 ? (
          <div className="py-3 text-sm text-fg-muted">No data yet.</div>
        ) : (
          rows.map((r, idx) => {
            const pct = (r.value / max) * 100;
            return (
              <motion.div
                key={`${r.rank}-${r.strike}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18, delay: idx * 0.04 }}
                className="relative overflow-hidden rounded-md bg-bg-elevated/60 px-3 py-2"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r",
                    barTone,
                  )}
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-fg-faint tabular-nums">
                      #{r.rank}
                    </span>
                    <span className={cn("font-mono text-sm font-semibold tabular-nums", tone)}>
                      {formatStrike(r.strike)}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-fg-muted tabular-nums">
                    {formatBig(r.value)}
                  </span>
                </div>
              </motion.div>
            );
          })
        )}
      </CardBody>
    </SurfaceCard>
  );
}

export interface WallsCardsProps {
  walls: WallsPayload | undefined;
  maxPain: MaxPainPayload | undefined;
}

export function WallsCards({ walls, maxPain }: WallsCardsProps) {
  const callRows = useMemo(() => topN(walls?.call_wall_oi, 5), [walls]);
  const putRows = useMemo(() => topN(walls?.put_wall_oi, 5), [walls]);

  const aggregate = maxPain?.aggregate ?? null;
  const perExpiry = (maxPain?.per_expiry ?? []).slice(0, 5);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <WallTile
        title="Call walls"
        hint="Top OI strikes — resistance"
        rows={callRows}
        accent="call"
      />
      <WallTile
        title="Put walls"
        hint="Top OI strikes — support"
        rows={putRows}
        accent="put"
      />
      <SurfaceCard variant="default" className="flex flex-col">
        <CardHeader title="Max pain" subtitle="Aggregate + nearest expiries" />
        <CardBody className="flex flex-col gap-3">
          {aggregate ? (
            <MetricTile
              label="Aggregate strike"
              value={formatStrike(aggregate.strike)}
              hint={`Pain ${formatBig(aggregate.value)}`}
              tone="flip"
              size="lg"
            />
          ) : (
            <div className="text-sm text-fg-muted">No aggregate yet.</div>
          )}
          {perExpiry.length > 0 && (
            <ul className="mt-1 space-y-1.5 border-t border-border-subtle/60 pt-3 text-sm">
              {perExpiry.map((r) => (
                <li
                  key={r.expiration}
                  className="flex items-center justify-between rounded px-2 py-1 hover:bg-bg-card-hover/60"
                >
                  <span className="font-mono text-xs text-fg-muted tabular-nums">
                    {r.expiration}
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-fg-primary">
                    {formatStrike(r.strike)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </SurfaceCard>
    </div>
  );
}
