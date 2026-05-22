import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

// `__API_BASE__` lets ops set the API origin at runtime without a rebuild —
// inject via `<script>window.__API_BASE__ = "..."</script>` in index.html
// before the bundle is loaded, or via a docker entrypoint that templates the
// HTML. Falls back to the build-time VITE_API_BASE_URL, then localhost dev.
const baseURL =
  (typeof window !== "undefined" && (window as unknown as { __API_BASE__?: string }).__API_BASE__) ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";

export const TOKEN_STORAGE_KEY = "ofa_admin_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export const api: AxiosInstance = axios.create({ baseURL });

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Module-level flag prevents N concurrent failing requests from each kicking
// off their own redirect to /login (would otherwise cause a redirect loop /
// flicker). Reset implicitly by the page reload.
let _redirecting = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && !_redirecting) {
      _redirecting = true;
      setStoredToken(null);
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export interface ApiKeySummary {
  id: string;
  key_prefix: string;
  label: string;
  allowed_symbols: string[];
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  last_used_at: string | null;
  usage_count: number;
}

export interface ApiKeyCreateResponse {
  key: ApiKeySummary;
  plaintext_key: string;
}

export interface SystemStatus {
  pipeline_running: boolean;
  last_databento_event: string | null;
  last_compute_per_symbol: Record<string, string | null>;
  last_compute_duration_ms: Record<string, number>;
  rows_per_symbol: Record<string, number>;
  metric_rows_per_symbol: Record<string, number>;
  active_api_keys: number;
}

export interface HealthResponse {
  status: string;
  now: string;
  supported_symbols: string[];
  compute_interval_seconds: number;
  last_compute_per_symbol: Record<string, string | null>;
}

export const Auth = {
  async login(username: string, password: string): Promise<string> {
    const resp = await api.post("/admin/login", { username, password });
    return resp.data.access_token as string;
  },
};

export const ApiKeys = {
  async list(): Promise<ApiKeySummary[]> {
    const resp = await api.get("/admin/api-keys");
    return resp.data;
  },
  async create(payload: {
    label: string;
    allowed_symbols: string[];
    expires_at: string | null;
  }): Promise<ApiKeyCreateResponse> {
    const resp = await api.post("/admin/api-keys", payload);
    return resp.data;
  },
  async update(
    id: string,
    payload: Partial<{
      label: string;
      allowed_symbols: string[];
      expires_at: string | null;
      is_active: boolean;
    }>,
  ): Promise<ApiKeySummary> {
    const resp = await api.patch(`/admin/api-keys/${id}`, payload);
    return resp.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/admin/api-keys/${id}`);
  },
};

// ── Databento key pool (Rev 4) ────────────────────────────────────────────

export type DatabentoDataset = "OPRA.PILLAR" | "GLBX.MDP3" | "BOTH";

export interface DatabentoKeySummary {
  id: number;
  label: string;
  dataset: DatabentoDataset;
  api_key_prefix: string;
  priority: number;
  is_active: boolean;
  last_used_at: string | null;
  last_error_at: string | null;
  last_error_msg: string | null;
  error_count: number;
  created_at: string;
}

export interface DatabentoKeyCreatePayload {
  label: string;
  dataset: DatabentoDataset;
  api_key: string;
  priority?: number;
  is_active?: boolean;
}

export interface DatabentoKeyTestResult {
  ok: boolean;
  message: string;
}

export const DatabentoKeys = {
  async list(): Promise<DatabentoKeySummary[]> {
    const resp = await api.get("/admin/databento-keys");
    return resp.data;
  },
  async create(payload: DatabentoKeyCreatePayload): Promise<DatabentoKeySummary> {
    const resp = await api.post("/admin/databento-keys", payload);
    return resp.data;
  },
  async update(
    id: number,
    payload: Partial<{
      label: string;
      priority: number;
      is_active: boolean;
    }>,
  ): Promise<DatabentoKeySummary> {
    const resp = await api.patch(`/admin/databento-keys/${id}`, payload);
    return resp.data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/admin/databento-keys/${id}`);
  },
  async test(id: number): Promise<DatabentoKeyTestResult> {
    const resp = await api.post(`/admin/databento-keys/${id}/test`);
    return resp.data;
  },
};

export const Status = {
  async health(): Promise<HealthResponse> {
    const resp = await api.get("/health");
    return resp.data;
  },
  async system(): Promise<SystemStatus> {
    const resp = await api.get("/admin/system/status");
    return resp.data;
  },
};

// ── Data Inspector ──────────────────────────────────────────────────────────

export interface InspectorTable {
  name: string;
  rows: number;
  latest_ts: string | null;
  lag_seconds: number | null;
}

export interface InspectorMetricBreakdown {
  metric_type: string;
  rows: number;
  first_seen: string | null;
  last_seen: string | null;
  lag_seconds: number | null;
}

export interface InspectorLatestMetric {
  metric_type: string;
  symbol: string;
  ts: string | null;
  lag_seconds: number | null;
  value: number | null;
  expiration: string | null;
  strike: number | null;
  extra: Record<string, unknown>;
}

export interface InspectorTermStructureRow {
  symbol: string;
  expiration: string | null;
  days_to_expiry: number | null;
  atm_iv: number | null;
  call_25d_iv: number | null;
  put_25d_iv: number | null;
  risk_reversal_25d: number | null;
}

export interface InspectorPinRow {
  symbol: string;
  strike: number | null;
  probability: number | null;
  oi: number | null;
  abs_charm: number | null;
  atm_iv: number | null;
}

export interface InspectorFlowEvent {
  id: string;
  ts: string | null;
  symbol: string;
  expiration: string | null;
  strike: number | null;
  option_type: string;
  event_type: string;
  side: number;
  size: number;
  price: number | null;
  legs: number;
  venues: string[];
}

export interface InspectorAlertEvent {
  id: string;
  ts: string | null;
  rule_id: string | null;
  symbol: string;
  matched: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface InspectorChainQuality {
  symbol: string;
  rows_last_hour: number;
  latest_ts: string | null;
  lag_seconds: number | null;
  coverage: {
    bid: number | null;
    ask: number | null;
    last_price: number | null;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    oi: number | null;
    volume: number | null;
    underlying_price: number | null;
  };
}

export interface InspectorIngesterDiag {
  registry_size?: number;
  book_size?: number;
  schemas_active?: string[];
  schemas_dropped?: string[];
  record_counts?: Record<string, number>;
  sample_record_attrs?: Record<string, Record<string, unknown>>;
  first_record_at?: string | null;
  last_record_at?: string | null;
  connection_attempts?: number;
  last_error?: string | null;
  system_messages?: string[];
  error_messages?: string[];
  parents?: string[];
  supported_symbols?: string[];
  error?: string;
}

export interface InspectorPayload {
  now: string;
  supported_symbols: string[];
  tables: InspectorTable[];
  metric_breakdown: InspectorMetricBreakdown[];
  latest_metrics: InspectorLatestMetric[];
  term_structure: InspectorTermStructureRow[];
  pin_probability: InspectorPinRow[];
  flow_events: InspectorFlowEvent[];
  alerts: {
    rules_total: number;
    rules_enabled: number;
    events: InspectorAlertEvent[];
  };
  chain_quality?: InspectorChainQuality[];
  ingesters?: {
    opra?: InspectorIngesterDiag;
    globex?: InspectorIngesterDiag;
  };
}

export const Inspector = {
  async load(signal?: AbortSignal): Promise<InspectorPayload> {
    const resp = await api.get("/admin/inspector", { signal });
    return resp.data;
  },
};

// ── Futures translation levels (Rev 4) ────────────────────────────────────

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

export interface FuturesLevelsEnvelope {
  symbol: string;
  computed_at: string | null;
  next_update_in_seconds: number;
  data: FuturesLevelsSnapshot;
}

export const FuturesLevels = {
  async load(symbol: string, apiKey: string): Promise<FuturesLevelsSnapshot> {
    const resp = await api.get<FuturesLevelsEnvelope>(
      `/v1/${encodeURIComponent(symbol)}/futures-levels`,
      {
        headers: { "X-API-Key": apiKey },
      },
    );
    return resp.data.data;
  },
};

// ── Access Requests (Discord-verified user approval flow) ────────────────

export type UserStatus = "pending" | "approved" | "rejected" | "banned";

export interface AccessRequestUser {
  id: number;
  discord_id: string;
  discord_username: string;
  discord_avatar: string | null;
  status: UserStatus;
  guild_verified: boolean;
  has_api_key: boolean;
  api_key_label: string | null;
  api_key_prefix: string | null;
  created_at: string;
  last_login_at: string | null;
  notes: string | null;
  access_request: {
    id: number;
    requested_at: string;
    approved_at: string | null;
    approved_by: string | null;
    rejected_at: string | null;
    rejected_by: string | null;
    rejection_reason: string | null;
  } | null;
}

export interface AccessRequestApproveResponse {
  user: AccessRequestUser;
  plaintext_key: string | null;
}

export const AccessRequests = {
  async list(): Promise<AccessRequestUser[]> {
    const resp = await api.get("/admin/access-requests");
    return resp.data;
  },
  async approve(
    userId: number,
    payload: { api_key_id?: string; allowed_symbols?: string[] } = {},
  ): Promise<AccessRequestApproveResponse> {
    const resp = await api.post(`/admin/access-requests/${userId}/approve`, payload);
    return resp.data;
  },
  async reject(userId: number, reason: string): Promise<{ user: AccessRequestUser }> {
    const resp = await api.post(`/admin/access-requests/${userId}/reject`, { reason });
    return resp.data;
  },
  async ban(userId: number, reason: string): Promise<{ user: AccessRequestUser }> {
    const resp = await api.post(`/admin/users/${userId}/ban`, { reason });
    return resp.data;
  },
  async revokeSessions(userId: number): Promise<{ revoked_count: number }> {
    const resp = await api.post(`/admin/users/${userId}/revoke-sessions`);
    return resp.data;
  },
};
