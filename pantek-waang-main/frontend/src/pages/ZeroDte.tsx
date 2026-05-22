import { useEffect, useMemo, useState } from "react";
import { ConnectionStatusIndicator } from "@/components/live/ConnectionStatus";
import { GexChart } from "@/components/live/GexChart";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FuturesLevels,
  type FuturesKeyLevel,
  type FuturesKeyLevelKind,
  type FuturesLevelsSnapshot,
} from "@/lib/api";
import {
  LiveSnapshotProvider,
  setStoredApiKey,
  useLiveSnapshot,
  type GexStrike,
  type SpotSource,
} from "@/lib/streamClient";

// ── Symbol-specific formatting ────────────────────────────────────────────

const SUPPORTED_SYMBOLS = ["SPXW", "NDXP"] as const;

function priceDecimals(symbol: string): number {
  return symbol === "NDXP" ? 2 : 4;
}

const tabular = { fontVariantNumeric: "tabular-nums" } as const;

// ── Number formatters ─────────────────────────────────────────────────────

const signedFmt = new Intl.NumberFormat("en-US", {
  signDisplay: "exceptZero",
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

const signedIntFmt = new Intl.NumberFormat("en-US", {
  signDisplay: "exceptZero",
  maximumFractionDigits: 0,
});

function formatPrice(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatGex(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function formatSignedDistance(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  // Use a typographic minus for negatives, ASCII '+' for positives.
  return value < 0
    ? `−${signedFmt.format(Math.abs(value)).replace(/^[+-]/, "")}`
    : signedFmt.format(value);
}

function formatSignedInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value < 0
    ? `−${signedIntFmt.format(Math.abs(value)).replace(/^[+-]/, "")}`
    : signedIntFmt.format(value);
}

// ── Level color tokens ────────────────────────────────────────────────────

const KIND_COLORS: Record<FuturesKeyLevelKind, { text: string; bg: string; border: string; tick: string }> = {
  flip: {
    text: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/40",
    tick: "bg-violet-400",
  },
  wall_call: {
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    tick: "bg-emerald-400",
  },
  wall_put: {
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/40",
    tick: "bg-rose-400",
  },
  max_pain: {
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    tick: "bg-amber-400",
  },
  gex_pos: {
    text: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/40",
    tick: "bg-teal-400",
  },
  gex_neg: {
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/40",
    tick: "bg-rose-400",
  },
};

const SOURCE_PILL: Record<string, { text: string; bg: string; border: string; label: string }> = {
  futures_basis: {
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
    label: "futures_basis",
  },
  parity: {
    text: "text-amber-300",
    bg: "bg-amber-500/15",
    border: "border-amber-500/40",
    label: "parity",
  },
  stale_cache: {
    text: "text-rose-300",
    bg: "bg-rose-500/15",
    border: "border-rose-500/40",
    label: "stale_cache",
  },
};

function sourcePill(source: SpotSource | string | null | undefined) {
  if (!source) {
    return (
      <span
        className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground"
      >
        unknown
      </span>
    );
  }
  const conf = SOURCE_PILL[source] ?? SOURCE_PILL.parity;
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${conf.border} ${conf.bg} ${conf.text}`}
    >
      {conf.label}
    </span>
  );
}

// ── Inner page ────────────────────────────────────────────────────────────

function ZeroDteInner() {
  const { symbol, apiKey, setSymbol, setApiKey, snapshot, status, lastFrameAt } =
    useLiveSnapshot();

  const [draftKey, setDraftKey] = useState<string>(apiKey);
  useEffect(() => setDraftKey(apiKey), [apiKey]);

  const [futures, setFutures] = useState<FuturesLevelsSnapshot | null>(null);
  const [futuresError, setFuturesError] = useState<string | null>(null);
  const [futuresLoading, setFuturesLoading] = useState<boolean>(false);

  // Refresh futures-levels every 30s; cancel on unmount / symbol / key change.
  useEffect(() => {
    if (!symbol || !apiKey) {
      setFutures(null);
      setFuturesError(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      try {
        setFuturesLoading(true);
        const data = await FuturesLevels.load(symbol, apiKey);
        if (!cancelled) {
          setFutures(data);
          setFuturesError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load futures levels";
          setFuturesError(msg);
        }
      } finally {
        if (!cancelled) setFuturesLoading(false);
      }
    };

    fetchOnce();
    timer = setInterval(fetchOnce, 30_000);

    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [symbol, apiKey]);

  const data = snapshot?.data;
  const sess = data?.session_state;
  const spot = data?.spot;
  const zdte = data?.zero_dte;

  const decimals = priceDecimals(symbol);

  // Group levels by kind for the cards.
  const levels = useMemo<FuturesKeyLevel[]>(
    () => futures?.levels ?? [],
    [futures],
  );
  const levelsByKind = useMemo(() => {
    const m = new Map<FuturesKeyLevelKind, FuturesKeyLevel[]>();
    for (const lvl of levels) {
      const arr = m.get(lvl.kind) ?? [];
      arr.push(lvl);
      m.set(lvl.kind, arr);
    }
    return m;
  }, [levels]);

  const flipLevels = levelsByKind.get("flip") ?? [];
  const callWalls = levelsByKind.get("wall_call") ?? [];
  const putWalls = levelsByKind.get("wall_put") ?? [];
  const maxPain = levelsByKind.get("max_pain") ?? [];
  const gexPos = levelsByKind.get("gex_pos") ?? [];
  const gexNeg = levelsByKind.get("gex_neg") ?? [];

  const futuresPrice = futures?.futures_price ?? null;
  const futuresOffline = !futures || futuresPrice === null;

  // Distance to nearest gamma flip in cash (use 0DTE flip if present, else chain flip).
  const rawFlip =
    zdte?.gex_oi?.zero_gamma ??
    (data?.zero_gamma?.oi !== undefined && data.zero_gamma.oi !== null
      ? data.zero_gamma.oi
      : null);
  const cashFlip0Dte: number | null =
    rawFlip !== null && rawFlip !== undefined && Number.isFinite(rawFlip) ? rawFlip : null;
  const cashSpot = spot?.price ?? null;
  const distanceToFlip =
    cashFlip0Dte !== null && cashSpot !== null ? cashSpot - cashFlip0Dte : null;

  return (
    <div className="space-y-6">
      {/* ── A. Header strip ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">0DTE Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            SpotGamma-style 0DTE view for{" "}
            <span className="font-mono">{symbol || "—"}</span>
            {snapshot?.computed_at && (
              <>
                {" "}
                · last frame {new Date(snapshot.computed_at).toLocaleTimeString()}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SessionBadge
            isRth={sess?.is_rth ?? false}
            minutesToClose={sess?.minutes_to_close ?? null}
            isExpiry={sess?.is_expiration_day ?? false}
          />
          <ConnectionStatusIndicator status={status} lastFrameAt={lastFrameAt} />
        </div>
      </div>

      {/* Symbol picker + API key row */}
      <div className="rounded-md border border-border bg-background/40 p-3">
        <div className="grid gap-3 md:grid-cols-3 md:items-end">
          <div>
            <Label>Symbol</Label>
            <div className="mt-1 flex gap-2">
              {SUPPORTED_SYMBOLS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={symbol === s ? "default" : "outline"}
                  className="font-mono"
                  onClick={() => {
                    if (symbol !== s) {
                      setSymbol(s);
                      setFutures(null);
                      setFuturesError(null);
                    }
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="zd-api-key">API key</Label>
            <Input
              id="zd-api-key"
              type="password"
              className="mt-1 font-mono"
              value={draftKey}
              placeholder="ofa_…"
              onChange={(e) => setDraftKey(e.target.value)}
              onBlur={() => {
                if (draftKey !== apiKey) {
                  setApiKey(draftKey);
                  setStoredApiKey(draftKey);
                }
              }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {!apiKey ? (
              <span className="text-amber-400">Enter API key to start streaming.</span>
            ) : status === "open" ? (
              <span>Streaming live snapshot every ~30s.</span>
            ) : (
              <span>Connecting…</span>
            )}
          </div>
        </div>
      </div>

      {/* ── B. Spot hero ─────────────────────────────────────────────────── */}
      <SpotHero
        symbol={symbol}
        decimals={decimals}
        cashSpot={cashSpot}
        spotSource={spot?.source ?? null}
        futuresPrice={futuresPrice}
        futuresContract={futures?.futures_contract ?? null}
        futuresRoot={futures?.futures_root ?? null}
        basis={spot?.basis ?? null}
        levels={levels}
        distanceToFlip={distanceToFlip}
        cashFlip={cashFlip0Dte}
        futuresOffline={futuresOffline}
        hasFutures={futures !== null}
        loading={futuresLoading}
        error={futuresError}
      />

      {/* ── C. Key levels grid ──────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <FlipCard
          decimals={decimals}
          flipLevels={flipLevels}
          cashFlip0Dte={cashFlip0Dte ?? null}
        />
        <WallsCard
          decimals={decimals}
          callWalls={callWalls}
          putWalls={putWalls}
          futuresPrice={futuresPrice}
        />
        <MaxPainCard decimals={decimals} maxPain={maxPain} />
        <GexLevelsCard
          decimals={decimals}
          title="Top GEX Strikes"
          description="Chain-wide ranked by |γ|"
          gexPos={gexPos}
          gexNeg={gexNeg}
          futuresPrice={futuresPrice}
        />
        <ZeroDteGexCard
          decimals={decimals}
          curve={zdte?.gex_oi?.curve ?? []}
          isExpiryDay={sess?.is_expiration_day ?? false}
          futuresPrice={futuresPrice}
          basis={spot?.basis ?? null}
        />
      </div>

      {/* ── D. 0DTE GEX curve ───────────────────────────────────────────── */}
      {zdte?.gex_oi && zdte.gex_oi.curve && zdte.gex_oi.curve.length > 0 ? (
        <GexChart
          payload={zdte.gex_oi}
          title="0DTE GEX"
          description="Per-strike gamma exposure (today's expiry)"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>0DTE GEX</CardTitle>
            <CardDescription>Per-strike gamma exposure (today&apos;s expiry)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No 0DTE chain data yet.
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── E. Flip speed strip ─────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile
          label="Net 0DTE GEX (OI)"
          value={formatGex(zdte?.gex_oi?.net_total)}
          tone={
            (zdte?.gex_oi?.net_total ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
          }
        />
        <StatTile
          label="Flip speed"
          value={
            zdte?.flip_speed !== undefined && Number.isFinite(zdte.flip_speed)
              ? `${formatSignedDistance(zdte.flip_speed)} USD/s`
              : "—"
          }
          tone="text-foreground"
        />
        <StatTile
          label="Charm decay rate"
          value={
            zdte?.charm_decay_rate !== undefined && Number.isFinite(zdte.charm_decay_rate)
              ? `${formatSignedDistance(zdte.charm_decay_rate)} /hr`
              : "—"
          }
          tone="text-foreground"
        />
      </div>
    </div>
  );
}

// ── Header session badge ──────────────────────────────────────────────────

function SessionBadge({
  isRth,
  minutesToClose,
  isExpiry,
}: {
  isRth: boolean;
  minutesToClose: number | null;
  isExpiry: boolean;
}) {
  if (isExpiry) {
    return (
      <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-400">
        0DTE day
        {isRth && minutesToClose !== null && (
          <> · {Math.max(0, Math.round(minutesToClose))} min to close</>
        )}
      </span>
    );
  }
  if (isRth) {
    return (
      <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-400">
        RTH OPEN
        {minutesToClose !== null && (
          <> · {Math.max(0, Math.round(minutesToClose))} min to close</>
        )}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold text-muted-foreground">
      After hours
    </span>
  );
}

// ── B. Spot hero ──────────────────────────────────────────────────────────

interface SpotHeroProps {
  symbol: string;
  decimals: number;
  cashSpot: number | null;
  spotSource: SpotSource | null;
  futuresPrice: number | null;
  futuresContract: string | null;
  futuresRoot: string | null;
  basis: number | null;
  levels: FuturesKeyLevel[];
  distanceToFlip: number | null;
  cashFlip: number | null;
  futuresOffline: boolean;
  hasFutures: boolean;
  loading: boolean;
  error: string | null;
}

function SpotHero({
  symbol,
  decimals,
  cashSpot,
  spotSource,
  futuresPrice,
  futuresContract,
  futuresRoot,
  basis,
  levels,
  distanceToFlip,
  cashFlip,
  futuresOffline,
  hasFutures,
  loading,
  error,
}: SpotHeroProps) {
  return (
    <Card className={futuresOffline ? "opacity-90" : undefined}>
      <CardContent className="grid gap-6 p-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                {symbol} cash spot
              </div>
              <div
                className="text-5xl font-semibold tracking-tight"
                style={tabular}
              >
                {formatPrice(cashSpot, decimals)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase text-muted-foreground">
                {futuresRoot ?? "Futures"} {futuresContract ? `· ${futuresContract}` : ""}
              </div>
              <div className="text-xl font-semibold" style={tabular}>
                {formatPrice(futuresPrice, decimals === 4 ? 2 : decimals)}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>basis</span>
                <span className="font-mono" style={tabular}>
                  {formatSignedDistance(basis)}
                </span>
                {sourcePill(spotSource)}
                {futuresOffline && (
                  <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-mono uppercase text-rose-300">
                    futures offline
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Thermometer */}
          <Thermometer
            cashSpot={cashSpot}
            futuresPrice={futuresPrice}
            levels={levels}
            decimals={decimals === 4 ? 2 : decimals}
          />

          {error && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              Futures-levels: {error}
            </div>
          )}
          {loading && !hasFutures && (
            <div className="text-xs text-muted-foreground">Loading futures levels…</div>
          )}
        </div>

        <div className="rounded-md border border-violet-500/40 bg-violet-500/10 p-4">
          <div className="text-xs uppercase text-violet-300">Distance to flip</div>
          <div
            className="mt-1 text-3xl font-semibold tracking-tight text-violet-200"
            style={tabular}
          >
            {formatSignedDistance(distanceToFlip)}
            <span className="ml-1 text-base font-normal text-violet-300/80">pts</span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between gap-4">
              <span>Cash flip</span>
              <span className="font-mono" style={tabular}>
                {formatPrice(cashFlip, decimals)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Cash spot</span>
              <span className="font-mono" style={tabular}>
                {formatPrice(cashSpot, decimals)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Thermometer ───────────────────────────────────────────────────────────

function Thermometer({
  cashSpot,
  futuresPrice,
  levels,
  decimals,
}: {
  cashSpot: number | null;
  futuresPrice: number | null;
  levels: FuturesKeyLevel[];
  decimals: number;
}) {
  // Use futures coordinates for the bar so the spot indicator and ticks share a frame.
  const sortedLevels = useMemo(
    () =>
      [...levels]
        .filter((l) => Number.isFinite(l.futures_level))
        .sort((a, b) => a.futures_level - b.futures_level),
    [levels],
  );

  const spotFutures = useMemo(() => {
    if (futuresPrice !== null && Number.isFinite(futuresPrice)) return futuresPrice;
    if (cashSpot !== null && Number.isFinite(cashSpot)) return cashSpot;
    return null;
  }, [cashSpot, futuresPrice]);

  if (sortedLevels.length === 0 || spotFutures === null) {
    return (
      <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
        No key levels available.
      </div>
    );
  }

  // Window the bar around spot using nearest below/above + 1 step of padding.
  const below = sortedLevels.filter((l) => l.futures_level <= spotFutures);
  const above = sortedLevels.filter((l) => l.futures_level > spotFutures);
  const lo = below.length > 0 ? below[0].futures_level : sortedLevels[0].futures_level;
  const hi =
    above.length > 0
      ? above[above.length - 1].futures_level
      : sortedLevels[sortedLevels.length - 1].futures_level;

  let lower = Math.min(lo, sortedLevels[0].futures_level);
  let upper = Math.max(hi, sortedLevels[sortedLevels.length - 1].futures_level);
  if (upper - lower < 1) {
    upper = spotFutures + 5;
    lower = spotFutures - 5;
  }
  const span = upper - lower;
  const pct = (v: number): number =>
    Math.max(0, Math.min(100, ((v - lower) / span) * 100));

  return (
    <div className="space-y-2">
      <div className="relative h-14 rounded-md border border-border bg-gradient-to-r from-rose-500/10 via-muted/30 to-emerald-500/10">
        {/* level ticks */}
        {sortedLevels.map((lvl) => {
          const conf = KIND_COLORS[lvl.kind];
          return (
            <div
              key={`${lvl.kind}-${lvl.label}-${lvl.futures_level}`}
              className="group absolute top-0 flex h-full -translate-x-1/2 flex-col items-center"
              style={{ left: `${pct(lvl.futures_level)}%` }}
              title={`${lvl.label} · ${lvl.futures_level.toFixed(decimals)}`}
            >
              <div className={`h-full w-0.5 ${conf.tick} opacity-70`} />
              <div
                className={`absolute -bottom-1 translate-y-full whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-mono ${conf.bg} ${conf.text} opacity-0 group-hover:opacity-100`}
                style={tabular}
              >
                {lvl.label}
              </div>
            </div>
          );
        })}
        {/* spot marker */}
        <div
          className="absolute top-0 flex h-full -translate-x-1/2 flex-col items-center"
          style={{ left: `${pct(spotFutures)}%` }}
        >
          <div className="h-full w-[3px] bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
          <div
            className="absolute -top-5 whitespace-nowrap rounded bg-foreground px-1 py-0.5 text-[9px] font-mono text-background"
            style={tabular}
          >
            spot {spotFutures.toFixed(decimals)}
          </div>
        </div>
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground" style={tabular}>
        <span>{lower.toFixed(decimals)}</span>
        <span>{upper.toFixed(decimals)}</span>
      </div>
    </div>
  );
}

// ── Level cards ───────────────────────────────────────────────────────────

function LevelRow({
  label,
  cash,
  fut,
  decimals,
  distance,
  textClass,
  bgClass,
  weightPct,
}: {
  label: string;
  cash: number;
  fut: number;
  decimals: number;
  distance: number | null;
  textClass: string;
  bgClass?: string;
  weightPct?: number | null;
}) {
  const distTone =
    distance === null
      ? "text-muted-foreground"
      : distance >= 0
        ? "text-emerald-400"
        : "text-rose-400";
  return (
    <div className={`relative overflow-hidden rounded-md border border-border/60 ${bgClass ?? ""}`}>
      {weightPct !== undefined && weightPct !== null && (
        <div
          className={`absolute inset-y-0 left-0 ${bgClass ?? "bg-muted/40"} opacity-40`}
          style={{ width: `${Math.max(2, Math.min(100, weightPct))}%` }}
          aria-hidden
        />
      )}
      <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className={`font-medium ${textClass}`}>{label}</span>
        <div
          className="grid grid-cols-3 gap-3 font-mono text-right"
          style={tabular}
        >
          <span className="text-muted-foreground">{formatPrice(cash, decimals)}</span>
          <span>{formatPrice(fut, decimals === 4 ? 2 : decimals)}</span>
          <span className={distTone}>{formatSignedInt(distance)}</span>
        </div>
      </div>
    </div>
  );
}

function LevelHeader() {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span>Label</span>
      <div className="grid grid-cols-3 gap-3 text-right">
        <span>Cash</span>
        <span>Fut</span>
        <span>Δ pts</span>
      </div>
    </div>
  );
}

function FlipCard({
  decimals,
  flipLevels,
  cashFlip0Dte,
}: {
  decimals: number;
  flipLevels: FuturesKeyLevel[];
  cashFlip0Dte: number | null;
}) {
  const conf = KIND_COLORS.flip;
  return (
    <Card className={`border ${conf.border}`}>
      <CardHeader>
        <CardTitle className={conf.text}>Gamma Flip</CardTitle>
        <CardDescription>Zero-gamma price (cash & futures translated)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <LevelHeader />
        {cashFlip0Dte !== null && Number.isFinite(cashFlip0Dte) ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs">
            <span className="font-medium text-violet-300">0DTE flip</span>
            <span className="font-mono text-violet-200" style={tabular}>
              {formatPrice(cashFlip0Dte, decimals)}
            </span>
          </div>
        ) : (
          <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
            0DTE flip not available.
          </div>
        )}
        {flipLevels.length > 0 ? (
          flipLevels.map((lvl) => (
            <LevelRow
              key={`flip-${lvl.label}-${lvl.futures_level}`}
              label={lvl.label}
              cash={lvl.cash_strike}
              fut={lvl.futures_level}
              decimals={decimals}
              distance={lvl.distance_pts}
              textClass={conf.text}
              bgClass={conf.bg}
            />
          ))
        ) : (
          <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
            Chain-wide flip unavailable.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WallsCard({
  decimals,
  callWalls,
  putWalls,
  futuresPrice,
}: {
  decimals: number;
  callWalls: FuturesKeyLevel[];
  putWalls: FuturesKeyLevel[];
  futuresPrice: number | null;
}) {
  const calls = callWalls.slice(0, 3);
  const puts = putWalls.slice(0, 3);
  const wMax = Math.max(
    1,
    ...[...calls, ...puts].map((l) =>
      l.weight_value !== null && l.weight_value !== undefined ? Math.abs(l.weight_value) : 0,
    ),
  );

  function row(lvl: FuturesKeyLevel, kind: "wall_call" | "wall_put") {
    const conf = KIND_COLORS[kind];
    const dist =
      lvl.distance_pts !== null && lvl.distance_pts !== undefined
        ? lvl.distance_pts
        : futuresPrice !== null
          ? lvl.futures_level - futuresPrice
          : null;
    const w =
      lvl.weight_value !== null && lvl.weight_value !== undefined
        ? (Math.abs(lvl.weight_value) / wMax) * 100
        : null;
    return (
      <LevelRow
        key={`${kind}-${lvl.label}-${lvl.futures_level}`}
        label={lvl.label}
        cash={lvl.cash_strike}
        fut={lvl.futures_level}
        decimals={decimals}
        distance={dist}
        textClass={conf.text}
        bgClass={conf.bg}
        weightPct={w}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Walls</CardTitle>
        <CardDescription>Top 3 call walls (green) & put walls (red)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <LevelHeader />
          {calls.length > 0 ? (
            <div className="space-y-1.5">{calls.map((l) => row(l, "wall_call"))}</div>
          ) : (
            <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
              No call walls.
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          {puts.length > 0 ? (
            puts.map((l) => row(l, "wall_put"))
          ) : (
            <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
              No put walls.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MaxPainCard({
  decimals,
  maxPain,
}: {
  decimals: number;
  maxPain: FuturesKeyLevel[];
}) {
  const conf = KIND_COLORS.max_pain;
  const lvl = maxPain[0];
  return (
    <Card className={`border ${conf.border}`}>
      <CardHeader>
        <CardTitle className={conf.text}>Max Pain</CardTitle>
        <CardDescription>Aggregate option max-pain strike</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <LevelHeader />
        {lvl ? (
          <LevelRow
            label={lvl.label}
            cash={lvl.cash_strike}
            fut={lvl.futures_level}
            decimals={decimals}
            distance={lvl.distance_pts}
            textClass={conf.text}
            bgClass={conf.bg}
          />
        ) : (
          <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
            Max-pain not available.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GexLevelsCard({
  decimals,
  title,
  description,
  gexPos,
  gexNeg,
  futuresPrice,
}: {
  decimals: number;
  title: string;
  description: string;
  gexPos: FuturesKeyLevel[];
  gexNeg: FuturesKeyLevel[];
  futuresPrice: number | null;
}) {
  const pos = gexPos.slice(0, 5);
  const neg = gexNeg.slice(0, 5);
  const wMax = Math.max(
    1,
    ...[...pos, ...neg].map((l) =>
      l.weight_value !== null && l.weight_value !== undefined ? Math.abs(l.weight_value) : 0,
    ),
  );
  function row(lvl: FuturesKeyLevel, kind: "gex_pos" | "gex_neg") {
    const conf = KIND_COLORS[kind];
    const dist =
      lvl.distance_pts !== null && lvl.distance_pts !== undefined
        ? lvl.distance_pts
        : futuresPrice !== null
          ? lvl.futures_level - futuresPrice
          : null;
    const w =
      lvl.weight_value !== null && lvl.weight_value !== undefined
        ? (Math.abs(lvl.weight_value) / wMax) * 100
        : null;
    return (
      <LevelRow
        key={`${kind}-${lvl.label}-${lvl.futures_level}`}
        label={lvl.label}
        cash={lvl.cash_strike}
        fut={lvl.futures_level}
        decimals={decimals}
        distance={dist}
        textClass={conf.text}
        bgClass={conf.bg}
        weightPct={w}
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <LevelHeader />
        <div className="space-y-1.5">
          {pos.length > 0 ? (
            pos.map((l) => row(l, "gex_pos"))
          ) : (
            <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
              No positive GEX strikes.
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          {neg.length > 0 ? (
            neg.map((l) => row(l, "gex_neg"))
          ) : (
            <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
              No negative GEX strikes.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ZeroDteGexCard({
  decimals,
  curve,
  isExpiryDay,
  futuresPrice,
  basis,
}: {
  decimals: number;
  curve: GexStrike[];
  isExpiryDay: boolean;
  futuresPrice: number | null;
  basis: number | null;
}) {
  // Build top positive / negative cohorts from the 0DTE curve directly.
  const sorted = useMemo(
    () =>
      [...curve]
        .filter((p) => Number.isFinite(p.strike) && Number.isFinite(p.net_gex))
        .sort((a, b) => Math.abs(b.net_gex) - Math.abs(a.net_gex)),
    [curve],
  );
  const pos = useMemo(() => sorted.filter((p) => p.net_gex > 0).slice(0, 5), [sorted]);
  const neg = useMemo(() => sorted.filter((p) => p.net_gex < 0).slice(0, 5), [sorted]);
  const wMax = Math.max(
    1,
    ...[...pos, ...neg].map((p) => Math.abs(p.net_gex)),
  );

  // Approximate cash → futures translation when basis is known.
  const futuresOf = (strike: number): number =>
    basis !== null && Number.isFinite(basis) ? strike + basis : strike;

  function row(p: GexStrike, kind: "gex_pos" | "gex_neg") {
    const conf = KIND_COLORS[kind];
    const fut = futuresOf(p.strike);
    const dist = futuresPrice !== null ? fut - futuresPrice : null;
    const w = (Math.abs(p.net_gex) / wMax) * 100;
    return (
      <LevelRow
        key={`zdte-${kind}-${p.strike}`}
        label={`${p.strike}`}
        cash={p.strike}
        fut={fut}
        decimals={decimals}
        distance={dist}
        textClass={conf.text}
        bgClass={conf.bg}
        weightPct={w}
      />
    );
  }

  if (!isExpiryDay) {
    return (
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Top 0DTE GEX</CardTitle>
          <CardDescription>Today&apos;s expiry cohort</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
            No 0DTE expiration today.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Top 0DTE GEX</CardTitle>
        <CardDescription>Today&apos;s expiry cohort, ranked by |γ|</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <LevelHeader />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-teal-400">Positive</div>
            {pos.length > 0 ? (
              pos.map((p) => row(p, "gex_pos"))
            ) : (
              <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
                None.
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-rose-400">Negative</div>
            {neg.length > 0 ? (
              neg.map((p) => row(p, "gex_neg"))
            ) : (
              <div className="rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
                None.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${tone}`}
        style={tabular}
      >
        {value}
      </div>
    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────────────────

export function ZeroDtePage() {
  return (
    <LiveSnapshotProvider initialSymbol="SPXW">
      <ZeroDteInner />
    </LiveSnapshotProvider>
  );
}
