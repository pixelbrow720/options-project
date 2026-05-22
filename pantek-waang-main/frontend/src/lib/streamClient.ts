/**
 * Live snapshot stream client.
 *
 * Opens a WebSocket to ``/v1/{symbol}/stream``. Falls back to SSE
 * (``/v1/{symbol}/stream/sse``) if the WebSocket upgrade fails.
 * Reconnects with exponential back-off capped at 30 s.
 *
 * Authentication flow (preferred):
 *   1. POST /v1/{symbol}/stream-ticket with X-API-Key header.
 *   2. Server returns {ticket, ttl_seconds}.
 *   3. Open WS with ?ticket=<ticket>. Tickets are short-lived, single-use.
 *
 * Legacy flow (fallback):
 *   - WS with ?key=<api_key> directly. Triggered when the ticket endpoint
 *     returns 404/501, or the server closes the ticket-based WS with code
 *     1008 (server hasn't been redeployed yet).
 *
 * The WS may also be closed with code 4401 mid-stream — this signals the
 * user's API key was revoked while the connection was open. Treat as an
 * auth failure and prompt re-authentication.
 *
 * Exposes a React context + ``useLiveSnapshot(symbol)`` hook returning the
 * latest snapshot payload and a connection status flag.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error"
  | "auth-failed";

// ── Snapshot payload shape ─────────────────────────────────────────────────
//
// Mirrors ``GET /v1/{symbol}/snapshot`` (and the WS / SSE frame). Fields are
// optional because the backend may omit sections that have no data yet.

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

export interface HiroSeriesPoint {
  ts: string;
  value: number;
}

export interface HiroPayload {
  bucket_size?: string;
  cumulative: number;
  series: HiroSeriesPoint[];
}

export interface FlowEvent {
  id?: string;
  ts: string;
  symbol?: string;
  expiration?: string | null;
  strike?: number | null;
  option_type?: string;
  event_type: "SWEEP" | "BLOCK" | "UOA" | string;
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

export interface ZeroGammaPayload {
  oi: number | null;
  volume: number | null;
  underlying_price: number | null;
}

// ── Rev 4 — session, spot, 0DTE, back-month, pin probability, move tracker ─

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
  zero_gamma?: ZeroGammaPayload;
  max_pain?: MaxPainPayload;
  walls?: WallsPayload;
  iv?: {
    atm_iv: number | null;
    skew_per_expiry: Record<string, number>;
    surface: unknown[];
  };
  regime?: RegimePayload;
  hiro?: HiroPayload;
  flow?: FlowPayload;
  // Rev 4
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

// ── Configuration ─────────────────────────────────────────────────────────

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 30_000;
const STREAM_API_KEY_STORAGE = "ofa_stream_api_key";
// Stream API key currently lives in localStorage. CSP (frame-ancestors none,
// strict script-src) reduces XSS exfiltration risk; future work should move
// to a session cookie or in-memory only handoff via /admin endpoint.

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STREAM_API_KEY_STORAGE) ?? "";
}

export function setStoredApiKey(value: string): void {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(STREAM_API_KEY_STORAGE, value);
  } else {
    window.localStorage.removeItem(STREAM_API_KEY_STORAGE);
  }
}

// `__API_BASE__` runtime override — set via inline `<script>` in index.html
// before the bundle loads, or via a docker entrypoint that templates HTML.
function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const override = (window as unknown as { __API_BASE__?: string }).__API_BASE__;
    if (override) return override;
  }
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
}

function toWsUrl(base: string, path: string, params: Record<string, string>): string {
  const u = new URL(path, base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

function toSseUrl(base: string, path: string, key: string): string {
  const u = new URL(path, base);
  if (key) u.searchParams.set("key", key);
  return u.toString();
}

interface StreamTicket {
  ticket: string;
  ttl_seconds: number;
}

// Fetch a short-lived stream ticket. We deliberately use `fetch` here rather
// than the shared axios `api` instance, because the admin axios injects an
// `Authorization: Bearer <jwt>` header on every request — for the public
// stream endpoint we need `X-API-Key` only, with no JWT pollution.
async function fetchStreamTicket(
  base: string,
  symbol: string,
  apiKey: string,
): Promise<StreamTicket> {
  const url = new URL(`/v1/${encodeURIComponent(symbol)}/stream-ticket`, base).toString();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resp.ok) {
    throw new Error(`stream-ticket HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as Partial<StreamTicket>;
  if (!body || typeof body.ticket !== "string" || !body.ticket) {
    throw new Error("stream-ticket: missing ticket field");
  }
  const ttl = typeof body.ttl_seconds === "number" ? body.ttl_seconds : 60;
  return { ticket: body.ticket, ttl_seconds: ttl };
}

function parseFrame(raw: string): SnapshotEnvelope | null {
  try {
    const obj = JSON.parse(raw) as SnapshotEnvelope;
    if (typeof obj !== "object" || obj === null) return null;
    if (!("data" in obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

// ── Stream connection (WS with SSE fallback) ──────────────────────────────

type StreamHandlers = {
  onFrame: (frame: SnapshotEnvelope) => void;
  onStatus: (status: ConnectionStatus) => void;
};

interface StreamConnection {
  close: () => void;
}

// Close codes (must match backend):
//   1008  = policy violation (e.g. ticket auth not yet deployed) → fall back
//           to legacy `?key=` query param once.
//   4401  = credential revoked mid-stream → surface as "auth-failed", do not
//           reconnect.
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_CREDENTIAL_REVOKED = 4401;

function openStream(
  symbol: string,
  apiKey: string,
  handlers: StreamHandlers,
): StreamConnection {
  let closed = false;
  let ws: WebSocket | null = null;
  let sse: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = RECONNECT_INITIAL_MS;
  let wsHasOpened = false;
  let usingSse = false;
  // Once the server tells us tickets aren't supported (1008), we drop back
  // to legacy `?key=` for the rest of this session.
  let legacyKeyMode = false;
  const base = getApiBaseUrl();

  function scheduleReconnect(): void {
    if (closed) return;
    handlers.onStatus("reconnecting");
    const delay = Math.min(backoffMs, RECONNECT_MAX_MS);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closed) return;
      void connect();
    }, delay);
  }

  function connectSse(): void {
    if (closed) return;
    usingSse = true;
    handlers.onStatus("connecting");
    try {
      const url = toSseUrl(base, `/v1/${encodeURIComponent(symbol)}/stream/sse`, apiKey);
      sse = new EventSource(url, { withCredentials: false });
    } catch {
      scheduleReconnect();
      return;
    }
    sse.onopen = () => {
      if (closed) return;
      backoffMs = RECONNECT_INITIAL_MS;
      handlers.onStatus("open");
    };
    sse.onmessage = (ev: MessageEvent<string>) => {
      const frame = parseFrame(ev.data);
      if (frame) handlers.onFrame(frame);
    };
    sse.onerror = () => {
      if (closed) return;
      // EventSource auto-reconnects internally, but we surface status so the
      // UI shows the indicator change. Close + manual reconnect gives us
      // back-off control parity with the WS path.
      try {
        sse?.close();
      } catch {
        /* ignore */
      }
      sse = null;
      scheduleReconnect();
    };
  }

  function openWebSocket(url: string): void {
    try {
      ws = new WebSocket(url);
    } catch {
      // Browser rejected the URL entirely — flip to SSE fallback.
      usingSse = true;
      connectSse();
      return;
    }
    ws.onopen = () => {
      if (closed) return;
      wsHasOpened = true;
      backoffMs = RECONNECT_INITIAL_MS;
      handlers.onStatus("open");
    };
    ws.onmessage = (ev: MessageEvent<string | ArrayBuffer | Blob>) => {
      if (typeof ev.data !== "string") return;
      const frame = parseFrame(ev.data);
      if (frame) handlers.onFrame(frame);
    };
    ws.onerror = () => {
      // Errors before the first ``open`` event likely indicate the WS upgrade
      // was rejected (corporate proxy stripping ``Upgrade``, etc.). Flip to
      // SSE permanently for this connection.
      if (!wsHasOpened) {
        usingSse = true;
      }
    };
    ws.onclose = (ev: CloseEvent) => {
      ws = null;
      if (closed) {
        handlers.onStatus("closed");
        return;
      }
      // Credential was revoked mid-stream — bail out, do not retry.
      if (ev.code === WS_CLOSE_CREDENTIAL_REVOKED) {
        closed = true;
        handlers.onStatus("auth-failed");
        return;
      }
      // Server doesn't yet understand the ticket flow (older deploy) — fall
      // back to legacy `?key=` for the rest of this session.
      if (ev.code === WS_CLOSE_POLICY_VIOLATION && !legacyKeyMode && !wsHasOpened) {
        // eslint-disable-next-line no-console
        console.warn(
          "[streamClient] ticket flow rejected (1008); falling back to legacy ?key= auth",
        );
        legacyKeyMode = true;
        // Reconnect immediately on the next tick.
        backoffMs = RECONNECT_INITIAL_MS;
      }
      scheduleReconnect();
    };
  }

  async function connect(): Promise<void> {
    if (closed) return;
    if (usingSse) {
      connectSse();
      return;
    }
    handlers.onStatus("connecting");
    wsHasOpened = false;

    if (legacyKeyMode) {
      const url = toWsUrl(base, `/v1/${encodeURIComponent(symbol)}/stream`, { key: apiKey });
      openWebSocket(url);
      return;
    }

    // Preferred path: fetch a short-lived ticket, then open WS with it.
    let ticket: StreamTicket;
    try {
      ticket = await fetchStreamTicket(base, symbol, apiKey);
    } catch (err) {
      // Ticket endpoint failed — log + fall back to legacy key. We only do
      // this once per session; if legacy also fails, the WS close handler
      // will surface the error normally.
      // eslint-disable-next-line no-console
      console.warn(
        "[streamClient] stream-ticket fetch failed, falling back to legacy ?key=",
        err,
      );
      legacyKeyMode = true;
      if (closed) return;
      const url = toWsUrl(base, `/v1/${encodeURIComponent(symbol)}/stream`, { key: apiKey });
      openWebSocket(url);
      return;
    }

    if (closed) return;
    const url = toWsUrl(base, `/v1/${encodeURIComponent(symbol)}/stream`, {
      ticket: ticket.ticket,
    });
    openWebSocket(url);
  }

  void connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
      if (sse) {
        try {
          sse.close();
        } catch {
          /* ignore */
        }
        sse = null;
      }
      handlers.onStatus("closed");
    },
  };
}

// ── React context / provider / hook ───────────────────────────────────────

export interface LiveSnapshotValue {
  symbol: string;
  apiKey: string;
  setSymbol: (symbol: string) => void;
  setApiKey: (key: string) => void;
  snapshot: SnapshotEnvelope | null;
  status: ConnectionStatus;
  lastFrameAt: number | null;
}

const LiveSnapshotContext = createContext<LiveSnapshotValue | undefined>(undefined);

export interface LiveSnapshotProviderProps {
  initialSymbol: string;
  children: ReactNode;
}

export function LiveSnapshotProvider({ initialSymbol, children }: LiveSnapshotProviderProps) {
  const [symbol, setSymbolState] = useState<string>(initialSymbol);
  const [apiKey, setApiKeyState] = useState<string>(() => getStoredApiKey());
  const [snapshot, setSnapshot] = useState<SnapshotEnvelope | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("closed");
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);

  const setSymbol = useCallback((next: string) => {
    setSymbolState(next.trim().toUpperCase());
    setSnapshot(null);
  }, []);

  const setApiKey = useCallback((next: string) => {
    setApiKeyState(next);
    setStoredApiKey(next);
    setSnapshot(null);
  }, []);

  const handlersRef = useRef<StreamHandlers>({
    onFrame: () => {},
    onStatus: () => {},
  });

  handlersRef.current = {
    onFrame: (frame: SnapshotEnvelope) => {
      setSnapshot(frame);
      setLastFrameAt(Date.now());
    },
    onStatus: (next: ConnectionStatus) => {
      setStatus(next);
      // Server told us the credential was revoked mid-stream — drop the
      // cached key so the next reconnect attempt prompts the user.
      if (next === "auth-failed") {
        setStoredApiKey("");
        setApiKeyState("");
      }
    },
  };

  useEffect(() => {
    if (!symbol || !apiKey) {
      setStatus("closed");
      return;
    }
    const conn = openStream(symbol, apiKey, {
      onFrame: (f) => handlersRef.current.onFrame(f),
      onStatus: (s) => handlersRef.current.onStatus(s),
    });
    return () => conn.close();
  }, [symbol, apiKey]);

  const value = useMemo<LiveSnapshotValue>(
    () => ({ symbol, apiKey, setSymbol, setApiKey, snapshot, status, lastFrameAt }),
    [symbol, apiKey, setSymbol, setApiKey, snapshot, status, lastFrameAt],
  );

  return createElement(LiveSnapshotContext.Provider, { value }, children);
}

export function useLiveSnapshot(): LiveSnapshotValue {
  const ctx = useContext(LiveSnapshotContext);
  if (!ctx) {
    throw new Error("useLiveSnapshot must be used inside <LiveSnapshotProvider>");
  }
  return ctx;
}

// Exported for tests.
export const __internal = { parseFrame, toWsUrl, toSseUrl, fetchStreamTicket };
