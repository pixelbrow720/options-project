import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TimeOfDayStripProps {
  /** Current time in ET. If null, the component computes ET from `Date.now()`. */
  nowEt: Date | null;
  loading?: boolean;
  className?: string;
}

interface SessionZone {
  id: "open" | "drift" | "charm" | "moc";
  label: string;
  start: number; // minutes from 09:30 ET
  end: number; // minutes from 09:30 ET
  fill: string;
  text: string;
}

// Session zones, expressed in minutes since 09:30 ET. Total RTH = 390 min.
const ZONES: SessionZone[] = [
  {
    id: "open",
    label: "Open",
    start: 0,
    end: 30,
    fill: "hsl(var(--cyan, 191 95% 56%) / 0.28)",
    text: "hsl(var(--cyan, 191 95% 56%))",
  },
  {
    id: "drift",
    label: "Drift",
    start: 30,
    end: 270,
    fill: "hsl(var(--muted-foreground) / 0.18)",
    text: "hsl(var(--muted-foreground))",
  },
  {
    id: "charm",
    label: "Charm spike",
    start: 270,
    end: 380,
    fill: "hsl(var(--amber) / 0.32)",
    text: "hsl(var(--amber))",
  },
  {
    id: "moc",
    label: "MOC",
    start: 380,
    end: 390,
    fill: "hsl(var(--rose) / 0.4)",
    text: "hsl(var(--rose))",
  },
];

const SESSION_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const SESSION_CLOSE_MIN = 16 * 60; // 16:00 ET
const SESSION_LENGTH_MIN = SESSION_CLOSE_MIN - SESSION_OPEN_MIN; // 390

interface ParsedEt {
  /** Minutes since midnight ET. */
  minutesOfDay: number;
  /** Day-of-week in ET, 0=Sun..6=Sat. */
  weekday: number;
  /** Hours / minutes for label rendering. */
  hours: number;
  minutes: number;
}

/**
 * Convert an arbitrary instant to minutes-of-day in ET. Falls back to
 * Intl.DateTimeFormat parts to avoid timezone-library deps.
 */
function toEtParts(input: Date): ParsedEt {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(input);
  let hour = 0;
  let minute = 0;
  let weekdayStr = "";
  for (const p of parts) {
    if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "weekday") weekdayStr = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[weekdayStr] ?? 0;
  return {
    minutesOfDay: hour * 60 + minute,
    weekday,
    hours: hour,
    minutes: minute,
  };
}

function activeZone(minutesSinceOpen: number): SessionZone | null {
  if (minutesSinceOpen < 0 || minutesSinceOpen > SESSION_LENGTH_MIN) return null;
  for (const z of ZONES) {
    if (minutesSinceOpen >= z.start && minutesSinceOpen < z.end) return z;
  }
  // Final tick: include MOC end
  if (minutesSinceOpen === SESSION_LENGTH_MIN) return ZONES[ZONES.length - 1];
  return null;
}

function formatHm(h: number, m: number): string {
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function TimeOfDayStrip({
  nowEt,
  loading = false,
  className,
}: TimeOfDayStripProps) {
  const reduce = useReducedMotion();

  // Re-render every 30s so the "now" indicator drifts smoothly without
  // requiring a parent to push updates. We bypass this if a `nowEt` prop is
  // provided, since the parent owns the clock in that case.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (nowEt) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [nowEt]);

  const parts = useMemo<ParsedEt>(() => {
    const base = nowEt ?? new Date();
    return toEtParts(base);
    // tick forces recompute when no nowEt is provided
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowEt, tick]);

  const minutesSinceOpen = parts.minutesOfDay - SESSION_OPEN_MIN;
  const inRth =
    parts.weekday >= 1 &&
    parts.weekday <= 5 &&
    minutesSinceOpen >= 0 &&
    minutesSinceOpen <= SESSION_LENGTH_MIN;
  const current = inRth ? activeZone(minutesSinceOpen) : null;

  const nowPct = inRth
    ? (minutesSinceOpen / SESSION_LENGTH_MIN) * 100
    : minutesSinceOpen < 0
      ? 0
      : 100;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn(className)}
    >
      <div className="liquid-glass overflow-hidden rounded-2xl p-5 sm:p-6">
        <div className="flex flex-row items-baseline justify-between gap-3">
          <div>
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Session timeline
            </div>
            <p
              className="mt-1 text-xs font-mono"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              0DTE behavior shifts by zone.
            </p>
          </div>
          {inRth && current ? (
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{
                color: current.text,
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              {current.label}
            </div>
          ) : (
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Closed
            </div>
          )}
        </div>
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-[40px] w-full rounded-md" />
          ) : (
            <>
              <div
                className="relative w-full overflow-hidden rounded-md"
                style={{
                  height: 36,
                  border: "1px solid var(--border-foid)",
                }}
                role="img"
                aria-label={
                  inRth && current
                    ? `Now in ${current.label} window at ${formatHm(parts.hours, parts.minutes)} ET`
                    : "Market closed"
                }
              >
                {ZONES.map((zone) => {
                  const left = (zone.start / SESSION_LENGTH_MIN) * 100;
                  const width =
                    ((zone.end - zone.start) / SESSION_LENGTH_MIN) * 100;
                  const isCurrent = current?.id === zone.id;
                  return (
                    <div
                      key={zone.id}
                      className={cn(
                        "absolute inset-y-0 flex items-center justify-center transition-all",
                        isCurrent ? "ring-1 ring-inset" : "",
                      )}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: zone.fill,
                      }}
                    >
                      <span
                        className={cn(
                          "truncate px-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-opacity",
                          isCurrent ? "opacity-100" : "opacity-70",
                        )}
                        style={{
                          color: zone.text,
                          fontFamily: "var(--font-mono-foid)",
                        }}
                      >
                        {zone.label}
                      </span>
                    </div>
                  );
                })}

                {inRth ? (
                  <motion.div
                    aria-hidden
                    initial={false}
                    animate={{ left: `${nowPct}%` }}
                    transition={{ duration: reduce ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-y-0 z-10 w-[2px] -translate-x-1/2"
                    style={{ backgroundColor: "var(--text-primary)" }}
                  >
                    {!reduce ? (
                      <motion.span
                        className="absolute left-1/2 top-1/2 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ backgroundColor: "var(--text-primary)" }}
                        animate={{ scale: [1, 1.6, 1], opacity: [0.9, 0.2, 0.9] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ) : (
                      <span
                        className="absolute left-1/2 top-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ backgroundColor: "var(--text-primary)" }}
                      />
                    )}
                  </motion.div>
                ) : null}
              </div>

              <div
                className="mt-2 flex items-center justify-between text-[10px] font-mono tabular-nums"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                <span>09:30 ET</span>
                <span>12:00</span>
                <span>14:00</span>
                <span>16:00 ET</span>
              </div>

              {!inRth ? (
                <p
                  className="mt-3 text-xs font-mono"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Market closed · resumes at 09:30 ET tomorrow
                </p>
              ) : (
                <p
                  className="mt-3 text-xs font-mono"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Now {formatHm(parts.hours, parts.minutes)} ET ·{" "}
                  <span style={{ color: current?.text }}>
                    {current?.label ?? ""}
                  </span>{" "}
                  zone
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default TimeOfDayStrip;
