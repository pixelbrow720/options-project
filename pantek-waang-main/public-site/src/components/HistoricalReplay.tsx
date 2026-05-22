import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Pause, Play, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SeriesPoint {
  ts: string;
}

interface HistoricalReplayProps {
  symbol: string;
  series: SeriesPoint[] | null;
  /** Called when the user scrubs. Pass `null` for live mode. */
  onSeek: (ts: string | null) => void;
  /** Currently selected ts; `null` means live. */
  currentSeekTs: string | null;
  loading?: boolean;
  className?: string;
}

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "America/New_York",
});

function formatEt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${ET_FORMATTER.format(d)} ET`;
}

function findIndexForTs(series: SeriesPoint[], ts: string | null): number {
  if (!ts) return series.length - 1;
  const exact = series.findIndex((p) => p.ts === ts);
  if (exact >= 0) return exact;
  // Fall back to nearest by epoch
  const target = new Date(ts).getTime();
  if (Number.isNaN(target)) return series.length - 1;
  let bestIdx = series.length - 1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < series.length; i += 1) {
    const t = new Date(series[i].ts).getTime();
    const delta = Math.abs(t - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function HistoricalReplay({
  symbol,
  series,
  onSeek,
  currentSeekTs,
  loading = false,
  className,
}: HistoricalReplayProps) {
  const reduce = useReducedMotion();
  const points = useMemo(() => series ?? [], [series]);
  const lastIdx = Math.max(0, points.length - 1);

  const seekIdx = useMemo(
    () => (points.length === 0 ? 0 : findIndexForTs(points, currentSeekTs)),
    [points, currentSeekTs],
  );

  const isLive = currentSeekTs === null || seekIdx >= lastIdx;

  const [isPlaying, setIsPlaying] = useState(false);
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop play if data runs out or we leave live during play near end
  useEffect(() => {
    return () => {
      if (playTimer.current) {
        clearInterval(playTimer.current);
        playTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (playTimer.current) {
        clearInterval(playTimer.current);
        playTimer.current = null;
      }
      return;
    }
    if (points.length === 0 || lastIdx <= 0) {
      // No data, or only a single point — playback is meaningless.
      setIsPlaying(false);
      return;
    }
    playTimer.current = setInterval(() => {
      const currentIdx = findIndexForTs(points, currentSeekTs);
      const nextIdx = currentIdx + 1;
      if (nextIdx >= lastIdx) {
        // reached the end -> live
        onSeek(null);
        setIsPlaying(false);
        return;
      }
      onSeek(points[nextIdx].ts);
    }, 500);
    return () => {
      if (playTimer.current) {
        clearInterval(playTimer.current);
        playTimer.current = null;
      }
    };
  }, [isPlaying, points, currentSeekTs, lastIdx, onSeek]);

  function handleTogglePlay() {
    if (points.length === 0) return;
    setIsPlaying((p) => !p);
  }

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (points.length === 0) return;
    const idx = Number(e.target.value);
    if (Number.isNaN(idx)) return;
    if (idx >= lastIdx) {
      onSeek(null);
      return;
    }
    onSeek(points[idx].ts);
  }

  function handleGoLive() {
    onSeek(null);
    setIsPlaying(false);
  }

  if (loading) {
    return (
      <div className={cn("liquid-glass rounded-2xl p-5 sm:p-6", className)}>
        <div
          className="text-[10px] font-mono uppercase tracking-[0.2em]"
          style={{
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          Replay
        </div>
        <p
          className="mt-1 text-xs font-mono"
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          Scrub through today's session.
        </p>
        <div className="mt-4">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  const noData = points.length === 0;
  const currentDisplayTs = isLive
    ? points[lastIdx]?.ts ?? null
    : points[seekIdx]?.ts ?? currentSeekTs;

  return (
    <div className={cn("liquid-glass rounded-2xl p-5 sm:p-6", className)}>
      <div
        className="text-[10px] font-mono uppercase tracking-[0.2em]"
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        Replay
      </div>
      <p
        className="mt-1 text-xs font-mono"
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        Scrub through today's session.
      </p>
      <div className="mt-4">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-3"
        >
          {/* Play/Pause */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTogglePlay}
            disabled={noData}
            aria-label={isPlaying ? "Pause replay" : "Play replay"}
            className="h-8 w-8 shrink-0 rounded-full p-0"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5 translate-x-[1px]" aria-hidden />
            )}
          </Button>

          {/* Slider */}
          <div className="flex-1">
            <input
              type="range"
              min={0}
              max={Math.max(0, lastIdx)}
              step={1}
              value={seekIdx}
              onChange={handleSliderChange}
              disabled={noData}
              aria-label="Session timeline scrubber"
              className={cn(
                "h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none",
                "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5",
                "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
                "[&::-webkit-slider-thumb]:shadow",
                "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110",
                "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5",
                "[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full",
                "[&::-moz-range-thumb]:border-0",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "focus-visible:ring-2",
              )}
              style={{
                backgroundColor: "var(--border-foid)",
              }}
            />
          </div>

          {/* Current ts + LIVE indicator/pill */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-right">
              <div
                className="font-mono text-xs tabular-nums"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                {noData ? "—" : formatEt(currentDisplayTs)}
              </div>
              <div
                className="text-[10px] font-mono uppercase tracking-[0.18em]"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                {symbol}
              </div>
            </div>
            {isLive ? (
              <div
                className="liquid-glass inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em]"
                style={{
                  color: "var(--accent-foid)",
                  fontFamily: "var(--font-mono-foid)",
                }}
                aria-label="Live"
              >
                <motion.span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--accent-foid)" }}
                  animate={
                    reduce
                      ? undefined
                      : { opacity: [0.4, 1, 0.4] }
                  }
                  transition={{ duration: 1.4, repeat: Infinity }}
                  aria-hidden
                />
                Live
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGoLive}
                className="h-7 gap-1 px-2 text-[10px] font-mono uppercase tracking-[0.18em]"
              >
                <Radio className="h-3 w-3" aria-hidden />
                Live
              </Button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default HistoricalReplay;
