import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TableProperties } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  decimalsFor,
  formatNumber,
  formatPct,
  formatPrice,
} from "@/lib/format";

export interface ChainCallPut {
  bid: number;
  ask: number;
  last?: number;
  volume: number;
  oi: number;
  iv: number;
  delta: number;
  gamma: number;
  vanna?: number | null;
  charm?: number | null;
}

export interface ChainRow {
  strike: number;
  call: ChainCallPut | null;
  put: ChainCallPut | null;
}

export interface OptionsChainTableProps {
  symbol: string;
  expiry: string | null;
  spot: number | null;
  rows: ChainRow[] | null;
  loading?: boolean;
  className?: string;
}

const SKELETON_KEYS = Array.from({ length: 14 }, (_, i) => `chain-row-${i}`);

interface PreparedRow {
  strike: number;
  call: ChainCallPut | null;
  put: ChainCallPut | null;
  callItm: boolean;
  putItm: boolean;
  isAtm: boolean;
}

/**
 * Format a price for the bid×ask cell. Uses 2 decimals consistently for option
 * premiums (those are quoted in dollars and cents).
 */
function fmtPrem(value: number | undefined | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function fmtIv(value: number | undefined | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  // IV may arrive as a fraction (0.21) or as percent (21). Heuristic: < 5 ⇒ fraction.
  const pct = Math.abs(value) < 5 ? value * 100 : value;
  return formatPct(pct, 1, false);
}

function fmtGreek(value: number | undefined | null, decimals = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(decimals);
}

function findAtmStrike(rows: ChainRow[], spot: number | null): number | null {
  if (!spot || rows.length === 0) return null;
  let best = rows[0].strike;
  let bestDiff = Math.abs(rows[0].strike - spot);
  for (let i = 1; i < rows.length; i += 1) {
    const diff = Math.abs(rows[i].strike - spot);
    if (diff < bestDiff) {
      best = rows[i].strike;
      bestDiff = diff;
    }
  }
  return best;
}

function CallSkeletonRow({ id }: { id: string }) {
  return (
    <tr
      key={id}
      style={{ borderTop: "1px solid var(--border-foid)" }}
    >
      {Array.from({ length: 13 }).map((_, idx) => (
        <td key={`${id}-${idx}`} className="px-2 py-1">
          <Skeleton className="h-3 w-full rounded" />
        </td>
      ))}
    </tr>
  );
}

function OptionsChainTableImpl({
  symbol,
  expiry,
  spot,
  rows,
  loading = false,
  className,
}: OptionsChainTableProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);

  const prepared = useMemo<PreparedRow[]>(() => {
    if (!rows || rows.length === 0) return [];
    const sorted = rows.slice().sort((a, b) => b.strike - a.strike);
    const atmStrike = findAtmStrike(sorted, spot);
    return sorted.map((r) => {
      const callItm = spot !== null ? r.strike < spot : false;
      const putItm = spot !== null ? r.strike > spot : false;
      return {
        strike: r.strike,
        call: r.call,
        put: r.put,
        callItm,
        putItm,
        isAtm: atmStrike !== null && r.strike === atmStrike,
      };
    });
  }, [rows, spot]);

  const showEmpty = !loading && prepared.length === 0;
  const subtitle = `${prepared.length} strikes · live OPRA`;

  const headerCellStyle = {
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono-foid)",
    borderBottom: "1px solid var(--border-foid)",
  } as const;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn("liquid-glass rounded-2xl p-4", className)}
    >
      <div className="flex flex-row items-baseline justify-between gap-3 px-1 pb-3">
        <div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Options Chain · {expiry ?? "—"}
          </div>
          <p
            className="mt-1.5 text-xs font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {prepared.length > 0 ? subtitle : "Live OPRA"}
          </p>
        </div>
        <div
          className="text-[10px] font-mono uppercase tracking-[0.18em]"
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          {symbol}
        </div>
      </div>

      <div>
        {showEmpty ? (
          <EmptyState
            icon={<TableProperties />}
            headline="Chain table loads during RTH."
            subline="Per-strike calls and puts populate here once the chain begins ticking."
            pad="md"
          />
        ) : (
          <div className="scrollbar-thin max-h-[480px] overflow-auto">
            <table
              className="w-full border-separate border-spacing-0 text-[11px] tabular-nums"
              style={{ fontFamily: "var(--font-mono-foid)" }}
            >
              <thead
                className="sticky top-0 z-20 text-[9px] uppercase tracking-[0.18em]"
                style={{
                  background: "rgba(0,0,0,0.5)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <tr>
                  {/* Calls side */}
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    style={headerCellStyle}
                  >
                    OI
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    style={headerCellStyle}
                  >
                    VOL
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    style={headerCellStyle}
                  >
                    IV
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    style={headerCellStyle}
                  >
                    δ
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    style={headerCellStyle}
                  >
                    Γ
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    style={headerCellStyle}
                  >
                    Bid
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    style={headerCellStyle}
                  >
                    Ask
                  </th>
                  {/* Strike */}
                  <th
                    className="px-2 py-1.5 text-center font-semibold"
                    style={{
                      ...headerCellStyle,
                      color: "var(--text-primary)",
                      borderLeft: "1px solid var(--border-foid)",
                      borderRight: "1px solid var(--border-foid)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    STRIKE
                  </th>
                  {/* Puts side */}
                  <th
                    className="px-2 py-1.5 text-left font-medium"
                    style={headerCellStyle}
                  >
                    Bid
                  </th>
                  <th
                    className="px-2 py-1.5 text-left font-medium"
                    style={headerCellStyle}
                  >
                    Ask
                  </th>
                  <th
                    className="px-2 py-1.5 text-left font-medium"
                    style={headerCellStyle}
                  >
                    Γ
                  </th>
                  <th
                    className="px-2 py-1.5 text-left font-medium"
                    style={headerCellStyle}
                  >
                    δ
                  </th>
                  <th
                    className="px-2 py-1.5 text-left font-medium"
                    style={headerCellStyle}
                  >
                    IV
                  </th>
                  <th
                    className="px-2 py-1.5 text-left font-medium"
                    style={headerCellStyle}
                  >
                    VOL
                  </th>
                  <th
                    className="px-2 py-1.5 text-left font-medium"
                    style={headerCellStyle}
                  >
                    OI
                  </th>
                </tr>
                <tr className="text-[9px] uppercase tracking-[0.18em]">
                  <th
                    colSpan={7}
                    className="px-2 py-1 text-right font-semibold text-[hsl(var(--emerald))]"
                    style={{
                      background: "hsl(var(--emerald) / 0.05)",
                      borderBottom: "1px solid var(--border-foid)",
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  >
                    Calls
                  </th>
                  <th
                    style={{
                      borderBottom: "1px solid var(--border-foid)",
                      borderLeft: "1px solid var(--border-foid)",
                      borderRight: "1px solid var(--border-foid)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  />
                  <th
                    colSpan={7}
                    className="px-2 py-1 text-left font-semibold text-[hsl(var(--rose))]"
                    style={{
                      background: "hsl(var(--rose) / 0.05)",
                      borderBottom: "1px solid var(--border-foid)",
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  >
                    Puts
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? SKELETON_KEYS.map((k) => <CallSkeletonRow key={k} id={k} />)
                  : prepared.map((row) => {
                      const c = row.call;
                      const p = row.put;
                      const rowBorderStyle = {
                        borderTop: "1px solid var(--border-foid)",
                      };
                      return (
                        <tr
                          key={row.strike}
                          className={cn(
                            "transition-colors hover:bg-white/[0.03]",
                            row.isAtm && "bg-white/[0.04]",
                          )}
                          style={rowBorderStyle}
                        >
                          {/* Calls (right-aligned, ITM tinted) */}
                          <td
                            className={cn(
                              "px-2 py-0.5 text-right",
                              row.callItm && "bg-[hsl(var(--emerald))]/5",
                            )}
                            style={{ color: "var(--text-muted)" }}
                          >
                            {c ? formatNumber(c.oi) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-right",
                              row.callItm && "bg-[hsl(var(--emerald))]/5",
                            )}
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {c ? formatNumber(c.volume) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-right text-[hsl(var(--amber))]",
                              row.callItm && "bg-[hsl(var(--emerald))]/5",
                            )}
                          >
                            {c ? fmtIv(c.iv) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-right",
                              row.callItm && "bg-[hsl(var(--emerald))]/5",
                            )}
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {c ? fmtGreek(c.delta, 2) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-right text-[hsl(var(--violet))]",
                              row.callItm && "bg-[hsl(var(--emerald))]/5",
                            )}
                          >
                            {c ? fmtGreek(c.gamma, 4) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-right text-[hsl(var(--emerald))]",
                              row.callItm && "bg-[hsl(var(--emerald))]/5",
                            )}
                          >
                            {c ? fmtPrem(c.bid) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-right",
                              row.callItm && "bg-[hsl(var(--emerald))]/5",
                            )}
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {c ? fmtPrem(c.ask) : "—"}
                          </td>

                          {/* Strike */}
                          <td
                            className={cn(
                              "px-2 py-0.5 text-center font-semibold",
                              row.isAtm &&
                                "bg-[hsl(var(--violet))]/15 text-[hsl(var(--violet))]",
                            )}
                            style={{
                              borderLeft: "1px solid var(--border-foid)",
                              borderRight: "1px solid var(--border-foid)",
                              background: row.isAtm
                                ? undefined
                                : "rgba(255,255,255,0.02)",
                              color: row.isAtm
                                ? undefined
                                : "var(--text-primary)",
                            }}
                          >
                            {formatPrice(row.strike, dec)}
                          </td>

                          {/* Puts (left-aligned, ITM tinted) */}
                          <td
                            className={cn(
                              "px-2 py-0.5 text-left text-[hsl(var(--rose))]",
                              row.putItm && "bg-[hsl(var(--rose))]/5",
                            )}
                          >
                            {p ? fmtPrem(p.bid) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-left",
                              row.putItm && "bg-[hsl(var(--rose))]/5",
                            )}
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {p ? fmtPrem(p.ask) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-left text-[hsl(var(--violet))]",
                              row.putItm && "bg-[hsl(var(--rose))]/5",
                            )}
                          >
                            {p ? fmtGreek(p.gamma, 4) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-left",
                              row.putItm && "bg-[hsl(var(--rose))]/5",
                            )}
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {p ? fmtGreek(p.delta, 2) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-left text-[hsl(var(--amber))]",
                              row.putItm && "bg-[hsl(var(--rose))]/5",
                            )}
                          >
                            {p ? fmtIv(p.iv) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-left",
                              row.putItm && "bg-[hsl(var(--rose))]/5",
                            )}
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {p ? formatNumber(p.volume) : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-0.5 text-left",
                              row.putItm && "bg-[hsl(var(--rose))]/5",
                            )}
                            style={{ color: "var(--text-muted)" }}
                          >
                            {p ? formatNumber(p.oi) : "—"}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const OptionsChainTable = memo(OptionsChainTableImpl);

export default OptionsChainTable;
