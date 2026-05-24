import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Premium card primitive — surface ladder, subtle border-color shift on
 * hover, optional accent glow on the top border. Builds on the
 * design-token system (no hard-coded colors).
 *
 * Variants:
 *   default      — standard card
 *   accent       — subtle violet sheen on the top edge (key metric)
 *   positive     — emerald glow (long-gamma, bullish)
 *   negative     — rose glow (short-gamma, bearish)
 */

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "accent" | "positive" | "negative";
  interactive?: boolean;
  /** Mount animation toggle (defaults true). */
  animate?: boolean;
}

const VARIANT_GLOW: Record<NonNullable<SurfaceCardProps["variant"]>, string> = {
  default: "",
  accent: "before:bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,hsl(var(--accent)/0.18),transparent_60%)]",
  positive:
    "before:bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,hsl(var(--positive)/0.14),transparent_60%)]",
  negative:
    "before:bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,hsl(var(--negative)/0.14),transparent_60%)]",
};

export function SurfaceCard({
  children,
  className,
  variant = "default",
  interactive = false,
  animate = true,
}: SurfaceCardProps) {
  const Component = animate ? motion.div : "div";
  const animateProps = animate
    ? {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
      }
    : {};
  return (
    <Component
      {...animateProps}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border-subtle bg-bg-card shadow-card",
        "before:absolute before:inset-0 before:pointer-events-none before:opacity-90",
        VARIANT_GLOW[variant],
        interactive &&
          "transition-colors duration-base ease-out hover:border-border-hover hover:bg-bg-card-hover",
        className,
      )}
    >
      <div className="relative">{children}</div>
    </Component>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({
  title,
  subtitle,
  badge,
  action,
  className,
}: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
            {title}
          </h3>
          {badge}
        </div>
        {subtitle && (
          <div className="mt-1 text-xs text-fg-muted">{subtitle}</div>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "border-t border-border-subtle/60 bg-bg-elevated/40 px-5 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Big number tile ────────────────────────────────────────────────────────

export interface MetricTileProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number | null;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "flip";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const TONE: Record<NonNullable<MetricTileProps["tone"]>, string> = {
  default: "text-fg-primary",
  positive: "text-positive",
  negative: "text-negative",
  flip: "text-flip",
};

const SIZE: Record<NonNullable<MetricTileProps["size"]>, string> = {
  sm: "text-metric-md",
  md: "text-metric-lg",
  lg: "text-metric-xl",
  xl: "text-metric-2xl",
};

export function MetricTile({
  label,
  value,
  unit,
  delta,
  hint,
  tone = "default",
  size = "md",
  className,
}: MetricTileProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-muted">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-display font-semibold tabular-nums",
            SIZE[size],
            TONE[tone],
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-sm font-medium text-fg-muted tabular-nums">
            {unit}
          </span>
        )}
        {delta !== undefined && delta !== null && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              delta >= 0
                ? "bg-positive-soft text-positive"
                : "bg-negative-soft text-negative",
            )}
          >
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(2)}%
          </span>
        )}
      </div>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </div>
  );
}
