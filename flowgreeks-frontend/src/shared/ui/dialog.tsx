import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Dialog primitive — built on the native <dialog> element.
 *
 * Why native: <dialog> gives us focus trapping, ESC-to-close, and the
 * ::backdrop pseudo-element for free, in <50 lines of code. Radix
 * Dialog adds 12kb gzipped of polyfill we don't need on a 2026 target
 * browser baseline. Backwards-compatibility floor is the same as Vite's
 * (Edge 110+, Firefox 110+, Safari 16+) — all support showModal().
 */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** ARIA label for screen readers when no visible title is present. */
  label?: string;
  className?: string;
}

export function Dialog({ open, onClose, children, label, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onCloseEvent = () => onClose();
    el.addEventListener("cancel", onCancel);
    el.addEventListener("close", onCloseEvent);
    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("close", onCloseEvent);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={cn(
        "glass-overlay m-auto max-w-lg p-0 text-[var(--color-fg-primary)] backdrop:bg-black/40 backdrop:backdrop-blur-sm",
        className,
      )}
      onClick={(e) => {
        // Click on the backdrop (target === dialog itself) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="p-6">{children}</div>
    </dialog>
  );
}
