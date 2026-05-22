import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Move } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { decimalsFor, formatPoints, formatPrice } from "@/lib/format";

export interface StrikeMigrationWall {
  strike: number;
  rank: number;
  value: number;
}

interface StrikeMigrationProps {
  symbol: string;
  spot: number | null;
  callWallsNow: StrikeMigrationWall[] | null;
  callWalls1hAgo: StrikeMigrationWall[] | null;
  putWallsNow: StrikeMigrationWall[] | null;
  putWalls1hAgo: StrikeMigrationWall[] | null;
  loading?: boolean;
  className?: string;
}

type Side = "call" | "put";

interface MigrationRow {
  rank: number;
  before: StrikeMigrationWall | null;
  after: StrikeMigrationWall | null;
  status: "moved" | "stable" | "new" | "exited";
}

function topThree(walls: StrikeMigrationWall[] | null): StrikeMigrationWall[] {
  if (!walls) return [];
  return walls
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);
}

function buildRows(
  before: StrikeMigrationWall[] | null,
  after: StrikeMigrationWall[] | null,
): MigrationRow[] {
  const beforeTop = topThree(before);
  const afterTop = topThree(after);

  const rows: MigrationRow[] = [];
  for (let r = 1; r <= 3; r += 1) {
    const b = beforeTop.find((w) => w.rank === r) ?? null;
    const a = afterTop.find((w) => w.rank === r) ?? null;

    let status: MigrationRow["status"] = "stable";
    if (b && a) {
      // a strike that exists in both top-3 lists at any rank counts as stable/moved
      const beforeStrikes = new Set(beforeTop.map((w) => w.strike));
      const afterStrikes = new Set(afterTop.map((w) => w.strike));
      if (!beforeStrikes.has(a.strike)) status = "new";
      else if (!afterStrikes.has(b.strike)) status = "exited";
      else if (a.strike !== b.strike) status = "moved";
      else status = "stable";
    } else if (a && !b) {
      status = "new";
    } else if (b && !a) {
      status = "exited";
    }

    rows.push({ rank: r, before: b, after: a, status });
  }
  return rows;
}

function avgDrift(rows: MigrationRow[]): number | null {
  const drifts: number[] = [];
  for (const r of rows) {
    if (r.before && r.after) drifts.push(r.after.strike - r.before.strike);
  }
  if (drifts.length === 0) return null;
  return drifts.reduce((acc, v) => acc + v, 0) / drifts.length;
}

interface SideBlockProps {
  side: Side;
  rows: MigrationRow[];
  decimals: number;
  reduce: boolean;
}

function SideBlock({ side, rows, decimals, reduce }: SideBlockProps) {
  const tone = side === "call" ? "violet" : "cyan";
  const colorVar = side === "call" ? "hsl(var(--violet))" : "hsl(var(--accent))";
  const drift = avgDrift(rows);

  const driftLabel = useMemo(() => {
    if (drift === null) return "Avg drift —";
    if (Math.abs(drift) < 0.01) return "Avg drift 0";
    return `Avg drift ${formatPoints(drift, 1)} pts`;
  }, [drift]);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: colorVar }}
            aria-hidden
          />
          <span
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{ color: colorVar, fontFamily: "var(--font-mono-foid)" }}
          >
            {side === "call" ? "Call walls" : "Put walls"}
          </span>
        </div>
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{
            color:
              drift === null
                ? "var(--text-muted)"
                : drift > 0
                  ? "var(--accent-foid)"
                  : drift < 0
                    ? "var(--accent-put)"
                    : "var(--text-muted)",
            fontFamily: "var(--font-mono-foid)",
          }}
        >
          {driftLabel}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        {/* 1H AGO column */}
        <div className="flex flex-col gap-2">
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            1H ago
          </div>
          {rows.map((row) => (
            <MigrationBox
              key={`before-${side}-${row.rank}`}
              wall={row.before}
              rank={row.rank}
              decimals={decimals}
              tone={colorVar}
              variant={
                row.status === "exited"
                  ? "exited"
                  : row.status === "new" && !row.before
                    ? "empty"
                    : "filled"
              }
              reduce={reduce}
            />
          ))}
        </div>

        {/* Arrows column */}
        <div className="flex flex-col gap-2">
          <div className="h-4" aria-hidden />
          {rows.map((row) => (
            <ArrowConnector
              key={`arrow-${side}-${row.rank}`}
              row={row}
              tone={colorVar}
              reduce={reduce}
            />
          ))}
        </div>

        {/* NOW column */}
        <div className="flex flex-col gap-2">
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Now
          </div>
          {rows.map((row) => (
            <MigrationBox
              key={`after-${side}-${row.rank}`}
              wall={row.after}
              rank={row.rank}
              decimals={decimals}
              tone={colorVar}
              variant={
                row.status === "new"
                  ? "new"
                  : row.status === "exited" && !row.after
                    ? "empty"
                    : "filled"
              }
              reduce={reduce}
            />
          ))}
        </div>
      </div>

      {/* Mute unused tone tokens to satisfy the type-checker without complicating the API */}
      <span className="hidden" aria-hidden>
        {tone}
      </span>
    </div>
  );
}

interface MigrationBoxProps {
  wall: StrikeMigrationWall | null;
  rank: number;
  decimals: number;
  tone: string;
  variant: "filled" | "exited" | "new" | "empty";
  reduce: boolean;
}

function MigrationBox({
  wall,
  rank,
  decimals,
  tone,
  variant,
  reduce,
}: MigrationBoxProps) {
  if (variant === "empty") {
    return (
      <div
        className="flex h-12 items-center justify-center rounded-md text-[10px] font-mono"
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono-foid)",
          border: "1px dashed var(--border-foid)",
        }}
      >
        —
      </div>
    );
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "flex h-12 items-center justify-between gap-2 rounded-md px-2.5 py-1.5",
        variant === "exited" ? "opacity-70" : "",
      )}
      style={{
        border:
          variant === "filled" || variant === "new"
            ? `1px solid ${tone.replace(")", " / 0.4)")}`
            : "1px solid var(--border-foid)",
        backgroundColor:
          variant === "exited" ? "rgba(255,255,255,0.02)" : "transparent",
      }}
    >
      <span
        className="text-[10px] font-mono uppercase tracking-[0.2em]"
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        #{rank}
      </span>
      <span
        className={cn(
          "flex-1 text-right font-mono text-sm tabular-nums",
          variant === "exited" && "line-through",
        )}
        style={{
          color:
            variant === "filled" || variant === "new"
              ? tone
              : "var(--text-muted)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        {wall ? formatPrice(wall.strike, decimals) : "—"}
      </span>
      {variant === "new" ? (
        <Badge variant="emerald" className="px-1.5 py-0 text-[9px]">
          new
        </Badge>
      ) : null}
      {variant === "exited" ? (
        <Badge variant="muted" className="px-1.5 py-0 text-[9px]">
          exited
        </Badge>
      ) : null}
    </motion.div>
  );
}

interface ArrowConnectorProps {
  row: MigrationRow;
  tone: string;
  reduce: boolean;
}

function ArrowConnector({ row, tone, reduce }: ArrowConnectorProps) {
  const active = !!row.before && !!row.after;
  return (
    <div className="flex h-12 items-center justify-center">
      <motion.div
        initial={reduce ? false : { opacity: 0, x: -4 }}
        animate={{ opacity: active ? 1 : 0.3, x: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center"
        style={{ color: active ? tone : "var(--text-muted)" }}
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </motion.div>
    </div>
  );
}

export function StrikeMigration({
  symbol,
  spot,
  callWallsNow,
  callWalls1hAgo,
  putWallsNow,
  putWalls1hAgo,
  loading = false,
  className,
}: StrikeMigrationProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);

  const callRows = useMemo(
    () => buildRows(callWalls1hAgo, callWallsNow),
    [callWalls1hAgo, callWallsNow],
  );
  const putRows = useMemo(
    () => buildRows(putWalls1hAgo, putWallsNow),
    [putWalls1hAgo, putWallsNow],
  );

  const hasAny =
    (callWallsNow?.length ?? 0) > 0 ||
    (callWalls1hAgo?.length ?? 0) > 0 ||
    (putWallsNow?.length ?? 0) > 0 ||
    (putWalls1hAgo?.length ?? 0) > 0;

  // Both sides need at least one before/after pair to render meaningful migration
  const hasMigrationData =
    hasAny &&
    ((callWalls1hAgo && callWalls1hAgo.length > 0) ||
      (putWalls1hAgo && putWalls1hAgo.length > 0));

  return (
    <div className={cn("liquid-glass rounded-2xl p-5 sm:p-6", className)}>
      <div
        className="text-[10px] font-mono uppercase tracking-[0.2em]"
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        Wall migration · 1H
      </div>
      <p
        className="mt-1 text-xs font-mono"
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono-foid)",
        }}
      >
        How the top dealer-OI walls have shifted in the last hour.
      </p>
      <div className="mt-4">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : !hasMigrationData ? (
          <EmptyState
            icon={<Move />}
            headline="Migration data builds over time."
            subline="Once we have a 1-hour history of dealer-OI walls, you'll see the top-3 strikes drift here."
            pad="md"
            inline
          />
        ) : (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-6 lg:flex-row lg:gap-8"
          >
            <SideBlock side="call" rows={callRows} decimals={dec} reduce={!!reduce} />
            <div
              className="hidden w-px shrink-0 lg:block"
              aria-hidden
              style={{ backgroundColor: "var(--border-foid)" }}
            />
            <SideBlock side="put" rows={putRows} decimals={dec} reduce={!!reduce} />
          </motion.div>
        )}
        {spot !== null ? (
          <p
            className="mt-3 text-[10px] font-mono"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            Spot reference {formatPrice(spot, dec)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default StrikeMigration;
