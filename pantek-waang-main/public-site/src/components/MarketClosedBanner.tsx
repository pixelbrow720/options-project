import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatCountdown, formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MarketClosedBannerProps {
  computedAt: string | null;
  hoursOld: number | null;
  marketOpenIso: string | null;
  marketOpenInSeconds: number | null;
  className?: string;
}

export function MarketClosedBanner({
  computedAt,
  hoursOld,
  marketOpenIso,
  marketOpenInSeconds,
  className,
}: MarketClosedBannerProps) {
  // Anchor `targetMs` so it doesn't drift across re-renders. Only re-anchor
  // when the props that define the target change.
  const targetMs = useMemo<number | null>(() => {
    if (marketOpenIso) {
      const t = new Date(marketOpenIso).getTime();
      if (!Number.isNaN(t)) return t;
    }
    if (marketOpenInSeconds !== null && marketOpenInSeconds !== undefined) {
      return Date.now() + marketOpenInSeconds * 1000;
    }
    return null;
  }, [marketOpenIso, marketOpenInSeconds]);

  const [remaining, setRemaining] = useState<number | null>(() =>
    targetMs ? Math.max(0, Math.floor((targetMs - Date.now()) / 1000)) : null,
  );

  useEffect(() => {
    if (!targetMs) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.floor((targetMs - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const ageText = (() => {
    if (typeof hoursOld === "number" && Number.isFinite(hoursOld)) {
      return formatDuration(hoursOld * 3600 * 1000);
    }
    if (computedAt) {
      const t = new Date(computedAt).getTime();
      if (!Number.isNaN(t)) return formatDuration(Date.now() - t);
    }
    return "—";
  })();

  return (
    <div
      role="status"
      className={cn("liquid-glass-strong rounded-2xl p-5", className)}
      style={{
        borderLeft: "3px solid var(--accent-amber)",
      }}
    >
      <div className="container flex flex-wrap items-center gap-x-3 gap-y-1">
        <AlertTriangle
          className="h-4 w-4 shrink-0"
          style={{ color: "var(--accent-amber)" }}
        />
        <span
          className="text-base"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            color: "var(--accent-amber)",
          }}
        >
          Market closed.
        </span>
        <span
          className="font-mono text-sm"
          style={{
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          Showing snapshot from{" "}
          <span style={{ color: "var(--text-primary)" }}>{ageText}</span> ago
          {computedAt ? (
            <span style={{ color: "var(--text-muted)" }}>
              {" "}
              ({formatDateTime(computedAt)})
            </span>
          ) : null}
          .
        </span>
        {remaining !== null ? (
          <span
            className="font-mono text-sm"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Live updates resume in{" "}
            <span
              className="font-mono"
              style={{ color: "var(--accent-amber)" }}
            >
              {formatCountdown(remaining)}
            </span>
            .
          </span>
        ) : null}
      </div>
    </div>
  );
}
