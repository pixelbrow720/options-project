import { useEffect, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Sheet — slide-in side panel for filters, settings, key admin. Built
 * with framer-motion on the consumer side later; this primitive is
 * structural only (open/close state, scrim, escape handler).
 *
 * Side rails attach from "right" by default — the right edge is where
 * trader workflows expect "this session's controls" (Bloomberg habit).
 */

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: "right" | "left" | "bottom";
  children: ReactNode;
  className?: string;
  label?: string;
}

export function Sheet({ open, onClose, side = "right", children, className, label }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const positions: Record<NonNullable<SheetProps["side"]>, string> = {
    right: "top-0 right-0 h-dvh w-[420px] border-l",
    left: "top-0 left-0 h-dvh w-[420px] border-r",
    bottom: "bottom-0 left-0 right-0 h-[60dvh] border-t",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[var(--z-overlay)]"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />
      <aside
        className={cn(
          "glass-raised absolute border-[var(--color-border-subtle)]",
          positions[side],
          className,
        )}
      >
        {children}
      </aside>
    </div>
  );
}
