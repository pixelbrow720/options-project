import type {
  GexPayload,
  HiroPayload,
  IvPayload,
  MaxPainPayload,
  SnapshotEnvelope,
  WallsPayload,
  ZeroDtePayload,
  FlowPayload,
  SpotPayload,
} from "@/contracts/types/snapshot";
import { type RestEnvelope, rest } from "./client";

/**
 * Typed endpoint helpers. Each one returns the unwrapped envelope so
 * callers always get both `data` and `computed_at` (for staleness UI).
 *
 * NEVER duplicate the union of metric-specific endpoints in feature
 * code — extend this barrel instead. That keeps the contract drift
 * surface small.
 */

const v1 = (symbol: string, leaf: string) => `/v1/${encodeURIComponent(symbol)}/${leaf}`;

export const endpoints = {
  health: () => rest.get<{ status: string }>("/health", { noAuth: true }),

  snapshot: (symbol: string, signal?: AbortSignal) =>
    rest.get<SnapshotEnvelope>(v1(symbol, "snapshot"), signal != null ? { signal } : {}),

  gex: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<GexPayload>>(v1(symbol, "gex"), signal != null ? { signal } : {}),

  walls: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<WallsPayload>>(v1(symbol, "walls"), signal != null ? { signal } : {}),

  maxPain: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<MaxPainPayload>>(v1(symbol, "max-pain"), signal != null ? { signal } : {}),

  iv: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<IvPayload>>(v1(symbol, "iv"), signal != null ? { signal } : {}),

  zeroDte: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<ZeroDtePayload>>(v1(symbol, "0dte"), signal != null ? { signal } : {}),

  spot: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<SpotPayload>>(v1(symbol, "spot"), signal != null ? { signal } : {}),

  flow: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<FlowPayload>>(v1(symbol, "flow"), signal != null ? { signal } : {}),

  hiro: (symbol: string, signal?: AbortSignal) =>
    rest.get<RestEnvelope<HiroPayload>>(v1(symbol, "hiro"), signal != null ? { signal } : {}),
} as const;
