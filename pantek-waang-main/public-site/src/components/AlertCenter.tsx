import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { decimalsFor, formatPrice } from "@/lib/format";
import { toast } from "@/components/ui/toast";

export interface AlertLevel {
  label: string;
  cash_strike: number;
  kind: string;
}

interface AlertCenterProps {
  symbol: string;
  spot: number | null;
  levels: AlertLevel[];
  /** Touch threshold as fraction of spot. Defaults to 0.001 (0.1%). */
  touchThreshold?: number;
  className?: string;
}

const STORAGE_KEY = "pw_alerts_enabled";

type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode / disabled storage — fall back to disabled.
    return false;
  }
}

function writeEnabled(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort: ignore storage failures (private mode, quota, etc.).
  }
}

function getPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission as NotificationPermissionState;
}

function alertKey(level: AlertLevel): string {
  return `${level.kind}:${level.cash_strike}:${level.label}`;
}

export function AlertCenter({
  symbol,
  spot,
  levels,
  touchThreshold = 0.001,
  className,
}: AlertCenterProps) {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState<boolean>(() => readEnabled());
  const [permission, setPermission] = useState<NotificationPermissionState>(
    () => getPermission(),
  );
  const firedRef = useRef<Set<string>>(new Set());
  const lastSpotRef = useRef<number | null>(null);

  const dec = decimalsFor(symbol);

  // Reset fired alerts when symbol changes (different watchlist).
  useEffect(() => {
    firedRef.current = new Set();
  }, [symbol]);

  // Clear a fired alert once spot has moved away from a level (so it can
  // re-fire on a future touch).
  useEffect(() => {
    if (spot === null || levels.length === 0) {
      lastSpotRef.current = spot;
      return;
    }
    const fired = firedRef.current;
    if (fired.size === 0) {
      lastSpotRef.current = spot;
      return;
    }
    for (const level of levels) {
      const key = alertKey(level);
      if (!fired.has(key)) continue;
      const tolerance = Math.abs(level.cash_strike) * touchThreshold * 2;
      if (Math.abs(spot - level.cash_strike) > tolerance) {
        fired.delete(key);
      }
    }
    lastSpotRef.current = spot;
  }, [spot, levels, touchThreshold]);

  const fireAlert = useCallback(
    (level: AlertLevel, currentSpot: number) => {
      const title = `${symbol} touched ${level.label}`;
      const body = `Spot ${formatPrice(currentSpot, dec)} hit ${formatPrice(
        level.cash_strike,
        dec,
      )} (${level.kind})`;
      try {
        toast({
          title,
          description: body,
          variant: "default",
          duration: 6000,
        });
      } catch {
        // toast is best-effort
      }
      if (
        typeof window !== "undefined" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification(title, { body, tag: alertKey(level) });
        } catch {
          // ignore browser failures
        }
      }
    },
    [symbol, dec],
  );

  // Watch spot vs levels and fire when within threshold.
  useEffect(() => {
    if (!enabled || spot === null || levels.length === 0) return;
    const fired = firedRef.current;
    for (const level of levels) {
      if (level.cash_strike <= 0) continue;
      const tolerance = Math.abs(level.cash_strike) * touchThreshold;
      if (Math.abs(spot - level.cash_strike) <= tolerance) {
        const key = alertKey(level);
        if (!fired.has(key)) {
          fired.add(key);
          fireAlert(level, spot);
        }
      }
    }
  }, [enabled, spot, levels, touchThreshold, fireAlert]);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return "unsupported";
    }
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return Notification.permission as NotificationPermissionState;
    }
    try {
      const result = await Notification.requestPermission();
      return result as NotificationPermissionState;
    } catch {
      return "denied";
    }
  }, []);

  const handleToggle = useCallback(async () => {
    if (enabled) {
      setEnabled(false);
      writeEnabled(false);
      return;
    }
    const next = await requestPermission();
    setPermission(next);
    setEnabled(true);
    writeEnabled(true);
    if (next === "denied") {
      toast({
        title: "Browser notifications blocked",
        description:
          "Toasts will still appear in-app. Re-enable notifications in your browser to get desktop alerts.",
        variant: "default",
      });
    }
  }, [enabled, requestPermission]);

  const watchedCount = levels.length;

  const label = useMemo(() => {
    if (!enabled) {
      return `Alerts: OFF · ${watchedCount} ${watchedCount === 1 ? "level" : "levels"}`;
    }
    return `Alerts: ON · ${watchedCount} ${watchedCount === 1 ? "level" : "levels"} watched`;
  }, [enabled, watchedCount]);

  const Icon = enabled ? Bell : BellOff;

  return (
    <motion.button
      type="button"
      onClick={handleToggle}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      aria-pressed={enabled}
      aria-label={enabled ? "Disable alerts" : "Enable alerts"}
      title={
        permission === "denied"
          ? "Browser notifications blocked. Toasts still fire."
          : permission === "unsupported"
            ? "Browser notifications unsupported. Toasts still fire."
            : enabled
              ? "Click to disable alerts"
              : "Click to enable alerts"
      }
      className={cn(
        "liquid-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
        "focus:outline-none focus-visible:ring-2",
        className,
      )}
      style={{
        color: enabled ? "var(--accent-foid)" : "var(--text-secondary)",
        fontFamily: "var(--font-mono-foid)",
      }}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="font-mono tabular-nums">{label}</span>
      {permission === "denied" ? (
        <span
          className="ml-1 rounded-full px-1.5 text-[10px] uppercase tracking-[0.18em]"
          style={{
            color: "var(--accent-put)",
            backgroundColor: "rgba(246, 135, 179, 0.12)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          blocked
        </span>
      ) : null}
    </motion.button>
  );
}

export default AlertCenter;
