import { getAdminJwt, getApiKey } from "@/shared/auth";

/**
 * REST client.
 *
 * Wraps fetch with:
 *   - automatic auth header injection (X-API-Key on /v1/*, Bearer on /admin/*)
 *   - structured ApiError on non-2xx (carries the status, code, message)
 *   - simple GET-with-retry for transient 5xx (POST/PUT/DELETE never retry)
 *   - AbortController plumbing for TanStack Query cancellation
 *
 * Response shape: every /v1/* endpoint wraps payloads as
 *   { symbol, computed_at, next_update_in_seconds, data }
 * (see contracts/types/snapshot.ts SnapshotEnvelope). The wrapper is
 * preserved end-to-end — callers consume `.data` so they always have
 * `computed_at` for staleness UI.
 */

export interface RestEnvelope<T> {
  symbol: string;
  computed_at: string | null;
  next_update_in_seconds: number;
  data: T;
}

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  detail: unknown;
  constructor(status: number, message: string, code?: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const apiBase = (() => {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("VITE_API_BASE_URL is not set");
  }
  return raw.replace(/\/+$/, "");
})();

export function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${apiBase}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

interface RequestOptions extends RequestInit {
  /** Skip auth header injection (only used for /health). */
  noAuth?: boolean;
  /** Retry GET requests on transient 5xx; default 1. POST never retries. */
  retries?: number;
  /** Cancellation signal — wired by TanStack Query. */
  signal?: AbortSignal;
}

function authHeaders(path: string, init: RequestOptions): HeadersInit {
  if (init.noAuth) return {};
  if (path.startsWith("/admin/")) {
    const jwt = getAdminJwt();
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  }
  if (path.startsWith("/v1/")) {
    const key = getApiKey();
    return key ? { "X-API-Key": key } : {};
  }
  return {};
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown = undefined;
  let message = res.statusText || `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      detail = await res.json();
      const obj = detail as { detail?: unknown; message?: string; code?: string };
      if (typeof obj.message === "string") message = obj.message;
      else if (typeof obj.detail === "string") message = obj.detail;
      if (typeof obj.code === "string") code = obj.code;
    } else {
      const text = await res.text();
      if (text) message = text;
    }
  } catch {
    // swallow parse errors; we already have status + statusText
  }
  return new ApiError(res.status, message, code, detail);
}

async function rawFetch(path: string, init: RequestOptions = {}): Promise<Response> {
  const { noAuth: _noAuth, retries: _retries, ...fetchInit } = init;
  const url = path.startsWith("http") ? path : buildUrl(path);
  const headers = new Headers(fetchInit.headers);
  for (const [k, v] of Object.entries(authHeaders(path, init))) {
    headers.set(k, v as string);
  }
  if (fetchInit.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(url, { ...fetchInit, headers });
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const allowRetry = method === "GET" && (init.retries ?? 1) > 0;

  let lastError: unknown;
  const attempts = allowRetry ? (init.retries ?? 1) + 1 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await rawFetch(path, init);
      if (!res.ok) {
        if (res.status >= 500 && allowRetry && i < attempts - 1) {
          await delay(150 * 2 ** i + Math.random() * 100);
          continue;
        }
        throw await parseError(res);
      }
      if (res.status === 204) return undefined as T;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) return (await res.json()) as T;
      return (await res.text()) as unknown as T;
    } catch (err) {
      lastError = err;
      if (err instanceof ApiError) throw err;
      // Network / CORS errors -> retry once for GET only.
      if (!allowRetry || i >= attempts - 1) throw err;
      await delay(150 * 2 ** i + Math.random() * 100);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unknown REST error");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const rest = {
  get: <T>(path: string, init?: RequestOptions) =>
    request<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    request<T>(path, {
      ...init,
      method: "POST",
      body: body == null ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    request<T>(path, {
      ...init,
      method: "PUT",
      body: body == null ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string, init?: RequestOptions) =>
    request<T>(path, { ...init, method: "DELETE" }),
} as const;
