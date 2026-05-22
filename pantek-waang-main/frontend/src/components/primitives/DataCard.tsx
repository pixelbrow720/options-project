import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  glow?: "brand" | "positive" | "negative" | null;
  className?: string;
  children: ReactNode;
}

export function DataCard({
  title,
  description,
  action,
  footer,
  glow = null,
  className,
  children,
}: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[hsl(var(--border-token))] bg-bg-card p-4",
        "transition-shadow hover:border-[hsl(var(--border-hover))]",
        glow === "brand" && "shadow-glow-brand",
        glow === "positive" && "shadow-glow-positive",
        glow === "negative" && "shadow-glow-negative",
        !glow && "shadow-card",
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            {title && <h3 className="text-sm font-medium text-fg-primary">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div>{children}</div>
      {footer && (
        <div className="mt-3 border-t border-[hsl(var(--border-token))] pt-3 text-xs text-fg-muted">
          {footer}
        </div>
      )}
    </div>
  );
}
