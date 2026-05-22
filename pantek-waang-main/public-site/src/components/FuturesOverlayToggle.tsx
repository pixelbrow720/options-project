import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatPoints } from "@/lib/format";

interface FuturesOverlayToggleProps {
  value: "cash" | "futures";
  onChange: (next: "cash" | "futures") => void;
  cashLabel: string;
  futuresLabel: string;
  basis: number | null;
  className?: string;
  /** Optional id used to keep the slide indicator unique when multiple toggles render. */
  layoutIdKey?: string;
}

export function FuturesOverlayToggle({
  value,
  onChange,
  cashLabel,
  futuresLabel,
  basis,
  className,
  layoutIdKey,
}: FuturesOverlayToggleProps) {
  const reduce = useReducedMotion();
  // When no explicit key is provided, fall back to a per-instance React id so
  // multiple toggles on the same page don't collide on framer-motion's
  // layoutId (which would cause the indicator to animate between toggles).
  const autoId = useId();
  const indicatorLayoutId = `${layoutIdKey ?? `futures-overlay-toggle-${autoId}`}-indicator`;

  const basisText =
    basis === null || Number.isNaN(basis) ? null : formatPoints(basis, 0, true);

  return (
    <div
      role="group"
      aria-label="Price source"
      className={cn(
        "liquid-glass relative inline-flex items-center rounded-full p-0.5",
        className,
      )}
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      <ToggleHalf
        active={value === "cash"}
        onClick={() => onChange("cash")}
        layoutId={indicatorLayoutId}
        reduce={!!reduce}
        ariaLabel={`Show cash price (${cashLabel})`}
      >
        <span className="relative z-10 text-[11px] tabular-nums tracking-wider">
          {cashLabel}
        </span>
      </ToggleHalf>
      <ToggleHalf
        active={value === "futures"}
        onClick={() => onChange("futures")}
        layoutId={indicatorLayoutId}
        reduce={!!reduce}
        ariaLabel={`Show futures price (${futuresLabel})`}
      >
        <span className="relative z-10 inline-flex items-baseline gap-1 text-[11px] tabular-nums tracking-wider">
          <span>{futuresLabel}</span>
          {basisText ? (
            <sup
              className="text-[9px] font-medium leading-none"
              style={{
                color:
                  value === "futures"
                    ? "var(--accent-foid)"
                    : "var(--text-muted)",
              }}
              aria-label={`Basis ${basisText}`}
            >
              {basisText}
            </sup>
          ) : null}
        </span>
      </ToggleHalf>
    </div>
  );
}

interface ToggleHalfProps {
  active: boolean;
  onClick: () => void;
  layoutId: string;
  reduce: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}

function ToggleHalf({
  active,
  onClick,
  layoutId,
  reduce,
  ariaLabel,
  children,
}: ToggleHalfProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center justify-center rounded-full px-3 py-1.5 transition-colors uppercase",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-offset-0",
      )}
      style={{
        color: active ? "var(--accent-foid)" : "var(--text-secondary)",
      }}
    >
      {active ? (
        <motion.span
          layoutId={layoutId}
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", bounce: 0.2, duration: 0.4 }
          }
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "color-mix(in srgb, var(--bg) 60%, transparent)",
            border: "1px solid var(--border-foid-strong)",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,0.06)",
          }}
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}

export default FuturesOverlayToggle;
