/**
 * FlowFeed V2 — premium ticker for SWEEP / BLOCK / UOA events.
 *
 * Each row is a "card-row" with event-type accent colour, contract label
 * in mono, and premium magnitude on the right. Time-since chip uses
 * relative formatting (e.g. "12s ago") for the freshest events.
 */

import {
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconStack2,
  IconWaveSawTool,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { CardBody, CardHeader, SurfaceCard } from "@/components/ui/surface";
import type { FlowEvent, FlowPayload } from "@/lib/streamClient";
import { cn, formatTimeET } from "@/lib/utils";

function formatPremium(ev: FlowEvent): string {
  // Backend includes ``premium`` directly on rows from /v1/{symbol}/flow
  // and ``meta.premium_usd`` on snapshot.flow rows. Compute on the fly
  // when neither is present.
  const direct = ev.premium ?? null;
  if (direct != null && Number.isFinite(direct)) return formatUsd(direct);
  const computed =
    ev.size != null && ev.price != null && Number.isFinite(ev.size) && Number.isFinite(ev.price)
      ? ev.size * ev.price * 100 * (ev.side ?? 1)
      : null;
  return computed != null ? formatUsd(computed) : "—";
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function contractLabel(ev: FlowEvent): string {
  if (ev.contract_label) return ev.contract_label;
  const parts = [ev.symbol, ev.expiration, ev.strike, ev.option_type]
    .filter((v) => v !== undefined && v !== null && v !== "")
    .map((v) => String(v));
  return parts.length > 0 ? parts.join(" ") : "—";
}

function relativeTime(ts: string): string {
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const EVENT_STYLES: Record<
  string,
  { icon: typeof IconBolt; bg: string; text: string }
> = {
  SWEEP: {
    icon: IconBolt,
    bg: "bg-flip-soft/40 border-flip/30",
    text: "text-flip",
  },
  BLOCK: {
    icon: IconStack2,
    bg: "bg-accent/15 border-accent/30",
    text: "text-accent",
  },
  UOA: {
    icon: IconWaveSawTool,
    bg: "bg-positive-soft/40 border-positive/30",
    text: "text-positive",
  },
};

export interface FlowFeedProps {
  flow: FlowPayload | undefined;
  events?: FlowEvent[];
}

export function FlowFeed({ flow, events: directEvents }: FlowFeedProps) {
  const events = useMemo(() => {
    const list = directEvents ?? flow?.events ?? [];
    return [...list]
      .sort((a, b) => {
        const ta = new Date(a.ts).getTime();
        const tb = new Date(b.ts).getTime();
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return tb - ta;
      })
      .slice(0, 50);
  }, [directEvents, flow]);

  const counts = useMemo(() => {
    const c = { SWEEP: 0, BLOCK: 0, UOA: 0 } as Record<string, number>;
    for (const e of events) {
      const k = e.event_type.toUpperCase();
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [events]);

  return (
    <SurfaceCard className="flex flex-col">
      <CardHeader
        title="Flow Feed"
        subtitle="Recent SWEEP · BLOCK · UOA events"
        action={
          <div className="flex items-center gap-1.5">
            {Object.entries(EVENT_STYLES).map(([type, s]) => (
              <span
                key={type}
                className={cn(
                  "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider tabular-nums",
                  s.bg,
                  s.text,
                )}
              >
                <span className="opacity-70">{type[0]}</span>
                <span>{counts[type] ?? 0}</span>
              </span>
            ))}
          </div>
        }
      />
      <CardBody>
        {events.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-fg-muted">
            No flow events yet.
          </div>
        ) : (
          <ul
            className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1"
            data-testid="flow-feed-list"
          >
            {events.map((ev, idx) => {
              const type = ev.event_type.toUpperCase();
              const style = EVENT_STYLES[type] ?? EVENT_STYLES.UOA;
              const Icon = style.icon;
              const buy = (ev.side ?? 0) > 0;
              return (
                <motion.li
                  key={ev.id ?? `${ev.ts}-${idx}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(idx * 0.015, 0.3) }}
                  className="group flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated/50 px-3 py-2 transition-colors duration-fast hover:border-border-hover hover:bg-bg-card-hover"
                >
                  {/* Event-type chip */}
                  <span
                    className={cn(
                      "flex h-7 items-center gap-1 rounded border px-2 text-[10px] font-semibold uppercase tracking-wider",
                      style.bg,
                      style.text,
                    )}
                  >
                    <Icon size={11} stroke={2.4} />
                    {type}
                  </span>
                  {/* Side */}
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded",
                      buy ? "bg-positive-soft/60 text-positive" : "bg-negative-soft/60 text-negative",
                    )}
                  >
                    {buy ? (
                      <IconArrowUp size={14} stroke={2.4} />
                    ) : (
                      <IconArrowDown size={14} stroke={2.4} />
                    )}
                  </span>
                  {/* Contract */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-sm text-fg-primary">
                      {contractLabel(ev)}
                    </span>
                    <span className="font-mono text-[10px] text-fg-muted">
                      {ev.size ? `${ev.size}x` : ""}
                      {ev.price != null ? ` @ ${ev.price.toFixed(2)}` : ""}
                      {ev.legs && ev.legs > 1 ? ` · ${ev.legs} legs` : ""}
                      {ev.venues && ev.venues.length > 0
                        ? ` · ${ev.venues.slice(0, 3).join(", ")}${ev.venues.length > 3 ? "…" : ""}`
                        : ""}
                    </span>
                  </div>
                  {/* Premium */}
                  <div className="flex flex-col items-end leading-tight">
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold tabular-nums",
                        buy ? "text-positive" : "text-negative",
                      )}
                    >
                      {formatPremium(ev)}
                    </span>
                    <span className="font-mono text-[10px] text-fg-faint tabular-nums">
                      {relativeTime(ev.ts)} · {formatTimeET(ev.ts)}
                    </span>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </SurfaceCard>
  );
}
