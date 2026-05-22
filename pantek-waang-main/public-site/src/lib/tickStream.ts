/**
 * Real-time price tick stream client.
 *
 * Subscribes to /public/{symbol}/ticks/sse to receive sub-second futures
 * trade ticks (each tick carries futures_price + derived cash_spot + basis).
 *
 * Use this alongside `useLiveStream` — that one delivers full snapshot
 * frames every ~30s, this one delivers tiny price ticks at OPRA cadence.
 */

import { useEffect, useState } from "react";
import { getApiBaseUrl } from "@/lib/api";

export interface TickFrame {
  symbol: string;
  futures_symbol: string;
  futures_price: number;
  cash_spot: number | null;
  basis: number | null;
  ts: string;
}

export type TickStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 30_000;
// ±10% jitter prevents a thundering-herd of reconnects when a network blip
// drops many subscribers at once. See stream.ts for the same rationale.
const RECONNECT_JITTER = 0.1;

function jitter(delay: number): number {
  const spread = delay * RECONNECT_JITTER;
  return Math.max(0, delay + (Math.random() * 2 - 1) * spread);
}

function toSseUrl(base: string, path: string, token: string): string {
  const u = new URL(path, base);
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

function parseTick(raw: string): TickFrame | null {
  try {
    const obj = JSON.parse(raw) as TickFrame;
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.futures_price !== "number") return null;
    return obj;
  } catch {
    return null;
  }
}

export interface TickStreamState {
  tick: TickFrame | null;
  status: TickStatus;
  lastTickAt: number | null;
}

export function useTickStream(symbol: string, token: string | null): TickStreamState {
  const [tick, setTick] = useState<TickFrame | null>(null);
  const [status, setStatus] = useState<TickStatus>("idle");
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);

  useEffect(() => {
    setTick(null);
    setLastTickAt(null);

    if (!symbol || !token) {
      setStatus("idle");
      return;
    }

    // Closure-local state so each effect run owns its own connection /
    // reconnect timer / closed flag — prevents a stale callback queued by a
    // previous (symbol, token) pair from leaking ticks into the new slot.
    let closed = false;
    let sse: EventSource | null = null;
    let backoffMs = RECONNECT_INITIAL_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const base = getApiBaseUrl();
    const path = `/public/${encodeURIComponent(symbol)}/ticks/sse`;

    function scheduleReconnect(): void {
      if (closed) return;
      setStatus("reconnecting");
      const delay = jitter(Math.min(backoffMs, RECONNECT_MAX_MS));
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!closed) connect();
      }, delay);
    }

    function connect(): void {
      if (closed) return;
      setStatus("connecting");
      try {
        sse = new EventSource(toSseUrl(base, path, token!), { withCredentials: false });
      } catch {
        scheduleReconnect();
        return;
      }
      const current = sse;
      current.onopen = () => {
        if (closed) return;
        backoffMs = RECONNECT_INITIAL_MS;
        setStatus("open");
      };
      current.onmessage = (ev: MessageEvent<string>) => {
        if (closed) return;
        const frame = parseTick(ev.data);
        if (frame) {
          setTick(frame);
          setLastTickAt(Date.now());
        }
      };
      current.onerror = () => {
        if (closed) return;
        try { current.close(); } catch { /* ignore */ }
        if (sse === current) sse = null;
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (sse) {
        try { sse.close(); } catch { /* ignore */ }
        sse = null;
      }
      setStatus("closed");
    };
  }, [symbol, token]);

  return { tick, status, lastTickAt };
}
