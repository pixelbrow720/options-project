/**
 * Axios-based API client for the public-site.
 *
 * Notes:
 * - All authenticated requests carry a Bearer JWT obtained via either the
 *   API-key login flow (`POST /public/auth/login`) or the Discord OAuth
 *   callback (`/auth/callback?token=…`).
 * - We never send `X-API-Key` from the browser. The backend looks up the
 *   user's assigned key internally using the session JWT.
 * - On 401 we clear the stored token and bounce to /login (unless we are
 *   already on a public route).
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";

export const TOKEN_STORAGE_KEY = "pw_public_token";

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const override = (window as unknown as { __API_BASE__?: string }).__API_BASE__;
    if (override) return override;
  }
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

const PUBLIC_PATHS = new Set(["/", "/login", "/register", "/auth/callback"]);

// Default request timeout (ms). The backend tunnel goes through Cloudflare
// (us-east-1 by default) plus a Cloudflared origin in Indonesia, so the
// realistic upper bound for a healthy request round-trip is ~3-4s. We pick
// 15s to allow for slow cold-starts on intraday/flow endpoints while still
// failing fast on hung connections (instead of hanging forever, which lets
// the UI display a recoverable error and the caller's retry/backoff kicks in).
const DEFAULT_TIMEOUT_MS = 15_000;

export const api: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: DEFAULT_TIMEOUT_MS,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      setStoredToken(null);
      // Drop any axios default Authorization header that an extension or
      // future code path may have set — defence-in-depth so the next request
      // can't accidentally reuse a revoked token.
      if (api.defaults.headers.common) {
        delete (api.defaults.headers.common as Record<string, unknown>).Authorization;
      }
      if (typeof window !== "undefined" && !PUBLIC_PATHS.has(window.location.pathname)) {
        // Idempotent redirect: if many in-flight requests 401 simultaneously
        // (token expired mid-burst), only the first one should trigger the
        // navigation. Subsequent 401s find `__pwRedirecting__` already set
        // and skip the redirect, preventing a thrash that can lose the
        // `next=` parameter or interrupt a navigation already in progress.
        const w = window as unknown as { __pwRedirecting__?: boolean };
        if (!w.__pwRedirecting__) {
          w.__pwRedirecting__ = true;
          // Preserve the page the user was on so they can be returned after
          // re-login. We use `?next=` rather than router state because the
          // 401 path is a full document navigation.
          const here = window.location.pathname + window.location.search;
          const next = encodeURIComponent(here);
          window.location.href = `/login?next=${next}`;
        }
      }
    }
    return Promise.reject(error);
  },
);

// ── Domain types ──────────────────────────────────────────────────────────

export type UserStatus = "pending" | "approved" | "rejected" | "banned";

export interface User {
  id: number;
  discord_id: string;
  discord_username: string;
  discord_avatar: string | null;
  status: UserStatus;
  guild_verified: boolean;
  has_api_key: boolean;
  created_at: string;
}

export interface MeResponse {
  user: User;
  status: UserStatus;
  api_key_label: string | null;
  api_key_prefix: string | null;
  has_api_key: boolean;
}

export interface LoginResponse {
  token: string;
  user: User;
  api_key_label: string | null;
  api_key_prefix: string | null;
}

export interface DiscordStartResponse {
  url: string;
}

// ── Snapshot / metric payloads ────────────────────────────────────────────

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

export interface SnapshotData {
  gex?: GexPayload;
  gex_volume?: GexPayload;
  zero_gamma?: { oi: number | null; volume: number | null; underlying_price: number | null };
  max_pain?: MaxPainPayload;
  walls?: WallsPayload;
  session_state?: SessionStatePayload;
  spot?: SpotPayload;
  zero_dte?: ZeroDtePayload;
  back_month?: BackMonthPayload;
  pin_probability?: PinProbabilityPayload;
  move_tracker?: MoveTrackerPayload;
}

export interface DataEnvelope {
  symbol: string;
  computed_at: string | null;
  next_update_in_seconds: number;
  data: SnapshotData;
}

export type FuturesKeyLevelKind =
  | "flip"
  | "wall_call"
  | "wall_put"
  | "max_pain"
  | "gex_pos"
  | "gex_neg";

export interface FuturesKeyLevel {
  label: string;
  kind: FuturesKeyLevelKind;
  cash_strike: number;
  futures_level: number;
  distance_pts: number | null;
  distance_pct: number | null;
  weight_value: number | null;
  rank: number | null;
}

export interface FuturesLevelsSnapshot {
  cash_symbol: string;
  futures_root: string;
  futures_contract: string | null;
  futures_price: number | null;
  cash_spot: number | null;
  basis: number | null;
  basis_age_seconds: number | null;
  spot_source: string | null;
  computed_at: string | null;
  levels: FuturesKeyLevel[];
}

export interface FuturesLevelsEnvelope extends DataEnvelope {
  data: SnapshotData & { futures_levels?: FuturesLevelsSnapshot };
}

export interface LastCloseResponse {
  computed_at: string | null;
  hours_old: number | null;
  data: SnapshotData;
  market_open_in_seconds: number | null;
  market_open_iso: string | null;
}

// ── Auth client ──────────────────────────────────────────────────────────

export const Auth = {
  async discordStart(): Promise<DiscordStartResponse> {
    const resp = await api.get<DiscordStartResponse>("/public/auth/discord/start");
    return resp.data;
  },
  async login(apiKey: string): Promise<LoginResponse> {
    const resp = await api.post<LoginResponse>("/public/auth/login", { api_key: apiKey });
    return resp.data;
  },
  async me(config?: AxiosRequestConfig): Promise<MeResponse> {
    const resp = await api.get<MeResponse>("/public/me", config);
    return resp.data;
  },
  async logout(): Promise<void> {
    try {
      await api.post("/public/auth/logout");
    } finally {
      setStoredToken(null);
    }
  },
};

// ── Symbol data client ───────────────────────────────────────────────────

// ── New 0DTE endpoint payloads ───────────────────────────────────────────

export interface TimePoint {
  ts: string;
  value: number;
}

export interface IntradayPayload {
  spot_series: TimePoint[];
  gex_net_series: TimePoint[];
  gex_0dte_net_series: TimePoint[];
  charm_decay_series: TimePoint[];
  flip_speed_series: TimePoint[];
  zero_gamma_series: TimePoint[];
}

export interface DealerStrike {
  strike: number;
  dealer_gamma: number;
  side: "long" | "short" | "neutral";
}

export interface DealerPositioningPayload {
  expiry: string | null;
  spot: number | null;
  strikes: DealerStrike[];
}

export interface FlowSeriesPoint {
  ts: string;
  call_prem: number;
  put_prem: number;
  net: number;
}

export interface FlowBlock {
  ts: string;
  size: number;
  premium: number;
  type: string;
  side: string;
  strike: number;
}

export interface FlowPayload {
  cumulative_call_premium: number;
  cumulative_put_premium: number;
  net_premium: number;
  series: FlowSeriesPoint[];
  top_blocks: FlowBlock[];
}

export interface PinRiskStrike {
  strike: number;
  probability: number;
  oi?: number | null;
}

export interface PinRiskPayload {
  spot: number | null;
  expiry: string | null;
  strikes: PinRiskStrike[];
  top_pin: { strike: number; probability: number } | null;
}

export interface MigrationWall {
  strike: number;
  rank: number;
  value: number;
}

export interface MigrationPayload {
  call_walls_now: MigrationWall[];
  call_walls_1h_ago: MigrationWall[];
  put_walls_now: MigrationWall[];
  put_walls_1h_ago: MigrationWall[];
}

export interface IntradayEnvelope {
  symbol: string;
  computed_at: string | null;
  data: IntradayPayload;
}
export interface DealerPositioningEnvelope {
  symbol: string;
  computed_at: string | null;
  data: DealerPositioningPayload;
}
export interface FlowEnvelope {
  symbol: string;
  computed_at: string | null;
  data: FlowPayload;
}
export interface PinRiskEnvelope {
  symbol: string;
  computed_at: string | null;
  data: PinRiskPayload;
}
export interface MigrationEnvelope {
  symbol: string;
  computed_at: string | null;
  data: MigrationPayload;
}

export const SymbolData = {
  async zeroDte(symbol: string): Promise<DataEnvelope> {
    const resp = await api.get<DataEnvelope>(`/public/${encodeURIComponent(symbol)}/0dte`);
    return resp.data;
  },
  async snapshot(symbol: string): Promise<DataEnvelope> {
    const resp = await api.get<DataEnvelope>(`/public/${encodeURIComponent(symbol)}/snapshot`);
    return resp.data;
  },
  async futuresLevels(symbol: string): Promise<FuturesLevelsEnvelope> {
    const resp = await api.get<FuturesLevelsEnvelope>(
      `/public/${encodeURIComponent(symbol)}/futures-levels`,
    );
    return resp.data;
  },
  async spot(symbol: string): Promise<DataEnvelope> {
    const resp = await api.get<DataEnvelope>(`/public/${encodeURIComponent(symbol)}/spot`);
    return resp.data;
  },
  async lastClose(symbol: string): Promise<LastCloseResponse> {
    const resp = await api.get<LastCloseResponse>(
      `/public/${encodeURIComponent(symbol)}/last-close`,
    );
    return resp.data;
  },
  async intraday(symbol: string, hours = 6): Promise<IntradayEnvelope> {
    const resp = await api.get<IntradayEnvelope>(
      `/public/${encodeURIComponent(symbol)}/intraday`,
      { params: { hours } },
    );
    return resp.data;
  },
  async dealerPositioning(symbol: string): Promise<DealerPositioningEnvelope> {
    const resp = await api.get<DealerPositioningEnvelope>(
      `/public/${encodeURIComponent(symbol)}/dealer-positioning`,
    );
    return resp.data;
  },
  async flow(symbol: string, hours = 6): Promise<FlowEnvelope> {
    const resp = await api.get<FlowEnvelope>(
      `/public/${encodeURIComponent(symbol)}/flow`,
      { params: { hours } },
    );
    return resp.data;
  },
  async pinRisk(symbol: string): Promise<PinRiskEnvelope> {
    const resp = await api.get<PinRiskEnvelope>(
      `/public/${encodeURIComponent(symbol)}/pin-risk`,
    );
    return resp.data;
  },
  async migration(symbol: string): Promise<MigrationEnvelope> {
    const resp = await api.get<MigrationEnvelope>(
      `/public/${encodeURIComponent(symbol)}/migration`,
    );
    return resp.data;
  },
  async hiro(symbol: string, hours = 1): Promise<HiroEnvelope> {
    const resp = await api.get<HiroEnvelope>(
      `/public/${encodeURIComponent(symbol)}/hiro`,
      { params: { hours } },
    );
    return resp.data;
  },
  async chain(symbol: string, params?: { expiry?: string; strike_min?: number; strike_max?: number }): Promise<ChainEnvelope> {
    const resp = await api.get<ChainEnvelope>(
      `/public/${encodeURIComponent(symbol)}/chain`,
      { params },
    );
    return resp.data;
  },
  async volTrigger(symbol: string): Promise<VolTriggerEnvelope> {
    const resp = await api.get<VolTriggerEnvelope>(
      `/public/${encodeURIComponent(symbol)}/vol-trigger`,
    );
    return resp.data;
  },
  async absoluteGamma(symbol: string): Promise<AbsoluteGammaEnvelope> {
    const resp = await api.get<AbsoluteGammaEnvelope>(
      `/public/${encodeURIComponent(symbol)}/absolute-gamma`,
    );
    return resp.data;
  },
  async skew(symbol: string): Promise<SkewEnvelope> {
    const resp = await api.get<SkewEnvelope>(
      `/public/${encodeURIComponent(symbol)}/skew`,
    );
    return resp.data;
  },
  async termStructure(symbol: string): Promise<TermStructureEnvelope> {
    const resp = await api.get<TermStructureEnvelope>(
      `/public/${encodeURIComponent(symbol)}/term-structure`,
    );
    return resp.data;
  },
  async moveTracker(symbol: string): Promise<MoveTrackerEnvelope> {
    const resp = await api.get<MoveTrackerEnvelope>(
      `/public/${encodeURIComponent(symbol)}/move-tracker`,
    );
    return resp.data;
  },
  async regime(symbol: string): Promise<RegimeEnvelope> {
    const resp = await api.get<RegimeEnvelope>(
      `/public/${encodeURIComponent(symbol)}/regime`,
    );
    return resp.data;
  },
};

// ── SpotGamma-grade payload types ──────────────────────────────────────

export interface HiroSeriesPoint {
  ts: string;
  cumulative: number;
  call_premium?: number;
  put_premium?: number;
  net_signed?: number;
}

export interface HiroPayload {
  series: HiroSeriesPoint[];
  current_cumulative: number;
  current_signed: number;
  trend: "bullish" | "bearish" | "neutral";
}

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

export interface ChainPayload {
  expiry: string | null;
  spot: number | null;
  rows: ChainRow[];
}

export interface VolTriggerPayload {
  vol_trigger: number | null;
  spot: number | null;
  distance_pts: number | null;
  distance_pct: number | null;
  below_trigger: boolean;
  regime: "stable" | "vol_expansion";
}

export interface AbsoluteGammaStrike {
  strike: number;
  abs_gamma: number;
  net_gamma: number;
}

export interface AbsoluteGammaPayload {
  spot: number | null;
  strikes: AbsoluteGammaStrike[];
  top_5_walls: AbsoluteGammaStrike[];
}

export interface SkewByExpiry {
  expiry: string;
  skew: number;
  label: string;
}

export interface SkewPayload {
  by_expiry: SkewByExpiry[];
  current_25d_rr: number | null;
}

export interface TermPoint {
  dte: number;
  iv: number;
  expiry: string;
}

export interface TermStructurePayload {
  points: TermPoint[];
  is_inverted: boolean;
  front_back_spread: number | null;
}

export interface MoveTrackerPublicPayload {
  implied_move: number | null;
  realized_move: number | null;
  ratio: number | null;
  regime: "compressed" | "expanded" | "in_range";
}

export interface RegimePayload {
  gex_regime: "positive" | "negative" | "neutral" | null;
  gex_score: number | null;
  vol_regime: "low" | "high" | null;
  flow_regime: "bullish" | "bearish" | "neutral" | null;
  summary: string | null;
  narrative: string | null;
}

export interface HiroEnvelope { symbol: string; computed_at: string | null; data: HiroPayload; }
export interface ChainEnvelope { symbol: string; computed_at: string | null; data: ChainPayload; }
export interface VolTriggerEnvelope { symbol: string; computed_at: string | null; data: VolTriggerPayload; }
export interface AbsoluteGammaEnvelope { symbol: string; computed_at: string | null; data: AbsoluteGammaPayload; }
export interface SkewEnvelope { symbol: string; computed_at: string | null; data: SkewPayload; }
export interface TermStructureEnvelope { symbol: string; computed_at: string | null; data: TermStructurePayload; }
export interface MoveTrackerEnvelope { symbol: string; computed_at: string | null; data: MoveTrackerPublicPayload; }
export interface RegimeEnvelope { symbol: string; computed_at: string | null; data: RegimePayload; }

export interface ApiErrorBody {
  detail?: string | { msg: string }[];
  error?: string;
  message?: string;
}

export function describeApiError(err: unknown, fallback = "Request failed"): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.detail) {
      if (typeof body.detail === "string") return body.detail;
      if (Array.isArray(body.detail) && body.detail[0]?.msg) return body.detail[0].msg;
    }
    if (body?.message) return body.message;
    if (body?.error) return body.error;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
