/**
 * WebSocket client for FlowGreeks streaming endpoints.
 *
 * Handles:
 *   - Reconnect with exponential backoff + ±20% jitter
 *   - Heartbeat watchdog (server emits every 25s; we treat 60s of
 *     silence as stale and force-close)
 *   - Mid-stream auth revocation: close code 4401 is FATAL — never
 *     reconnect, surface to UI, ask user to re-authenticate
 *   - Symbol unsupported: close code 1003 — also fatal
 *   - Connection cap: close code 1008 — surface but allow retry
 *   - Page visibility: pause backoff loop while hidden (no reconnect
 *     storm when tab returns)
 *
 * Backend reference: contracts/ws-frames.md
 */

import type {
  ConnectionStatus,
  WsFrame,
  WsHeartbeatFrame,
  WsSnapshotFrame,
  WsTickFrame,
  WsErrorFrame,
} from "@/contracts/types/snapshot";
import { getApiKey } from "@/shared/auth";

export type WsKind = "snapshot" | "ticks";

export interface WSClientOptions {
  symbol: string;
  kind?: WsKind;
  /** Optional override; defaults to import.meta.env.VITE_WS_BASE_URL. */
  baseUrl?: string;
  /** Initial backoff in ms; doubled each retry, capped. Default 1000. */
  backoffStart?: number;
  /** Max backoff in ms. Default 30000. */
  backoffMax?: number;
  /** Heartbeat watchdog timeout in ms. Default 60000. */
  heartbeatTimeout?: number;
  /** Optional debug logger. Default no-op (quiet). */
  log?: (level: "debug" | "info" | "warn" | "error", msg: string, extra?: unknown) => void;
}

export type WsListener =
  | { type: "snapshot"; handler: (f: WsSnapshotFrame) => void }
  | { type: "tick"; handler: (f: WsTickFrame) => void }
  | { type: "heartbeat"; handler: (f: WsHeartbeatFrame) => void }
  | { type: "error"; handler: (f: WsErrorFrame) => void }
  | { type: "status"; handler: (s: ConnectionStatus) => void };

const FATAL_CODES = new Set<number>([
  4401, // auth (server fatal — revoked or invalid key)
  1003, // unsupported symbol
]);

export class WSClient {
  private ws: WebSocket | null = null;
  private opts: Required<Omit<WSClientOptions, "log">> & {
    log: NonNullable<WSClientOptions["log"]>;
  };
  private status: ConnectionStatus = "closed";
  private listeners: WsListener[] = [];
  private retries = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private fatal = false;
  private explicitlyClosed = false;
  private visibilityHandler: () => void;

  constructor(options: WSClientOptions) {
    const baseUrl = options.baseUrl ?? import.meta.env.VITE_WS_BASE_URL;
    if (typeof baseUrl !== "string" || baseUrl.length === 0) {
      throw new Error("VITE_WS_BASE_URL is not set");
    }
    this.opts = {
      symbol: options.symbol,
      kind: options.kind ?? "snapshot",
      baseUrl: baseUrl.replace(/\/+$/, ""),
      backoffStart: options.backoffStart ?? 1_000,
      backoffMax: options.backoffMax ?? 30_000,
      heartbeatTimeout: options.heartbeatTimeout ?? 60_000,
      log: options.log ?? (() => undefined),
    };

    // Pause active retries while the tab is hidden — Chrome throttles
    // timers anyway, but we want to drop the in-flight reconnect timer
    // so a background tab doesn't burn through retries silently.
    this.visibilityHandler = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible" && this.status === "reconnecting" && !this.fatal) {
        this.scheduleReconnect(0);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  on(listener: WsListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    if (this.fatal) {
      this.opts.log("warn", "WSClient.connect refused — fatal state", {
        symbol: this.opts.symbol,
      });
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.explicitlyClosed = false;
    this.openSocket();
  }

  close(): void {
    this.explicitlyClosed = true;
    this.clearTimers();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client closed");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setStatus("closed");
  }

  // ─── internals ─────────────────────────────────────────────────────

  private url(): string {
    const path = `/v1/${encodeURIComponent(this.opts.symbol)}/stream${
      this.opts.kind === "ticks" ? "/ticks" : ""
    }`;
    const u = new URL(path, `${this.opts.baseUrl}/`);
    // Browsers do not let us set custom headers on WebSocket upgrade,
    // so we authenticate via the ?key= query parameter. The backend
    // accepts both shapes (see ws-frames.md).
    const key = getApiKey();
    if (key) u.searchParams.set("key", key);
    return u.toString();
  }

  private openSocket(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch (err) {
      this.opts.log("error", "WebSocket constructor threw", err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.setStatus(this.retries === 0 ? "connecting" : "reconnecting");

    ws.addEventListener("open", () => {
      this.opts.log("info", "ws open", { symbol: this.opts.symbol });
      this.setStatus("open");
      this.armHeartbeat();
      // Wait for a stable window before declaring victory and resetting
      // backoff — this avoids the case where the server accepts the
      // connection then closes it within a second (auth race, cap hit).
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => {
        this.retries = 0;
      }, 30_000);
    });

    ws.addEventListener("message", (ev) => {
      this.armHeartbeat();
      const data = ev.data;
      if (typeof data !== "string") return;
      let frame: WsFrame;
      try {
        frame = JSON.parse(data) as WsFrame;
      } catch (err) {
        this.opts.log("warn", "ws non-json frame dropped", { err });
        return;
      }
      this.dispatch(frame);
    });

    ws.addEventListener("close", (ev) => {
      this.opts.log("info", "ws close", {
        code: ev.code,
        reason: ev.reason,
        clean: ev.wasClean,
      });
      this.clearHeartbeat();
      this.ws = null;
      if (this.stableTimer) {
        clearTimeout(this.stableTimer);
        this.stableTimer = null;
      }
      if (this.explicitlyClosed) {
        this.setStatus("closed");
        return;
      }
      if (FATAL_CODES.has(ev.code)) {
        this.fatal = true;
        this.setStatus(ev.code === 4401 ? "auth-failed" : "error");
        return;
      }
      // 1008 (cap exceeded) — not fatal, but back off harder.
      if (ev.code === 1008) {
        this.retries = Math.max(this.retries, 4);
      }
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (ev) => {
      this.opts.log("warn", "ws error", { ev });
      // The 'close' handler will run after this; defer all retry logic
      // to that path so backoff is not double-incremented.
    });
  }

  private dispatch(frame: WsFrame): void {
    for (const l of this.listeners) {
      if (l.type !== frame.type) continue;
      try {
        switch (frame.type) {
          case "snapshot":
            (l as Extract<WsListener, { type: "snapshot" }>).handler(frame);
            break;
          case "tick":
            (l as Extract<WsListener, { type: "tick" }>).handler(frame);
            break;
          case "heartbeat":
            (l as Extract<WsListener, { type: "heartbeat" }>).handler(frame);
            break;
          case "error":
            (l as Extract<WsListener, { type: "error" }>).handler(frame);
            break;
        }
      } catch (err) {
        this.opts.log("error", "ws listener threw", err);
      }
    }
  }

  private armHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.opts.log("warn", "ws heartbeat timeout — recycling", {
        symbol: this.opts.symbol,
      });
      // Force-close so the close handler triggers reconnect. Use 4000
      // so it isn't mistaken for a server-issued fatal close.
      try {
        this.ws?.close(4000, "heartbeat timeout");
      } catch {
        // ignore
      }
    }, this.opts.heartbeatTimeout);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private scheduleReconnect(forcedDelayMs?: number): void {
    if (this.fatal || this.explicitlyClosed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      // Defer until the tab is visible again. visibilityHandler will
      // re-call scheduleReconnect when it flips back.
      this.setStatus("reconnecting");
      return;
    }
    const base = Math.min(
      this.opts.backoffMax,
      this.opts.backoffStart * 2 ** this.retries,
    );
    const jitter = base * (Math.random() * 0.4 - 0.2); // ±20%
    const delay = forcedDelayMs != null ? forcedDelayMs : Math.max(0, Math.round(base + jitter));
    this.retries += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
    }, delay);
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const l of this.listeners) {
      if (l.type !== "status") continue;
      try {
        (l as Extract<WsListener, { type: "status" }>).handler(next);
      } catch (err) {
        this.opts.log("error", "ws status listener threw", err);
      }
    }
  }
}
