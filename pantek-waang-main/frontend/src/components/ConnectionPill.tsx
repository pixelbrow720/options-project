import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/lib/streamClient";

const LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  reconnecting: "Reconnecting",
  closed: "Offline",
  error: "Error",
  "auth-failed": "Auth revoked",
};

const COLOR: Record<ConnectionStatus, string> = {
  connecting: "bg-flip",
  open: "bg-positive",
  reconnecting: "bg-flip",
  closed: "bg-fg-faint",
  error: "bg-negative",
  "auth-failed": "bg-negative",
};

const RING: Record<ConnectionStatus, string> = {
  connecting: "shadow-[0_0_8px_hsl(var(--flip)_/_0.7)]",
  open: "shadow-[0_0_10px_hsl(var(--positive)_/_0.7)]",
  reconnecting: "shadow-[0_0_8px_hsl(var(--flip)_/_0.7)]",
  closed: "",
  error: "shadow-[0_0_8px_hsl(var(--negative)_/_0.7)]",
  "auth-failed": "shadow-[0_0_8px_hsl(var(--negative)_/_0.7)]",
};

export function ConnectionPill({
  status,
  lastFrameAt,
}: {
  status: ConnectionStatus;
  lastFrameAt: number | null;
}) {
  const [ageSec, setAgeSec] = useState<number | null>(
    lastFrameAt ? Math.floor((Date.now() - lastFrameAt) / 1000) : null,
  );

  useEffect(() => {
    if (lastFrameAt === null) {
      setAgeSec(null);
      return;
    }
    const tick = () => setAgeSec(Math.floor((Date.now() - lastFrameAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lastFrameAt]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="flex h-8 items-center gap-2 rounded-md border border-border-subtle bg-bg-card px-2.5 text-xs"
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          COLOR[status],
          RING[status],
          status === "open" && "pulse-soft",
        )}
      />
      <span className="font-medium text-fg-primary">{LABEL[status]}</span>
      {ageSec !== null && status === "open" && (
        <span className="border-l border-border-subtle pl-2 font-mono text-fg-muted tabular-nums">
          {ageSec}s
        </span>
      )}
    </motion.div>
  );
}
