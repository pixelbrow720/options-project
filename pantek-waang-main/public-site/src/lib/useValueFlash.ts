import { useEffect, useRef, useState } from "react";

export type FlashTone = "neutral" | "up" | "down";

/**
 * Hook that emits a short flash tone whenever `value` changes. Returns the
 * current flash and a `key` that callers can pass to AnimatePresence /
 * motion to re-trigger an animation cleanly.
 *
 * The flash tone is `up` when value increases, `down` when it decreases,
 * and `neutral` for first-render or non-numeric changes.
 */
export function useValueFlash(value: number | null | undefined, durationMs = 600): {
  flash: FlashTone | null;
  pulseKey: number;
} {
  const previous = useRef<number | null | undefined>(value);
  const [flash, setFlash] = useState<FlashTone | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    const prev = previous.current;
    if (
      value === null ||
      value === undefined ||
      Number.isNaN(value) ||
      prev === value
    ) {
      previous.current = value;
      return;
    }
    let next: FlashTone = "neutral";
    if (typeof prev === "number" && Number.isFinite(prev)) {
      if (value > prev) next = "up";
      else if (value < prev) next = "down";
      else next = "neutral";
    }
    previous.current = value;
    setFlash(next);
    setPulseKey((k) => k + 1);
    const id = window.setTimeout(() => setFlash(null), durationMs);
    return () => window.clearTimeout(id);
  }, [value, durationMs]);

  return { flash, pulseKey };
}
