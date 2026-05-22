/**
 * Live data stream client — adapted from the admin's streamClient.ts but
 * authenticated via the session JWT (?token=…) instead of an API key,
 * and pointed at the public `/public/{symbol}/stream` endpoint.
 *
 * Exposes a React hook `useLiveStream(symbol)` that yields the latest
 * envelope frame, the connection status, and the timestamp of the last
 * frame received.
 */

import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl, type DataEnvelope } from "@/lib/api";

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

function jitter(delay: number): number {
  // Symmetric jitter in [delay * (1 - JITTER), delay * (1 + JITTER)].
  const spread = delay * RECONNECT_JITTER;
  return Math.max(0, delay + (Math.random() * 2 - 1) * spread);
}

function toWsUrl(base: string, path: string, token: string): string {
  const u = new URL(path, base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (token) u.searchParams.set("token", token);
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
      connect();
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

  function connect(): void {
    if (closed) return;
    if (usingSse) {
      connectSse();
      return;
    }
    handlers.onStatus("connecting");
    wsHasOpened = false;
    try {
      ws = new WebSocket(toWsUrl(base, wsPath, token));
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
    ws.onclose = () => {
      ws = null;
      if (closed) {
        handlers.onStatus("closed");
        return;
      }
      scheduleReconnect();
    };
  }

  connect();

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
  });

  handlersRef.current = {
    onFrame: (frame) => {
      setEnvelope(frame);
      setLastFrameAt(Date.now());
    },
    onStatus: setStatus,
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
    });
    return () => conn.close();
  }, [symbol, token]);

  return { envelope, status, lastFrameAt };
}

export const __internal = { parseFrame, toWsUrl, toSseUrl };
