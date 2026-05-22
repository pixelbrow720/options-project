import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import { ConnectionPill } from "@/components/ConnectionPill";
import { SpotHero } from "@/components/SpotHero";
import { FlipSpeedStrip } from "@/components/FlipSpeedStrip";
import { LevelsThermometer } from "@/components/LevelsThermometer";
import { KeyLevelsTable } from "@/components/KeyLevelsTable";
import { GexCurveChart } from "@/components/GexCurveChart";
import { MarketClosedBanner } from "@/components/MarketClosedBanner";
import HiroChart from "@/components/HiroChart";
import FullChainHeatmap from "@/components/FullChainHeatmap";
import OptionsChainTable from "@/components/OptionsChainTable";
import VolTriggerCard from "@/components/VolTriggerCard";
import SkewChart from "@/components/SkewChart";
import TermStructureChart from "@/components/TermStructureChart";
import MoveTrackerCard from "@/components/MoveTrackerCard";
import GammaCompass from "@/components/GammaCompass";
import RegimeBadge from "@/components/RegimeBadge";
import AbsoluteGammaChart from "@/components/AbsoluteGammaChart";
import CharmHeatmap from "@/components/CharmHeatmap";
import GammaFlipTracker from "@/components/GammaFlipTracker";
import DealerPositioning from "@/components/DealerPositioning";
import PremiumFlowPanel from "@/components/PremiumFlowPanel";
import PinRiskRadial from "@/components/PinRiskRadial";
import AlertCenter from "@/components/AlertCenter";
import TimeOfDayStrip from "@/components/TimeOfDayStrip";
import StrikeMigration from "@/components/StrikeMigration";
import HistoricalReplay from "@/components/HistoricalReplay";
import FuturesOverlayToggle from "@/components/FuturesOverlayToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useLiveStream } from "@/lib/stream";
import { useTickStream, type TickFrame } from "@/lib/tickStream";
import {
  SymbolData,
  describeApiError,
  type AbsoluteGammaPayload,
  type ChainPayload,
  type DataEnvelope,
  type DealerPositioningPayload,
  type FlowPayload,
  type FuturesKeyLevel,
  type FuturesLevelsSnapshot,
  type GexPayload,
  type HiroPayload,
  type IntradayPayload,
  type LastCloseResponse,
  type MigrationPayload,
  type MoveTrackerPublicPayload,
  type PinRiskPayload,
  type RegimePayload,
  type SkewPayload,
  type SnapshotData,
  type SpotPayload,
  type TermStructurePayload,
  type VolTriggerPayload,
  type ZeroDtePayload,
} from "@/lib/api";
import { toast } from "@/components/ui/toast";

const SUPPORTED_SYMBOLS = ["SPXW", "NDXP"] as const;
type Symbol = (typeof SUPPORTED_SYMBOLS)[number];

const SNAPSHOT_REFRESH_MS = 30_000;
const FAST_REFRESH_MS = 30_000;
const MEDIUM_REFRESH_MS = 60_000;
const SLOW_REFRESH_MS = 120_000;

const TAB_KEYS = ["pro", "intraday", "flow", "chain", "vol"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isSupported(value: string | undefined): value is Symbol {
  return !!value && SUPPORTED_SYMBOLS.includes(value as Symbol);
}

export default function Dashboard() {
  const params = useParams<{ symbol?: string }>();
  const navigate = useNavigate();
  const token = useAuth((s) => s.token);

  const initialSymbol: Symbol = isSupported(params.symbol?.toUpperCase()) ? (params.symbol!.toUpperCase() as Symbol) : "SPXW";
  const [symbol, setSymbol] = useState<Symbol>(initialSymbol);
  const [tab, setTab] = useState<TabKey>("pro");
  const [priceMode, setPriceMode] = useState<"cash" | "futures">("cash");
  const [seekTs, setSeekTs] = useState<string | null>(null);

  // ── Existing data ──
  const [snapshot, setSnapshot] = useState<DataEnvelope | null>(null);
  const [snapshotErr, setSnapshotErr] = useState<string | null>(null);
  const [lastClose, setLastClose] = useState<LastCloseResponse | null>(null);
  const [futuresLevels, setFuturesLevels] = useState<FuturesLevelsSnapshot | null>(null);
  const [intraday, setIntraday] = useState<IntradayPayload | null>(null);
  const [flow, setFlow] = useState<FlowPayload | null>(null);
  const [pinRisk, setPinRisk] = useState<PinRiskPayload | null>(null);
  const [dealer, setDealer] = useState<DealerPositioningPayload | null>(null);
  const [migration, setMigration] = useState<MigrationPayload | null>(null);

  // ── New SpotGamma-grade data ──
  const [hiro, setHiro] = useState<HiroPayload | null>(null);
  const [chain, setChain] = useState<ChainPayload | null>(null);
  const [volTrigger, setVolTrigger] = useState<VolTriggerPayload | null>(null);
  const [absoluteGamma, setAbsoluteGamma] = useState<AbsoluteGammaPayload | null>(null);
  const [skew, setSkew] = useState<SkewPayload | null>(null);
  const [termStructure, setTermStructure] = useState<TermStructurePayload | null>(null);
  const [moveTracker, setMoveTracker] = useState<MoveTrackerPublicPayload | null>(null);
  const [regime, setRegime] = useState<RegimePayload | null>(null);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [highlightStrike, setHighlightStrike] = useState<number | null>(null);

  const stream = useLiveStream(symbol, token);
  const tickStream = useTickStream(symbol, token);

  useEffect(() => {
    if (params.symbol?.toUpperCase() !== symbol) {
      navigate(`/dashboard/${symbol}`, { replace: true });
    }
  }, [symbol, navigate, params.symbol]);

  // Reset all state on symbol change
  useEffect(() => {
    setSnapshot(null); setSnapshotErr(null); setLastClose(null);
    setFuturesLevels(null); setIntraday(null); setFlow(null);
    setPinRisk(null); setDealer(null); setMigration(null);
    setHiro(null); setChain(null); setVolTrigger(null);
    setAbsoluteGamma(null); setSkew(null); setTermStructure(null);
    setMoveTracker(null); setRegime(null);
    setLoadingInitial(true); setHighlightStrike(null); setSeekTs(null);
  }, [symbol]);

  // Cold-start snapshot
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const env = await SymbolData.snapshot(symbol);
        if (!cancelled) { setSnapshot(env); setSnapshotErr(null); }
      } catch (err) {
        if (!cancelled) setSnapshotErr(describeApiError(err, "Could not load snapshot."));
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  // Periodic snapshot refresh
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const env = await SymbolData.snapshot(symbol);
        if (cancelled) return;
        setSnapshot((prev) => {
          if (!prev) return env;
          if (!prev.computed_at || (env.computed_at && env.computed_at > prev.computed_at)) return env;
          return prev;
        });
      } catch { /* swallow */ }
    }, SNAPSHOT_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, token]);

  // Generic poller helper
  function usePoller<T>(
    fn: () => Promise<T>,
    setter: (v: T) => void,
    intervalMs: number,
    deps: unknown[],
  ) {
    useEffect(() => {
      let cancelled = false;
      async function run() {
        try {
          const v = await fn();
          if (!cancelled) setter(v);
        } catch { /* keep prior */ }
      }
      run();
      const id = setInterval(run, intervalMs);
      return () => { cancelled = true; clearInterval(id); };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
  }

  usePoller(
    async () => {
      const env = await SymbolData.futuresLevels(symbol);
      return (env.data?.futures_levels ?? null) as FuturesLevelsSnapshot | null;
    },
    setFuturesLevels, FAST_REFRESH_MS, [symbol, token],
  );
  usePoller(async () => (await SymbolData.intraday(symbol, 6)).data, setIntraday, FAST_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.flow(symbol, 6)).data, setFlow, FAST_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.pinRisk(symbol)).data, setPinRisk, MEDIUM_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.dealerPositioning(symbol)).data, setDealer, FAST_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.migration(symbol)).data, setMigration, MEDIUM_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.hiro(symbol, 6)).data, setHiro, FAST_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.chain(symbol)).data, setChain, MEDIUM_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.volTrigger(symbol)).data, setVolTrigger, FAST_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.absoluteGamma(symbol)).data, setAbsoluteGamma, FAST_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.skew(symbol)).data, setSkew, MEDIUM_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.termStructure(symbol)).data, setTermStructure, MEDIUM_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.moveTracker(symbol)).data, setMoveTracker, SLOW_REFRESH_MS, [symbol, token]);
  usePoller(async () => (await SymbolData.regime(symbol)).data, setRegime, MEDIUM_REFRESH_MS, [symbol, token]);

  const sessionIsRth = (snapshot?.data.session_state?.is_rth ?? null) as boolean | null;
  const wsLive = stream.envelope?.data.session_state?.is_rth ?? sessionIsRth;
  const showClosedBanner = wsLive === false;

  useEffect(() => {
    if (!showClosedBanner || !token) return;
    let cancelled = false;
    async function loadLastClose() {
      try {
        const resp = await SymbolData.lastClose(symbol);
        if (!cancelled) setLastClose(resp);
      } catch { /* keep prior */ }
    }
    loadLastClose();
    const id = setInterval(loadLastClose, MEDIUM_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [showClosedBanner, symbol, token]);

  const warnedRef = useRef(false);
  useEffect(() => { warnedRef.current = false; }, [symbol]);
  useEffect(() => {
    if (warnedRef.current) return;
    if (snapshotErr) {
      toast({ title: "Snapshot failed", description: snapshotErr, variant: "destructive" });
      warnedRef.current = true;
    }
  }, [snapshotErr]);

  const view = useMemo<DerivedView>(() => deriveView({
    live: stream.envelope, snapshot, lastClose, futuresLevels, tick: tickStream.tick,
  }), [stream.envelope, snapshot, lastClose, futuresLevels, tickStream.tick]);

  const handleHighlight = useCallback((s: number | null) => setHighlightStrike(s), []);
  const handleSeek = useCallback((ts: string | null) => setSeekTs(ts), []);

  const alertLevels = useMemo(
    () => view.futuresLevels.map((l) => ({ label: l.label, cash_strike: l.cash_strike, kind: l.kind })),
    [view.futuresLevels],
  );

  const futuresPriceLabel = view.futuresContract && view.futuresPrice !== null
    ? `${view.futuresContract} ${view.futuresPrice.toFixed(2)}` : "Futures —";
  const cashLabel = view.cashSpot !== null ? `${symbol} ${view.cashSpot.toFixed(2)}` : `${symbol} —`;
  const basis = view.futuresPrice !== null && view.cashSpot !== null ? view.futuresPrice - view.cashSpot : null;

  // GEX_NET_TOTAL approximation from chain GEX
  const gexNetTotal = view.chainGex?.net_total ?? null;

  return (
    <Layout variant="app">
      <AnimatePresence initial={false}>
        {showClosedBanner ? (
          <motion.div
            key="market-closed"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <MarketClosedBanner
              computedAt={lastClose?.computed_at ?? snapshot?.computed_at ?? null}
              hoursOld={lastClose?.hours_old ?? null}
              marketOpenIso={lastClose?.market_open_iso ?? null}
              marketOpenInSeconds={lastClose?.market_open_in_seconds ?? null}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Section heading — landing-style typography */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-5 flex flex-col gap-1"
        >
          <span
            className="text-[10px] font-mono tracking-[0.3em] uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Live Terminal
          </span>
          <h1
            className="text-2xl sm:text-3xl tracking-tight"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-primary)",
            }}
          >
            FlowOption<span style={{ color: "var(--accent-foid)" }}>ID</span> Dashboard
          </h1>
        </motion.div>

        {/* Top control bar */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="mb-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <SymbolToggle value={symbol} onChange={setSymbol} />
            <FuturesOverlayToggle
              value={priceMode}
              onChange={setPriceMode}
              cashLabel={cashLabel}
              futuresLabel={futuresPriceLabel}
              basis={basis}
            />
            {showClosedBanner ? (
              <span
                className="liquid-glass rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em]"
                style={{
                  color: "var(--accent-amber)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                Stale Snapshot
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <AlertCenter symbol={symbol} spot={view.cashSpot} levels={alertLevels} />
            <ConnectionPill status={stream.status} />
          </div>
        </motion.div>

        <TabBar value={tab} onChange={setTab} />

        <DashboardGrid loading={loadingInitial && !view.spot}>
          {tab === "pro" && (
            <>
              {/* Top hero row: Spot + Compass + Regime */}
              <RevealItem index={0} className="grid gap-3 md:grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr]">
                <SpotHero
                  symbol={symbol}
                  spot={view.spot}
                  zeroGamma={view.zeroGamma}
                  futuresContract={view.futuresContract}
                />
                <GammaCompass
                  symbol={symbol}
                  gexNetTotal={gexNetTotal}
                  zeroGamma={view.zeroGamma}
                  spot={view.cashSpot}
                  volTrigger={volTrigger?.vol_trigger ?? null}
                  loading={loadingInitial && !volTrigger}
                />
                <FlipSpeedStrip zeroDte={view.zeroDte} />
              </RevealItem>

              {/* Regime + TimeOfDay strip */}
              <RevealItem index={1}>
                <RegimeBadge
                  symbol={symbol}
                  gexRegime={regime?.gex_regime ?? null}
                  gexScore={regime?.gex_score ?? null}
                  volRegime={regime?.vol_regime ?? null}
                  flowRegime={regime?.flow_regime ?? null}
                  summary={regime?.summary ?? null}
                  narrative={regime?.narrative ?? null}
                  loading={loadingInitial && !regime}
                />
              </RevealItem>

              <RevealItem index={2}>
                <TimeOfDayStrip nowEt={null} />
              </RevealItem>

              {/* HIRO marquee — full width */}
              <RevealItem index={3}>
                <HiroChart
                  symbol={symbol}
                  series={hiro?.series ?? null}
                  currentCumulative={hiro?.current_cumulative ?? 0}
                  currentSigned={hiro?.current_signed ?? 0}
                  trend={hiro?.trend ?? "neutral"}
                  loading={loadingInitial && !hiro}
                />
              </RevealItem>

              {/* Vol Trigger + Move Tracker side-by-side */}
              <RevealItem index={4} className="grid gap-3 md:grid-cols-1 lg:grid-cols-2">
                <VolTriggerCard
                  symbol={symbol}
                  volTrigger={volTrigger?.vol_trigger ?? null}
                  spot={volTrigger?.spot ?? view.cashSpot}
                  distancePts={volTrigger?.distance_pts ?? null}
                  distancePct={volTrigger?.distance_pct ?? null}
                  belowTrigger={volTrigger?.below_trigger ?? false}
                  regime={volTrigger?.regime ?? "stable"}
                  loading={loadingInitial && !volTrigger}
                />
                <MoveTrackerCard
                  symbol={symbol}
                  impliedMove={moveTracker?.implied_move ?? null}
                  realizedMove={moveTracker?.realized_move ?? null}
                  ratio={moveTracker?.ratio ?? null}
                  regime={moveTracker?.regime ?? "in_range"}
                  loading={loadingInitial && !moveTracker}
                />
              </RevealItem>

              {/* Levels Thermometer + Key Levels Table */}
              <RevealItem index={5} className="grid gap-3 md:grid-cols-1 lg:grid-cols-[1fr_1fr]">
                <LevelsThermometer
                  symbol={symbol}
                  levels={view.futuresLevels}
                  futuresPrice={view.futuresPrice}
                  cashSpot={view.cashSpot}
                  highlightStrike={highlightStrike}
                  onHighlight={handleHighlight}
                  loading={loadingInitial && view.futuresLevels.length === 0}
                />
                <KeyLevelsTable
                  symbol={symbol}
                  levels={view.futuresLevels}
                  futuresPrice={view.futuresPrice}
                  cashSpot={view.cashSpot}
                  highlightStrike={highlightStrike}
                  onHighlight={handleHighlight}
                  loading={loadingInitial && view.futuresLevels.length === 0}
                />
              </RevealItem>

              {/* GEX Curve + Pin Risk */}
              <RevealItem index={6} className="grid gap-3 md:grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
                <GexCurveChart
                  symbol={symbol}
                  title="0DTE GEX curve"
                  subtitle="Open-interest weighted gamma exposure for today's expiry."
                  data={view.zeroDte?.gex_oi ?? null}
                  spot={view.cashSpot}
                  zeroGamma={view.zeroGamma}
                  variant="primary"
                  loading={loadingInitial && !view.zeroDte}
                />
                <PinRiskRadial
                  symbol={symbol}
                  spot={pinRisk?.spot ?? view.cashSpot}
                  strikes={pinRisk?.strikes ?? null}
                  topPin={pinRisk?.top_pin ?? null}
                  loading={loadingInitial && !pinRisk}
                />
              </RevealItem>
            </>
          )}

          {tab === "intraday" && (
            <>
              <RevealItem index={0}>
                <HiroChart
                  symbol={symbol}
                  series={hiro?.series ?? null}
                  currentCumulative={hiro?.current_cumulative ?? 0}
                  currentSigned={hiro?.current_signed ?? 0}
                  trend={hiro?.trend ?? "neutral"}
                  loading={loadingInitial && !hiro}
                />
              </RevealItem>
              <RevealItem index={1}>
                <CharmHeatmap symbol={symbol} series={intraday?.charm_decay_series ?? null} loading={loadingInitial && !intraday} />
              </RevealItem>
              <RevealItem index={2}>
                <GammaFlipTracker
                  symbol={symbol}
                  spotSeries={intraday?.spot_series ?? null}
                  flipSeries={intraday?.zero_gamma_series ?? null}
                  loading={loadingInitial && !intraday}
                />
              </RevealItem>
              <RevealItem index={3}>
                <HistoricalReplay
                  symbol={symbol}
                  series={intraday?.spot_series ?? null}
                  onSeek={handleSeek}
                  currentSeekTs={seekTs}
                  loading={loadingInitial && !intraday}
                />
              </RevealItem>
              <RevealItem index={4}>
                <GexCurveChart
                  symbol={symbol}
                  title="Chain-wide GEX"
                  subtitle="All expirations combined."
                  data={view.chainGex}
                  spot={view.cashSpot}
                  zeroGamma={view.zeroGamma}
                  height={220}
                  variant="secondary"
                  loading={loadingInitial && !view.chainGex}
                />
              </RevealItem>
            </>
          )}

          {tab === "flow" && (
            <>
              <RevealItem index={0}>
                <PremiumFlowPanel
                  symbol={symbol}
                  cumulativeCallPremium={flow?.cumulative_call_premium ?? 0}
                  cumulativePutPremium={flow?.cumulative_put_premium ?? 0}
                  netPremium={flow?.net_premium ?? 0}
                  series={flow?.series ?? null}
                  topBlocks={flow?.top_blocks ?? null}
                  loading={loadingInitial && !flow}
                />
              </RevealItem>
              <RevealItem index={1}>
                <DealerPositioning
                  symbol={symbol}
                  spot={dealer?.spot ?? view.cashSpot}
                  strikes={dealer?.strikes ?? null}
                  loading={loadingInitial && !dealer}
                />
              </RevealItem>
              <RevealItem index={2}>
                <StrikeMigration
                  symbol={symbol}
                  spot={view.cashSpot}
                  callWallsNow={migration?.call_walls_now ?? null}
                  callWalls1hAgo={migration?.call_walls_1h_ago ?? null}
                  putWallsNow={migration?.put_walls_now ?? null}
                  putWalls1hAgo={migration?.put_walls_1h_ago ?? null}
                  loading={loadingInitial && !migration}
                />
              </RevealItem>
            </>
          )}

          {tab === "chain" && (
            <>
              <RevealItem index={0} className="grid gap-3 md:grid-cols-1 lg:grid-cols-[1fr_1.6fr]">
                <FullChainHeatmap
                  symbol={symbol}
                  spot={absoluteGamma?.spot ?? view.cashSpot}
                  strikes={absoluteGamma?.strikes ?? null}
                  highlightStrike={highlightStrike}
                  onHighlight={handleHighlight}
                  loading={loadingInitial && !absoluteGamma}
                />
                <AbsoluteGammaChart
                  symbol={symbol}
                  spot={absoluteGamma?.spot ?? view.cashSpot}
                  strikes={absoluteGamma?.strikes ?? null}
                  topWalls={absoluteGamma?.top_5_walls ?? null}
                  loading={loadingInitial && !absoluteGamma}
                />
              </RevealItem>
              <RevealItem index={1}>
                <OptionsChainTable
                  symbol={symbol}
                  expiry={chain?.expiry ?? null}
                  spot={chain?.spot ?? view.cashSpot}
                  rows={chain?.rows ?? null}
                  loading={loadingInitial && !chain}
                />
              </RevealItem>
            </>
          )}

          {tab === "vol" && (
            <>
              <RevealItem index={0} className="grid gap-3 md:grid-cols-1 lg:grid-cols-2">
                <SkewChart
                  symbol={symbol}
                  byExpiry={skew?.by_expiry ?? null}
                  current25dRr={skew?.current_25d_rr ?? null}
                  loading={loadingInitial && !skew}
                />
                <TermStructureChart
                  symbol={symbol}
                  points={termStructure?.points ?? null}
                  isInverted={termStructure?.is_inverted ?? false}
                  frontBackSpread={termStructure?.front_back_spread ?? null}
                  loading={loadingInitial && !termStructure}
                />
              </RevealItem>
              <RevealItem index={1}>
                <MoveTrackerCard
                  symbol={symbol}
                  impliedMove={moveTracker?.implied_move ?? null}
                  realizedMove={moveTracker?.realized_move ?? null}
                  ratio={moveTracker?.ratio ?? null}
                  regime={moveTracker?.regime ?? "in_range"}
                  loading={loadingInitial && !moveTracker}
                />
              </RevealItem>
              <RevealItem index={2}>
                <VolTriggerCard
                  symbol={symbol}
                  volTrigger={volTrigger?.vol_trigger ?? null}
                  spot={volTrigger?.spot ?? view.cashSpot}
                  distancePts={volTrigger?.distance_pts ?? null}
                  distancePct={volTrigger?.distance_pct ?? null}
                  belowTrigger={volTrigger?.below_trigger ?? false}
                  regime={volTrigger?.regime ?? "stable"}
                  loading={loadingInitial && !volTrigger}
                />
              </RevealItem>
            </>
          )}
        </DashboardGrid>
      </section>
    </Layout>
  );
}

interface DashboardGridProps {
  loading: boolean;
  children: React.ReactNode;
}

function DashboardGrid({ loading, children }: DashboardGridProps) {
  if (loading) return <DashboardSkeleton />;
  return <div className="grid gap-3 sm:gap-4">{children}</div>;
}

interface RevealItemProps {
  index: number;
  children: React.ReactNode;
  className?: string;
}

function RevealItem({ index, children, className }: RevealItemProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 * index, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface TabBarProps {
  value: TabKey;
  onChange: (next: TabKey) => void;
}

const TAB_LABELS: Record<TabKey, string> = {
  pro: "Pro",
  intraday: "Intraday",
  flow: "Flow",
  chain: "Chain",
  vol: "Vol Surface",
};

function TabBar({ value, onChange }: TabBarProps) {
  return (
    <div
      className="liquid-glass mb-5 inline-flex rounded-full p-1 overflow-x-auto"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      {TAB_KEYS.map((k) => {
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            aria-pressed={active}
            className="relative h-8 px-4 rounded-full text-[11px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors"
            style={{
              color: active ? "var(--accent-foid)" : "var(--text-secondary)",
              background: active
                ? "color-mix(in srgb, var(--bg) 65%, transparent)"
                : "transparent",
              border: active
                ? "1px solid var(--border-foid-strong)"
                : "1px solid transparent",
              boxShadow: active
                ? "inset 0 1px 1px rgba(255,255,255,0.06)"
                : undefined,
            }}
          >
            {TAB_LABELS[k]}
          </button>
        );
      })}
    </div>
  );
}

interface SymbolToggleProps {
  value: Symbol;
  onChange: (next: Symbol) => void;
}

function SymbolToggle({ value, onChange }: SymbolToggleProps) {
  const reduce = useReducedMotion();
  return (
    <div
      className="liquid-glass inline-flex rounded-full p-0.5"
      style={{ fontFamily: "var(--font-mono-foid)" }}
    >
      {SUPPORTED_SYMBOLS.map((sym) => {
        const active = value === sym;
        return (
          <motion.button
            key={sym}
            type="button"
            onClick={() => onChange(sym)}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            aria-pressed={active}
            className="relative h-8 px-4 rounded-full text-[11px] uppercase tracking-[0.18em] transition-colors"
            style={{
              color: active ? "var(--accent-foid)" : "var(--text-secondary)",
              background: active
                ? "color-mix(in srgb, var(--bg) 65%, transparent)"
                : "transparent",
              border: active
                ? "1px solid var(--border-foid-strong)"
                : "1px solid transparent",
              boxShadow: active
                ? "inset 0 1px 1px rgba(255,255,255,0.06)"
                : undefined,
            }}
          >
            {sym}
          </motion.button>
        );
      })}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-3 sm:gap-4">
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="liquid-glass rounded-2xl p-5"
            style={{ border: "1px solid var(--border-foid)" }}
          >
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="mt-4 h-12 w-32 rounded-lg" />
            <Skeleton className="mt-3 h-3 w-40 rounded" />
          </div>
        ))}
      </div>
      <div
        className="liquid-glass rounded-2xl p-5"
        style={{ border: "1px solid var(--border-foid)" }}
      >
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="mt-4 h-72 w-full rounded-lg" />
      </div>
    </div>
  );
}

interface DerivedView {
  spot: SpotPayload | null;
  cashSpot: number | null;
  futuresPrice: number | null;
  futuresContract: string | null;
  zeroGamma: number | null;
  zeroDte: ZeroDtePayload | null;
  chainGex: GexPayload | null;
  futuresLevels: FuturesKeyLevel[];
}

interface DeriveInput {
  live: DataEnvelope | null;
  snapshot: DataEnvelope | null;
  lastClose: LastCloseResponse | null;
  futuresLevels: FuturesLevelsSnapshot | null;
  tick: TickFrame | null;
}

function deriveView({ live, snapshot, lastClose, futuresLevels, tick }: DeriveInput): DerivedView {
  const data: SnapshotData = live?.data ?? snapshot?.data ?? lastClose?.data ?? ({} as SnapshotData);
  const baseSpot = data.spot ?? null;

  // Fast-path: when a fresh price tick is available, splice it into the spot
  // payload so SpotHero / FuturesOverlayToggle render at OPRA cadence rather
  // than the 30s pipeline cadence. We only override the price fields and
  // keep everything else (source, parity, basis_age) from the snapshot.
  // Guard: only splice if the tick's symbol matches what the envelope is for,
  // otherwise an in-flight tick from a previous symbol could leak through.
  let spot: SpotPayload | null = baseSpot;
  const envelopeSymbol = live?.symbol ?? snapshot?.symbol ?? null;
  const tickMatchesSymbol =
    tick !== null && (envelopeSymbol === null || tick.symbol === envelopeSymbol);
  if (tick && tickMatchesSymbol) {
    spot = {
      price: tick.cash_spot ?? baseSpot?.price ?? 0,
      source: baseSpot?.source ?? "futures_basis",
      futures_price: tick.futures_price,
      basis: tick.basis ?? baseSpot?.basis ?? null,
      basis_age_seconds: 0,
      parity_price: baseSpot?.parity_price ?? null,
      parity_deviation_pct: baseSpot?.parity_deviation_pct ?? null,
    };
  }

  const cashSpot = spot?.price ?? null;
  const futuresPrice =
    (tick && tickMatchesSymbol ? tick.futures_price : null) ??
    futuresLevels?.futures_price ??
    spot?.futures_price ??
    null;
  const futuresContract =
    (tick && tickMatchesSymbol ? tick.futures_symbol : null) ??
    futuresLevels?.futures_contract ??
    null;
  const zeroGamma = data.zero_gamma?.oi ?? null;

  return {
    spot, cashSpot, futuresPrice, futuresContract, zeroGamma,
    zeroDte: data.zero_dte ?? null,
    chainGex: data.gex ?? null,
    futuresLevels: futuresLevels?.levels ?? [],
  };
}
