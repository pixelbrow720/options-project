import { cn } from "@/shared/lib/cn";
import type { HTMLAttributes } from "react";

/**
 * Skeleton — non-shimmer pulse. Subtle on dark surfaces. The loud
 * shimmer animation seen in many libraries is too distracting next to
 * a live trade tape, so we use opacity pulse instead.
 */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md",
        "bg-[var(--color-bg-raised)]",
        "before:absolute before:inset-0 before:animate-pulse before:bg-[color:var(--color-border-subtle)]",
        className,
      )}
      aria-hidden="true"
      {...rest}
    />
  );
}
