import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/lib/stream";

type StatusMeta = {
  label: string;
  dotClass: string;
  pulse: boolean;
};

const STATUS_COPY: Record<ConnectionStatus, StatusMeta> = {
  idle: {
    label: "Idle",
    dotClass: "bg-zinc-500/70",
    pulse: false,
  },
  connecting: {
    label: "Connecting",
    dotClass: "bg-amber-400",
    pulse: true,
  },
  open: {
    label: "Live",
    dotClass: "bg-green-400",
    pulse: true,
  },
  reconnecting: {
    label: "Reconnecting",
    dotClass: "bg-amber-400",
    pulse: true,
  },
  closed: {
    label: "Offline",
    dotClass: "bg-zinc-500/70",
    pulse: false,
  },
  error: {
    label: "Error",
    dotClass: "bg-red-400",
    pulse: false,
  },
};

interface ConnectionPillProps {
  status: ConnectionStatus;
  className?: string;
}

export function ConnectionPill({ status, className }: ConnectionPillProps) {
  const meta = STATUS_COPY[status];
  return (
    <span
      className={cn(
        "liquid-glass rounded-full px-3 py-1.5 inline-flex items-center gap-2",
        className,
      )}
      title={`Stream status: ${meta.label}`}
      aria-label={`Live stream status: ${meta.label}`}
      role="status"
    >
      <span
        aria-hidden
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          meta.dotClass,
          meta.pulse ? "animate-pulse-dot" : null,
        )}
      />
      <span
        className="text-[10px] font-mono tracking-[0.2em] uppercase"
        style={{ color: "var(--text-secondary)" }}
      >
        {meta.label}
      </span>
    </span>
  );
}
