/**
 * Live page — premium realtime dashboard.
 *
 * Layout:
 *   • Hero strip      — title + regime + session banner
 *   • Bento row 1     — Spot tile (1) · GEX chart (2)  → 3 cols
 *   • Bento row 2     — HIRO (full width)               → 1 col
 *   • Walls row       — call walls / put walls / max pain (3 cols)
 *   • Flow feed       — bottom (full width)
 */

import { motion } from "framer-motion";
import { FlowFeed } from "@/components/live/FlowFeed";
import { GexChart } from "@/components/live/GexChart";
import { HiroPanel } from "@/components/live/HiroPanel";
import { RegimeBadge } from "@/components/live/RegimeBadge";
import { SessionBanner } from "@/components/live/SessionBanner";
import { SpotTile } from "@/components/live/SpotTile";
import { WallsCards } from "@/components/live/WallsCards";
import { useLiveSnapshot } from "@/lib/streamClient";

export function LivePage() {
  const { symbol, snapshot } = useLiveSnapshot();
  const data = snapshot?.data;

  return (
    <div className="space-y-6 pb-12">
      {/* Hero strip ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-fg-faint">
            <span>Live · </span>
            <span className="font-mono text-fg-muted">{symbol}</span>
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Realtime Options Flow
          </h1>
          <p className="max-w-prose text-sm text-fg-muted">
            Dealer-hedge, gamma exposure and flow telemetry — refreshed every
            pipeline tick (≈60s) and on every order print via the tick stream.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RegimeBadge regime={data?.regime} />
        </div>
      </motion.div>

      {/* Session banner ────────────────────────────────────── */}
      <SessionBanner data={data} />

      {/* Bento — Spot + GEX ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SpotTile spot={data?.spot} symbol={symbol} />
        </div>
        <div className="lg:col-span-2">
          <GexChart
            payload={data?.gex}
            title="GEX"
            description="OI-weighted dealer gamma per strike"
          />
        </div>
      </div>

      {/* HIRO full width ───────────────────────────────────── */}
      <HiroPanel payload={data?.hiro} />

      {/* Walls ─────────────────────────────────────────────── */}
      <WallsCards walls={data?.walls} maxPain={data?.max_pain} />

      {/* Flow feed ─────────────────────────────────────────── */}
      <FlowFeed flow={data?.flow} />
    </div>
  );
}
