/**
 * Fixture mode — realistic SPX/NDXP snapshot for Friday 2026-05-22 close.
 *
 * Lets the frontend develop visual design without a running backend. To
 * activate, set ``VITE_USE_FIXTURE=1`` in ``.env`` (or pass to ``vite dev``).
 * When the flag is on, ``LiveSnapshotProvider`` skips the WS connection and
 * yields the fixture envelope below at a fixed cadence so motion and
 * connection-status UI still exercise.
 *
 * Data shape mirrors ``GET /v1/{symbol}/snapshot.data`` (see
 * docs/api_reference.md). Numbers are illustrative — close to a typical SPX
 * Friday afternoon profile, not a literal capture.
 */

import type { SnapshotData, SnapshotEnvelope } from "./streamClient";

const SPX_SPOT = 5234.18;

// Build a plausible GEX curve centered on spot. Negative below spot (puts
// dominate), positive above (calls dominate), with the flip point around
// 4485 — an artefact of dealer hedging conventions on a typical Friday.
function buildGexCurve(spot: number) {
  const strikes: number[] = [];
  for (let k = spot - 200; k <= spot + 200; k += 5) strikes.push(Math.round(k));

  return strikes.map((strike, idx) => {
    const dist = strike - spot;
    // Asymmetric Gaussian-ish profile
    const callPart =
      dist >= 0
        ? 8.5e7 * Math.exp(-Math.pow(dist - 30, 2) / 8000) +
          3.2e7 * Math.exp(-Math.pow(dist - 80, 2) / 2500)
        : 1.2e7 * Math.exp(-Math.pow(dist + 20, 2) / 1500);
    const putPart =
      dist <= 0
        ? -1.1e8 * Math.exp(-Math.pow(dist + 25, 2) / 6000) -
          4.5e7 * Math.exp(-Math.pow(dist + 60, 2) / 3000)
        : -1.5e7 * Math.exp(-Math.pow(dist - 15, 2) / 1200);
    // Inject some realistic noise per strike
    const noise = (Math.sin(idx * 1.13) + Math.cos(idx * 0.71)) * 5e6;
    const callGex = callPart + Math.abs(noise) * 0.4;
    const putGex = putPart - Math.abs(noise) * 0.4;
    return {
      strike,
      call_gex: Math.round(callGex),
      put_gex: Math.round(putGex),
      net_gex: Math.round(callGex + putGex),
    };
  });
}

const gexCurve = buildGexCurve(SPX_SPOT);
const gexNetTotal = gexCurve.reduce((a, b) => a + b.net_gex, 0);
const topPositive = [...gexCurve].sort((a, b) => b.net_gex - a.net_gex).slice(0, 5);
const topNegative = [...gexCurve].sort((a, b) => a.net_gex - b.net_gex).slice(0, 5);

// Build HIRO series — last 60 minutes of 1-minute buckets, ramping
// positive (bullish flow into Friday close), with realistic delta-notional
// magnitudes (~hundreds of thousands of share-equivalents).
function buildHiroSeries() {
  const now = new Date("2026-05-22T20:00:00Z").getTime(); // 16:00 ET close
  const series: Array<{
    ts: string;
    call_premium: number;
    put_premium: number;
    net_premium: number;
    cumulative: number;
    call_delta_notional: number;
    put_delta_notional: number;
    net_delta_notional: number;
    next_expiry_delta_notional: number;
    next_expiry_premium: number;
    weight_source: "delta_notional" | "signed_premium";
  }> = [];

  for (let i = 60; i >= 0; i--) {
    const ts = new Date(now - i * 60_000).toISOString();
    // Trend: bullish accumulation toward close; spike at -10min
    const t = (60 - i) / 60;
    const trend = Math.sin(t * Math.PI * 1.2) * 80_000;
    const spike = i === 10 ? 220_000 : i === 9 ? 180_000 : 0;
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 25_000;

    const callDN = trend + spike * 0.7 + noise * 0.6;
    const putDN = -trend * 0.6 + spike * 0.4 - noise * 0.7;
    const netDN = callDN + putDN;

    series.push({
      ts,
      call_premium: Math.round(callDN * 14),
      put_premium: Math.round(putDN * 14),
      net_premium: Math.round(netDN * 14),
      cumulative: Math.round(netDN),
      call_delta_notional: Math.round(callDN),
      put_delta_notional: Math.round(putDN),
      net_delta_notional: Math.round(netDN),
      next_expiry_delta_notional: Math.round(netDN * 0.45),
      next_expiry_premium: Math.round(netDN * 0.45 * 14),
      weight_source: "delta_notional" as const,
    });
  }
  return series;
}

const hiroSeries = buildHiroSeries();

// Walls — realistic call/put concentration around round numbers.
const wallsPayload = {
  call_wall_oi: [
    { rank: 1, strike: 5300, value: 18_500_000 },
    { rank: 2, strike: 5275, value: 14_200_000 },
    { rank: 3, strike: 5250, value: 11_800_000 },
  ],
  put_wall_oi: [
    { rank: 1, strike: 5200, value: 22_400_000 },
    { rank: 2, strike: 5150, value: 16_900_000 },
    { rank: 3, strike: 5100, value: 13_200_000 },
  ],
  call_wall_volume: [
    { rank: 1, strike: 5250, value: 4_200_000 },
    { rank: 2, strike: 5275, value: 3_100_000 },
    { rank: 3, strike: 5240, value: 2_800_000 },
  ],
  put_wall_volume: [
    { rank: 1, strike: 5230, value: 5_400_000 },
    { rank: 2, strike: 5200, value: 4_100_000 },
    { rank: 3, strike: 5215, value: 3_300_000 },
  ],
};

const flowEvents = [
  {
    id: "evt-001",
    ts: new Date("2026-05-22T19:54:23Z").toISOString(),
    symbol: "SPXW",
    expiration: "2026-05-22",
    strike: 5240,
    option_type: "C",
    event_type: "SWEEP",
    side: 1,
    size: 850,
    price: 12.4,
    legs: 4,
    venues: ["CBOE", "ISE", "NYSE", "PHLX"],
  },
  {
    id: "evt-002",
    ts: new Date("2026-05-22T19:51:08Z").toISOString(),
    symbol: "SPXW",
    expiration: "2026-05-22",
    strike: 5200,
    option_type: "P",
    event_type: "BLOCK",
    side: -1,
    size: 1200,
    price: 8.2,
    legs: 1,
    venues: ["CBOE"],
  },
  {
    id: "evt-003",
    ts: new Date("2026-05-22T19:48:42Z").toISOString(),
    symbol: "SPXW",
    expiration: "2026-05-29",
    strike: 5300,
    option_type: "C",
    event_type: "UOA",
    side: 1,
    size: 320,
    price: 4.1,
    legs: 1,
    venues: ["CBOE"],
  },
  {
    id: "evt-004",
    ts: new Date("2026-05-22T19:42:11Z").toISOString(),
    symbol: "SPXW",
    expiration: "2026-05-22",
    strike: 5250,
    option_type: "C",
    event_type: "SWEEP",
    side: 1,
    size: 540,
    price: 6.7,
    legs: 3,
    venues: ["CBOE", "ISE", "BOX"],
  },
  {
    id: "evt-005",
    ts: new Date("2026-05-22T19:38:55Z").toISOString(),
    symbol: "SPXW",
    expiration: "2026-05-22",
    strike: 5180,
    option_type: "P",
    event_type: "BLOCK",
    side: -1,
    size: 980,
    price: 3.4,
    legs: 1,
    venues: ["AMEX"],
  },
];

export const FRIDAY_FIXTURE_DATA: SnapshotData = {
  gex: {
    net_total: gexNetTotal,
    curve: gexCurve,
    top_positive: topPositive,
    top_negative: topNegative,
    zero_gamma: 5198.5,
    underlying_price: SPX_SPOT,
  },
  gex_volume: {
    net_total: gexNetTotal * 0.62,
    curve: gexCurve.map((c) => ({
      ...c,
      call_gex: Math.round((c.call_gex ?? 0) * 0.6),
      put_gex: Math.round((c.put_gex ?? 0) * 0.6),
      net_gex: Math.round(c.net_gex * 0.6),
    })),
    top_positive: topPositive.map((c) => ({
      ...c,
      net_gex: Math.round(c.net_gex * 0.6),
    })),
    top_negative: topNegative.map((c) => ({
      ...c,
      net_gex: Math.round(c.net_gex * 0.6),
    })),
    zero_gamma: 5191.2,
    underlying_price: SPX_SPOT,
  },
  zero_gamma: { oi: 5198.5, volume: 5191.2, underlying_price: SPX_SPOT },
  max_pain: {
    per_expiry: [
      { expiration: "2026-05-22", strike: 5225, pain: 12_400_000 },
      { expiration: "2026-05-29", strike: 5230, pain: 18_900_000 },
      { expiration: "2026-06-05", strike: 5240, pain: 22_300_000 },
    ],
    aggregate: { strike: 5230, value: 84_200_000 },
  },
  walls: wallsPayload,
  iv: {
    atm_iv: 0.142,
    skew_per_expiry: {
      "2026-05-22": -0.018,
      "2026-05-29": -0.024,
      "2026-06-05": -0.031,
      "2026-06-13": -0.028,
    },
    surface: [],
  },
  regime: {
    oi: {
      score: 0.42,
      label: "bullish",
      call_wall_total: 44_500_000,
      put_wall_total: 52_500_000,
      net_gex: gexNetTotal,
    },
    vol: {
      score: 0.18,
      label: "neutral",
      call_wall_total: 10_100_000,
      put_wall_total: 12_800_000,
      net_gex: gexNetTotal * 0.6,
    },
    label: "bullish",
    score: 0.42,
  },
  hiro: {
    bucket_size: "1min",
    cumulative: hiroSeries[hiroSeries.length - 1].cumulative,
    series: hiroSeries,
  },
  flow: {
    events: flowEvents,
    counts: { SWEEP: 12, BLOCK: 4, UOA: 7 },
  },
  session_state: {
    is_rth: false, // After Friday close
    session_open: "2026-05-22T13:30:00Z",
    session_close: "2026-05-22T20:15:00Z",
    minutes_to_close: -914.5,
    tau_0dte_years: 0,
    is_expiration_day: false,
    symbol: "SPXW",
  },
  spot: {
    price: SPX_SPOT,
    source: "futures_basis",
    futures_price: 5234.85,
    basis: -0.67,
    basis_age_seconds: 1.2,
    parity_price: 5234.04,
    parity_deviation_pct: 0.003,
  },
  zero_dte: {
    gex_oi: {
      net_total: -2.4e8,
      curve: gexCurve.slice(20, 60).map((c) => ({
        ...c,
        net_gex: Math.round(c.net_gex * 0.18),
      })),
      top_positive: topPositive.slice(0, 3).map((c) => ({
        ...c,
        net_gex: Math.round(c.net_gex * 0.18),
      })),
      top_negative: topNegative.slice(0, 3).map((c) => ({
        ...c,
        net_gex: Math.round(c.net_gex * 0.18),
      })),
      zero_gamma: 5212.8,
      underlying_price: SPX_SPOT,
    },
    gex_volume: {
      net_total: -1.6e8,
      curve: gexCurve.slice(20, 60).map((c) => ({
        ...c,
        net_gex: Math.round(c.net_gex * 0.12),
      })),
      top_positive: [],
      top_negative: [],
      zero_gamma: 5208.1,
      underlying_price: SPX_SPOT,
    },
    charm_total: {
      net_total: -8.4e6,
      curve: [],
      top_positive: [],
      top_negative: [],
    },
    charm_decay_rate: 0.024,
    flip_speed: 4.2e5,
  },
  back_month: {
    gex_oi: {
      net_total: gexNetTotal * 0.82,
      curve: gexCurve,
      top_positive: topPositive,
      top_negative: topNegative,
    },
    gex_volume: {
      net_total: gexNetTotal * 0.5,
      curve: gexCurve.map((c) => ({ ...c, net_gex: Math.round(c.net_gex * 0.6) })),
      top_positive: [],
      top_negative: [],
    },
  },
  pin_probability: {
    per_strike: [
      { strike: 5225, probability: 0.18, oi: 4500, abs_charm: 1200 },
      { strike: 5230, probability: 0.22, oi: 6800, abs_charm: 1840 },
      { strike: 5235, probability: 0.31, oi: 9400, abs_charm: 2310 },
      { strike: 5240, probability: 0.16, oi: 5200, abs_charm: 1450 },
    ],
    top: [
      { strike: 5235, probability: 0.31, oi: 9400, abs_charm: 2310 },
      { strike: 5230, probability: 0.22, oi: 6800, abs_charm: 1840 },
    ],
  },
  move_tracker: {
    realized_move: 0.42,
    implied_move: 0.55,
    ratio: 0.76,
  },
};

export const FRIDAY_FIXTURE: SnapshotEnvelope = {
  symbol: "SPXW",
  computed_at: "2026-05-22T20:00:00Z",
  next_update_in_seconds: 60,
  data: FRIDAY_FIXTURE_DATA,
};

export function isFixtureMode(): boolean {
  return import.meta.env.VITE_USE_FIXTURE === "1";
}
