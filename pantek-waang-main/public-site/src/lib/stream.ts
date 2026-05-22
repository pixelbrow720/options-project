/**
 * Live data stream client — adapted from the admin's streamClient.ts but
 * authenticated via the session JWT (?token=…) instead of an API key,
 * and pointed at the public `/public/{symbol}/stream` endpoint.
 *
 * Auth flow: before opening the WebSocket, we POST to
 *   /public/{symbol}/stream-ticket
 * with `Authorization: Bearer <jwt>` to mint a short-lived ticket, then
 * open the WS with `?ticket=<ticket>`. This keeps the long-lived JWT out
 * of WS query strings (which leak via access logs / Referer / browser
 * history) and lets the backend revoke streaming separately from auth.
 *
 * Legacy fallback: if the backend rejects the ticket flow with WS close
 * code 1008 (policy violation), we retry once with the legacy `?token=`
 * query parameter and warn in the console.
 *
 * Close code 4401 means the credential was revoked mid-stream — the user
 * is logged out and bounced to /login (no reconnect).
 *
 * Exposes a React hook `useLiveStream(symbol)` that yields the latest
 * envelope frame, the connection status, and the timestamp of the last
 * frame received.
 */

import { useEffect, useRef, useState } from "react";
import { api, getApiBaseUrl, type DataEnvelope } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 30_000;
// Jitter ratio applied to each reconnect delay (±10%). When a transient
// network blip drops many subscribers at once, a fully deterministic
// exponential backoff causes them to all reconnect on the same tick, which
// can flap the backend. A small randomised offset spreads the herd.
const RECONNECT_JITTER = 0.1;

// WS close codes we treat specially.
const WS_CLOSE_AUTH_REVOKED = 4401;
const WS_CLOSE_POLICY_VIOLATION = 1008;

interface StreamTicketResponse {
  ticket: string;
  ttl_seconds: number;
}

async function mintStreamTicket(symbol: string): Promise<string | null> {
  try {
    const resp = await api.post<StreamTicketResponse>(
      `/public/${encodeURIComponent(symbol)}/stream-ticket`,
    );
    if (typeof resp.data?.ticket === "string" && resp.data.ticket) {
      return resp.data.ticket;
    }
    return null;
  } catch {
    // Endpoint missing (older backend) or transient failure — caller falls
    // back to the legacy ?token= flow.
    return null;
  }
}

function jitter(delay: number): number {
  // Symmetric jitter in [delay * (1 - JITTER), delay * (1 + JITTER)].
  const spread = delay * RECONNECT_JITTER;
  return Math.max(0, delay + (Math.random() * 2 - 1) * spread);
}

function toWsUrl(base: string, path: string, params: Record<string, string>): string {
  const u = new URL(path, base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

function toSseUrl(base: string, path: string, token: string): string {
  const u = new URL(path, base);
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

function parseFrame(raw: string): DataEnvelope | null {
  try {
    const obj = JSON.parse(raw) as DataEnvelope;
    if (typeof obj !== "object" || obj === null) return null;
    if (!("data" in obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

interface StreamHandlers {
  onFrame: (frame: DataEnvelope) => void;
  onStatus: (status: ConnectionStatus) => void;
  onAuthRevoked: () => void;
}

interface StreamConnection {
  close: () => void;
}

function openStream(symbol: string, token: string, handlers: StreamHandlers): StreamConnection {
  let closed = false;
  let ws: WebSocket | null = null;
  let sse: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = RECONNECT_INITIAL_MS;
  let wsHasOpened = false;
  let usingSse = false;
  // Once the backend has signalled that ticket auth is unavailable (close
  // 1008 on a ticketed connection), stay on the legacy ?token= path for the
  // remainder of this stream's life so we don't ping-pong.
  let legacyTokenMode = false;
  const base = getApiBaseUrl();
  const wsPath = `/public/${encodeURIComponent(symbol)}/stream`;
  const ssePath = `/public/${encodeURIComponent(symbol)}/stream/sse`;

  function scheduleReconnect(): void {
    if (closed) return;
    handlers.onStatus("reconnecting");
    const delay = jitter(Math.min(backoffMs, RECONNECT_MAX_MS));
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
      sse = new EventSource(toSseUrl(base, ssePath, token), { withCredentials: false });
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
      try {
        sse?.close();
      } catch {
        /* ignore */
      }
      sse = null;
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

    let url: string;
    let usedTicket = false;
    if (!legacyTokenMode) {
      const ticket = await mintStreamTicket(symbol);
      if (closed) return;
      if (ticket) {
        url = toWsUrl(base, wsPath, { ticket });
        usedTicket = true;
      } else {
        // Couldn't mint — fall back to legacy token for this attempt.
        url = toWsUrl(base, wsPath, { token });
      }
    } else {
      url = toWsUrl(base, wsPath, { token });
    }

    try {
      ws = new WebSocket(url);
    } catch {
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
      // Credential was revoked mid-stream — don't reconnect, kick the user
      // back to /login instead so they can re-auth cleanly.
      if (ev.code === WS_CLOSE_AUTH_REVOKED) {
        closed = true;
        handlers.onStatus("closed");
        handlers.onAuthRevoked();
        return;
      }
      // 1008 on a ticket connection means the backend doesn't support the
      // ticket flow yet — drop to legacy ?token= once with a console warn.
      if (ev.code === WS_CLOSE_POLICY_VIOLATION && usedTicket && !legacyTokenMode) {
        // eslint-disable-next-line no-console
        console.warn(
          "[stream] ticket auth rejected (close 1008) — falling back to ?token= for this stream",
        );
        legacyTokenMode = true;
      }
      scheduleReconnect();
    };
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

export interface LiveStreamState {
  envelope: DataEnvelope | null;
  status: ConnectionStatus;
  lastFrameAt: number | null;
}

export function useLiveStream(symbol: string, token: string | null): LiveStreamState {
  const [envelope, setEnvelope] = useState<DataEnvelope | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);

  const handlersRef = useRef<StreamHandlers>({
    onFrame: () => {},
    onStatus: () => {},
    onAuthRevoked: () => {},
  });

  handlersRef.current = {
    onFrame: (frame) => {
      setEnvelope(frame);
      setLastFrameAt(Date.now());
    },
    onStatus: setStatus,
    onAuthRevoked: () => {
      // Clear auth and force a hard navigation to /login. We use a hard
      // redirect (rather than react-router) because the WS close happens
      // outside any component lifecycle and we want to drop in-flight HTTP
      // requests too.
      void useAuth.getState().logout();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    },
  };

  useEffect(() => {
    setEnvelope(null);
    setLastFrameAt(null);
    if (!symbol || !token) {
      setStatus("idle");
      return;
    }
    const conn = openStream(symbol, token, {
      onFrame: (f) => handlersRef.current.onFrame(f),
      onStatus: (s) => handlersRef.current.onStatus(s),
      onAuthRevoked: () => handlersRef.current.onAuthRevoked(),
    });
    return () => conn.close();
  }, [symbol, token]);

  return { envelope, status, lastFrameAt };
}

export const __internal = { parseFrame, toWsUrl, toSseUrl };
