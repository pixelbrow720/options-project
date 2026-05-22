import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  headline: string;
  subline?: React.ReactNode;
  /** Vertical padding helper. Defaults to "md" (~12rem). */
  pad?: "sm" | "md" | "lg";
  /** Inline (no card chrome) — when consumer already provides its own card. */
  inline?: boolean;
  /** Optional minimum height in px to keep layout stable. */
  minHeight?: number;
  className?: string;
}

const PAD_CLASS: Record<NonNullable<EmptyStateProps["pad"]>, string> = {
  sm: "py-10",
  md: "py-16",
  lg: "py-24",
};

/**
 * Friendly empty state with icon + headline + subline. Used when data has
 * loaded but is empty (pre-market, awaiting first compute, etc).
 */
export function EmptyState({
  icon,
  headline,
  subline,
  pad = "md",
  inline = false,
  minHeight,
  className,
}: EmptyStateProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        !inline && "px-6",
        PAD_CLASS[pad],
        className,
      )}
      style={minHeight ? { minHeight } : undefined}
    >
      {icon ? (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-muted/60 text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
      ) : null}
      <div className="text-sm font-semibold text-foreground/90">{headline}</div>
      {subline ? (
        <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {subline}
        </div>
      ) : null}
    </motion.div>
  );
}
