/**
 * Auth storage — API key + admin JWT.
 *
 * Hard rules:
 * - **API keys never go to localStorage.** localStorage is reachable
 *   from any same-origin script and survives tab close. We use
 *   sessionStorage so a closed tab clears the credential.
 * - Long-term, the deployed app should switch to an httpOnly cookie
 *   set by the backend during a login flow that proxies the API key.
 *   The interface here is shaped to make that swap mechanical: change
 *   the implementation, callers don't change.
 * - We never log the secret or the JWT. Only the 11-char key prefix
 *   surfaces in any UI affordance.
 *
 * Backend reference: contracts/openapi.json — auth uses
 *   X-API-Key: ak_<token>      (data routes)
 *   Authorization: Bearer <jwt> (admin routes)
 */

const SESSION_KEY = "flowgreeks.auth.v1";

interface PersistedAuth {
  apiKey: string | null;
  adminJwt: string | null;
}

function read(): PersistedAuth {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { apiKey: null, adminJwt: null };
    const parsed = JSON.parse(raw) as Partial<PersistedAuth>;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : null,
      adminJwt: typeof parsed.adminJwt === "string" ? parsed.adminJwt : null,
    };
  } catch {
    return { apiKey: null, adminJwt: null };
  }
}

function write(state: PersistedAuth): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (privacy mode, sandboxed iframe).
    // Fail closed: the user will be re-prompted to authenticate.
  }
}

export function getApiKey(): string | null {
  // Dev-mode injection — gated to import.meta.env.DEV so the prod bundle
  // never reads the env var (vite strips it at build time).
  if (import.meta.env.DEV) {
    const devKey = import.meta.env.VITE_DEV_API_KEY;
    if (typeof devKey === "string" && devKey.startsWith("ak_")) return devKey;
  }
  return read().apiKey;
}

export function setApiKey(value: string | null): void {
  const next = read();
  next.apiKey = value;
  write(next);
}

export function getAdminJwt(): string | null {
  return read().adminJwt;
}

export function setAdminJwt(value: string | null): void {
  const next = read();
  next.adminJwt = value;
  write(next);
}

export function clearAuth(): void {
  write({ apiKey: null, adminJwt: null });
}

/**
 * Public-safe display label for an API key. Backend exposes the first
 * 11 chars (e.g., `ak_a1B2c3D` plus trailing dots) — we mirror that
 * shape so admins never see the full secret in the UI.
 */
export function maskKey(key: string | null): string {
  if (!key || key.length < 6) return "—";
  const head = key.slice(0, 11);
  return `${head}…`;
}
