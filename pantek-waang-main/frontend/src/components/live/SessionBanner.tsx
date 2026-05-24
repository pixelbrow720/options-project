/**
 * SessionBanner — RTH-state strip + key 0DTE telemetry.
 *
 * Shows session open/close countdown, 0DTE flip-speed, charm decay rate,
 * and IV ATM. Sits at the top of /live as a compact "context bar" so the
 * trader knows at a glance what regime they're staring at.
 */

import { IconClock, IconFlame, IconRipple } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { SessionStatePayload, SnapshotData } from "@/lib/streamClient";

interface SessionBannerProps {
  data: SnapshotData | undefined;
}

function formatTime(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  if (min < 0) return `${Math.abs(Math.round(min))}m past close`;
  const hr = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (hr === 0) return `${m}m`;
  return `${hr}h ${m}m`;
}

export function SessionBanner({ data }: SessionBannerProps) {
  const sess = data?.session_state;
  const zdte = data?.zero_dte;
  const iv = data?.iv;
  const move = data?.move_tracker;

  const isRth = sess?.is_rth ?? false;
  const isExpiry = sess?.is_expiration_day ?? false;

  return (
    <div
      className={cn(
        "anim-fade-in-up flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border-subtle bg-bg-card/60 px-5 py-3 backdrop-blur-sm",
      )}
    >
      <SessionPill isRth={isRth} sess={sess} isExpiry={isExpiry} />
      <Divider />
      <Metric
        icon={IconFlame}
        label="0DTE flip speed"
        value={zdte?.flip_speed != null ? formatCompact(zdte.flip_speed) : "—"}
        tone={zdte?.flip_speed != null && zdte.flip_speed > 0 ? "positive" : "default"}
      />
      <Metric
        icon={IconRipple}
        label="Charm decay"
        value={
          zdte?.charm_decay_rate != null
            ? `${(zdte.charm_decay_rate * 100).toFixed(2)}%`
            : "—"
        }
      />
      <Metric
        icon={IconClock}
        label="ATM IV"
        value={iv?.atm_iv != null ? `${(iv.atm_iv * 100).toFixed(2)}%` : "—"}
      />
      {move?.realized_move != null && (
        <Metric
          label="Realized / Implied"
          value={
            move.implied_move != null
              ? `${move.realized_move.toFixed(2)} / ${move.implied_move.toFixed(2)}`
              : `${move.realized_move.toFixed(2)}`
          }
          hint={
            move.ratio != null
              ? `${(move.ratio * 100).toFixed(0)}% of implied`
              : undefined
          }
        />
      )}
    </div>
  );
}

function SessionPill({
  isRth,
  sess,
  isExpiry,
}: {
  isRth: boolean;
  sess: SessionStatePayload | undefined;
  isExpiry: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-fg-faint">
          Session
        </span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isRth ? "bg-positive pulse-soft shadow-glow-positive" : "bg-fg-faint",
            )}
          />
          {isRth ? "RTH open" : sess ? "After hours" : "—"}
          {isExpiry && (
            <span className="ml-1 rounded border border-flip/40 bg-flip-soft/50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-flip">
              0DTE
            </span>
          )}
        </span>
        {isRth && sess?.minutes_to_close != null && (
          <span className="text-[11px] text-fg-muted">
            {formatTime(sess.minutes_to_close)} to close
          </span>
        )}
        {!isRth && sess?.minutes_to_close != null && (
          <span className="text-[11px] text-fg-muted">
            {formatTime(sess.minutes_to_close)}
          </span>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <span className="h-8 w-px bg-border-subtle" />;
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon?: typeof IconClock;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "flip";
}) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={14} className="text-fg-faint" stroke={1.8} />}
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wider text-fg-faint">
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            tone === "positive" && "text-positive",
            tone === "negative" && "text-negative",
            tone === "flip" && "text-flip",
          )}
        >
          {value}
        </span>
        {hint && <span className="text-[10px] text-fg-faint">{hint}</span>}
      </div>
    </div>
  );
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}
