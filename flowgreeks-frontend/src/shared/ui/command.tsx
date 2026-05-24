import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "./dialog";
import { cn } from "@/shared/lib/cn";

/**
 * Command palette — cmd-k. Trader UIs live or die on keyboard speed.
 * This primitive renders the surface and keyboard navigation; the
 * actual command index is registered by the dashboard at runtime so
 * features can contribute commands without importing each other.
 */

export interface Command {
  id: string;
  label: string;
  /** Optional shortcut hint — e.g., ["g", "d"]. */
  hint?: string[];
  /** Optional category section header. */
  group?: string;
  run: () => void | Promise<void>;
}

interface CommandKProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  emptyState?: ReactNode;
}

export function CommandK({ open, onClose, commands, emptyState }: CommandKProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) || (c.group ?? "").toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  return (
    <Dialog open={open} onClose={onClose} label="Command palette" className="max-w-xl">
      <div className="flex flex-col gap-3" style={{ minWidth: 480 }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search commands…"
          aria-label="Search commands"
          className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent-indigo)]"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const cmd = filtered[active];
              if (cmd) {
                onClose();
                void cmd.run();
              }
            }
          }}
        />
        <ul className="max-h-[60dvh] overflow-auto scrollbar-thin">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--color-fg-muted)]">{emptyState ?? "no matches"}</li>
          ) : (
            filtered.map((cmd, i) => (
              <li key={cmd.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    void cmd.run();
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm",
                    i === active
                      ? "bg-[color:var(--color-accent-indigo)]/15 text-[var(--color-accent-indigo)]"
                      : "text-[var(--color-fg-primary)]",
                  )}
                >
                  <span className="flex flex-col items-start">
                    {cmd.group ? (
                      <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
                        {cmd.group}
                      </span>
                    ) : null}
                    <span>{cmd.label}</span>
                  </span>
                  {cmd.hint ? (
                    <span className="font-numeric text-xs text-[var(--color-fg-muted)]">
                      {cmd.hint.join(" + ")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </Dialog>
  );
}
