import type { ConnectionStatus } from "@/contracts/types/snapshot";
import { cn } from "@/shared/lib/cn";

/**
 * Connection pill — atomic status indicator for WS connection health.
 *
 * Mirrors the backend repo's ConnectionPill commit (the matching
 * server-side concept is the WS health endpoint). Maps every
 * ConnectionStatus from the contract to an at-a-glance affordance.
 *
 * Color rule: this uses `--color-status-*` (info / warn / error), NOT
 * the signed-value greens/reds. A trader must never confuse "WS is
 * down" with "I'm short delta".
 */

interface ConnectionPillProps {
  status: ConnectionStatus;
  /** Optional ms-since-last-frame, rendered as a small age tag. */
  lastFrameAgeMs?: number;
  className?: string;
}

const map: Record<ConnectionStatus, { label: string; tone: "ok" | "warn" | "error" | "muted" }> = {
  connecting: { label: "connecting", tone: "warn" },
  open: { label: "live", tone: "ok" },
  reconnecting: { label: "reconnecting", tone: "warn" },
  closed: { label: "offline", tone: "muted" },
  error: { label: "error", tone: "error" },
  "auth-failed": { label: "auth", tone: "error" },
};

const tones = {
  ok: "border-[color:var(--color-success)]/30 text-[var(--color-success)]",
  warn: "border-[color:var(--color-warn)]/30 text-[var(--color-warn)]",
  error: "border-[color:var(--color-error)]/30 text-[var(--color-error)]",
  muted: "border-[color:var(--color-border-strong)] text-[var(--color-fg-muted)]",
} as const;

const dot = {
  ok: "bg-[var(--color-success)]",
  warn: "bg-[var(--color-warn)] animate-pulse",
  error: "bg-[var(--color-error)]",
  muted: "bg-[var(--color-fg-muted)]",
} as const;

export function ConnectionPill({ status, lastFrameAgeMs, className }: ConnectionPillProps) {
  const { label, tone } = map[status];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        "bg-[var(--color-bg-base)]/60 backdrop-blur-md font-numeric",
        tones[tone],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[tone])} aria-hidden="true" />
      <span>{label}</span>
      {typeof lastFrameAgeMs === "number" && Number.isFinite(lastFrameAgeMs) ? (
        <span className="text-[var(--color-fg-muted)] tabular-nums">
          {lastFrameAgeMs < 1000 ? `${Math.round(lastFrameAgeMs)}ms` : `${Math.round(lastFrameAgeMs / 1000)}s`}
        </span>
      ) : null}
    </span>
  );
}
