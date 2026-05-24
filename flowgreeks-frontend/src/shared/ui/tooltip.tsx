import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Tooltip primitives. Minimal, no Radix dep — Radix is fine but
 * shadcn's Radix-Tooltip wrapping costs ~6kb gzipped and every
 * dashboard pane uses tooltips, so we keep this hand-rolled.
 *
 * Accessibility: tooltips ARE NOT for critical info — same convention
 * as Radix. Always pair with an aria-label / visible context if the
 * content is necessary to act. The trigger element receives
 * `aria-describedby` pointing at the popover.
 */

interface TooltipContextValue {
  id: string;
  open: boolean;
  setOpen: (next: boolean) => void;
  delayMs: number;
}

const noopCtx: TooltipContextValue = {
  id: "",
  open: false,
  setOpen: () => undefined,
  delayMs: 200,
};

const Ctx = createContext<TooltipContextValue>(noopCtx);

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({
  children,
  delayMs = 200,
}: {
  children: ReactNode;
  delayMs?: number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ id, open, setOpen, delayMs }}>{children}</Ctx.Provider>;
}

export function TooltipTrigger({ children }: { children: ReactElement }) {
  const ctx = useContext(Ctx);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => ctx.setOpen(true), ctx.delayMs);
  };
  const close = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    ctx.setOpen(false);
  };

  if (!isValidElement<Record<string, unknown>>(children)) return children;
  return cloneElement(children, {
    onMouseEnter: open,
    onMouseLeave: close,
    onFocus: () => ctx.setOpen(true),
    onBlur: () => ctx.setOpen(false),
    "aria-describedby": ctx.open ? ctx.id : undefined,
  });
}

export function TooltipContent({
  children,
  side = "top",
  className,
}: {
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const ctx = useContext(Ctx);
  if (!ctx.open) return null;
  const positions: Record<string, string> = {
    top: "bottom-full mb-2 left-1/2 -translate-x-1/2",
    bottom: "top-full mt-2 left-1/2 -translate-x-1/2",
    left: "right-full mr-2 top-1/2 -translate-y-1/2",
    right: "left-full ml-2 top-1/2 -translate-y-1/2",
  };
  return (
    <span
      role="tooltip"
      id={ctx.id}
      className={cn(
        "pointer-events-none absolute z-[var(--z-tooltip)] whitespace-nowrap rounded-md px-2 py-1 text-xs",
        "border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]/95 backdrop-blur-md text-[var(--color-fg-primary)] shadow-[var(--shadow-floating)]",
        positions[side],
        className,
      )}
    >
      {children}
    </span>
  );
}
