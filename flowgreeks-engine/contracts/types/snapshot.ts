/**
 * FlowGreeks API contract — snapshot envelope and all payload sub-shapes.
 *
 * This file is the canonical TypeScript contract between the backend
 * (this repo) and the frontend (separate workspace). When the backend changes
 * a payload shape, this file MUST be updated. The frontend imports from a
 * mirror of this file via `npm run sync:contracts` (see scripts/).
 *
 * Source endpoint: GET /v1/{symbol}/snapshot, plus WS frames on
 * /v1/{symbol}/stream and SSE on /v1/{symbol}/stream/sse.
 *
 * Generated from the backend's pipeline output. See PROJECT_OVERVIEW.md
 * "Pipeline output contract" for which metric_type maps to which payload.
 */

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error"
  | "auth-failed";

// ── GEX ────────────────────────────────────────────────────────────────────

export interface GexStrike {
  strike: number;
  net_gex: number;
  call_gex?: number;
  put_gex?: number;
}

export interface GexPayload {
  net_total: number;
  curve: GexStrike[];
  top_positive?: GexStrike[];
  top_negative?: GexStrike[];
  zero_gamma?: number | null;
  underlying_price?: number | null;
}

// ── Walls ──────────────────────────────────────────────────────────────────

export interface WallStrike {
  rank: number;
  strike: number;
  value: number;
}

export interface WallsPayload {
  call_wall_oi?: WallStrike[];
  put_wall_oi?: WallStrike[];
  call_wall_volume?: WallStrike[];
  put_wall_volume?: WallStrike[];
}

// ── Max-pain ───────────────────────────────────────────────────────────────

export interface MaxPainPerExpiry {
  expiration: string;
  strike: number;
  pain: number;
}

export interface MaxPainAggregate {
  strike: number;
  value: number;
}

export interface MaxPainPayload {
  per_expiry: MaxPainPerExpiry[];
  aggregate: MaxPainAggregate | null;
}

// ── Regime ─────────────────────────────────────────────────────────────────

export type RegimeLabel = "bullish" | "neutral" | "bearish";

export interface RegimeEntry {
  score: number;
  label: RegimeLabel | string;
  call_wall_total: number;
  put_wall_total: number;
  net_gex: number;
}

export interface RegimePayload {
  oi: RegimeEntry | null;
  vol: RegimeEntry | null;
  label?: RegimeLabel | string;
  score?: number;
}

// ── HIRO (SpotGamma-style) ─────────────────────────────────────────────────

export interface HiroSeriesPoint {
  ts: string;
  /** Legacy scalar — kept for older clients. */
  value?: number;
  /** Per-bucket reset cumulative — equals net of the bucket. */
  cumulative?: number;
  // Legacy signed-premium breakdown (USD)
  call_premium?: number;
  put_premium?: number;
  net_premium?: number;
  // Canonical SpotGamma delta-notional fields (share-equivalents)
  call_delta_notional?: number;
  put_delta_notional?: number;
  net_delta_notional?: number;
  next_expiry_delta_notional?: number;
  next_expiry_premium?: number;
  weight_source?: "delta_notional" | "signed_premium";
}

export interface HiroPayload {
  bucket_size?: string;
  cumulative: number;
  series: HiroSeriesPoint[];
  /** Aggregate provenance — `delta_notional` if every bucket had delta data,
   * `signed_premium` if every bucket fell back, `mixed` otherwise. */
  weight_source?: "delta_notional" | "signed_premium" | "mixed";
}

// ── Flow events ────────────────────────────────────────────────────────────

export interface FlowEvent {
  id?: string;
  ts: string;
  symbol?: string;
  expiration?: string | null;
  strike?: number | null;
  option_type?: string;
  event_type: "SWEEP" | "BLOCK" | "UOA" | string;
  /** +1 = customer buy, -1 = customer sell. */
  side: number;
  size?: number;
  premium?: number | null;
  price?: number | null;
  contract_label?: string | null;
  legs?: number;
  venues?: string[];
}

export interface FlowPayload {
  events: FlowEvent[];
  counts?: Record<string, number>;
}

// ── Zero-gamma ─────────────────────────────────────────────────────────────

export interface ZeroGammaPayload {
  oi: number | null;
  volume: number | null;
  underlying_price: number | null;
}

// ── Session, spot, 0DTE, back-month, pin probability, move tracker ─────────

export interface SessionStatePayload {
  is_rth: boolean;
  session_open: string | null;
  session_close: string | null;
  minutes_to_close: number | null;
  tau_0dte_years: number | null;
  is_expiration_day: boolean;
  symbol?: string;
}

export type SpotSource = "futures_basis" | "parity" | "stale_cache";

export interface SpotPayload {
  price: number;
  source: SpotSource | null;
  futures_price: number | null;
  basis: number | null;
  basis_age_seconds: number | null;
  parity_price: number | null;
  parity_deviation_pct: number | null;
}

export interface ZeroDteGexPayload extends GexPayload {
  reason?: string;
  tau_years?: number;
}

export interface ZeroDtePayload {
  gex_oi: ZeroDteGexPayload;
  gex_volume: ZeroDteGexPayload;
  charm_total: GexPayload;
  charm_decay_rate: number;
  flip_speed: number;
}

export interface BackMonthPayload {
  gex_oi: GexPayload;
  gex_volume: GexPayload;
}

export interface PinProbabilityEntry {
  strike: number;
  probability: number;
  oi?: number | null;
  abs_charm?: number | null;
}

export interface PinProbabilityPayload {
  per_strike: PinProbabilityEntry[];
  top: PinProbabilityEntry[];
}

export interface MoveTrackerPayload {
  realized_move?: number | null;
  implied_move?: number | null;
  ratio?: number | null;
}

export interface IvPayload {
  atm_iv: number | null;
  skew_per_expiry: Record<string, number>;
  surface: unknown[];
}

// ── Snapshot envelope (top-level) ──────────────────────────────────────────

export interface SnapshotData {
  gex?: GexPayload;
  gex_volume?: GexPayload;
  zero_gamma?: ZeroGammaPayload;
  max_pain?: MaxPainPayload;
  walls?: WallsPayload;
  iv?: IvPayload;
  regime?: RegimePayload;
  hiro?: HiroPayload;
  flow?: FlowPayload;
  session_state?: SessionStatePayload;
  spot?: SpotPayload;
  zero_dte?: ZeroDtePayload;
  back_month?: BackMonthPayload;
  pin_probability?: PinProbabilityPayload;
  move_tracker?: MoveTrackerPayload;
}

export interface SnapshotEnvelope {
  symbol: string;
  computed_at: string | null;
  next_update_in_seconds: number;
  data: SnapshotData;
}

// ── WebSocket frames ───────────────────────────────────────────────────────

export type WsFrameType = "snapshot" | "tick" | "heartbeat" | "error";

export interface WsSnapshotFrame {
  type: "snapshot";
  envelope: SnapshotEnvelope;
}

export interface WsTickFrame {
  type: "tick";
  symbol: string;
  ts: string;
  spot: number;
  futures?: number | null;
}

export interface WsHeartbeatFrame {
  type: "heartbeat";
  ts: string;
}

export interface WsErrorFrame {
  type: "error";
  code: number;
  message: string;
}

export type WsFrame = WsSnapshotFrame | WsTickFrame | WsHeartbeatFrame | WsErrorFrame;
