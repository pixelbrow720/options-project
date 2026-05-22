/**
 * Auth state via zustand.
 *
 * Persists the JWT in localStorage (handled by the api module) plus the
 * decoded user record. Exposes `loginWithApiKey`, `consumeToken`
 * (for the OAuth callback hand-off), `refresh` (calls /public/me), and
 * `logout`.
 */

import { create } from "zustand";
import {
  api,
  Auth as AuthApi,
  describeApiError,
  getStoredToken,
  setStoredToken,
  TOKEN_STORAGE_KEY,
  type MeResponse,
  type User,
  type UserStatus,
} from "@/lib/api";

interface AuthState {
  token: string | null;
  user: User | null;
  status: UserStatus | null;
  apiKeyLabel: string | null;
  apiKeyPrefix: string | null;
  hasApiKey: boolean;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  loginWithApiKey: (apiKey: string) => Promise<{ ok: true; status: UserStatus } | { ok: false; error: string }>;
  consumeToken: (token: string) => Promise<{ ok: true; status: UserStatus } | { ok: false; error: string }>;
  refresh: () => Promise<MeResponse | null>;
  hydrate: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: getStoredToken(),
  user: null,
  status: null,
  apiKeyLabel: null,
  apiKeyPrefix: null,
  hasApiKey: false,
  loading: false,
  initialized: false,
  error: null,

  async loginWithApiKey(apiKey: string) {
    set({ loading: true, error: null });
    try {
      const resp = await AuthApi.login(apiKey.trim());
      setStoredToken(resp.token);
      set({
        token: resp.token,
        user: resp.user,
        status: resp.user.status,
        apiKeyLabel: resp.api_key_label,
        apiKeyPrefix: resp.api_key_prefix,
        hasApiKey: Boolean(resp.api_key_prefix),
        loading: false,
        initialized: true,
      });
      return { ok: true, status: resp.user.status } as const;
    } catch (err) {
      const msg = describeApiError(err, "Could not sign in with that API key.");
      set({ loading: false, error: msg });
      return { ok: false, error: msg } as const;
    }
  },

  async consumeToken(token: string) {
    set({ loading: true, error: null });
    setStoredToken(token);
    try {
      const me = await AuthApi.me();
      set({
        token,
        user: me.user,
        status: me.status,
        apiKeyLabel: me.api_key_label,
        apiKeyPrefix: me.api_key_prefix,
        hasApiKey: me.has_api_key,
        loading: false,
        initialized: true,
      });
      return { ok: true, status: me.status } as const;
    } catch (err) {
      setStoredToken(null);
      const msg = describeApiError(err, "Could not validate your sign-in.");
      set({
        token: null,
        user: null,
        status: null,
        apiKeyLabel: null,
        apiKeyPrefix: null,
        hasApiKey: false,
        loading: false,
        error: msg,
        initialized: true,
      });
      return { ok: false, error: msg } as const;
    }
  },

  async refresh() {
    const token = get().token ?? getStoredToken();
    if (!token) {
      set({ initialized: true });
      return null;
    }
    try {
      const me = await AuthApi.me();
      set({
        token,
        user: me.user,
        status: me.status,
        apiKeyLabel: me.api_key_label,
        apiKeyPrefix: me.api_key_prefix,
        hasApiKey: me.has_api_key,
        initialized: true,
      });
      return me;
    } catch {
      // 401 path is already handled by the axios interceptor (token cleared).
      set({
        token: null,
        user: null,
        status: null,
        apiKeyLabel: null,
        apiKeyPrefix: null,
        hasApiKey: false,
        initialized: true,
      });
      return null;
    }
  },

  async hydrate() {
    if (get().initialized) return;
    await get().refresh();
  },

  async logout() {
    // Always clear local state, even if the network call fails — otherwise a
    // dropped /logout request leaves the user "signed in" client-side.
    // We clear in `finally` (rather than only the catch path) so the token
    // is gone from storage AND from any in-memory axios defaults the moment
    // logout is initiated, regardless of network outcome.
    try {
      await AuthApi.logout();
    } catch {
      /* swallow — local clear below is the source of truth */
    } finally {
      setStoredToken(null);
      if (api.defaults.headers.common) {
        delete (api.defaults.headers.common as Record<string, unknown>).Authorization;
      }
    }
    set({
      token: null,
      user: null,
      status: null,
      apiKeyLabel: null,
      apiKeyPrefix: null,
      hasApiKey: false,
      error: null,
    });
  },

  clearError() {
    set({ error: null });
  },
}));

// Cross-tab sync: if the token is removed (logout in another tab) or replaced
// (login in another tab), reflect that here. We refresh /me to repopulate the
// user record rather than trusting the raw token.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key !== TOKEN_STORAGE_KEY) return;
    const next = event.newValue;
    if (!next) {
      useAuth.setState({
        token: null,
        user: null,
        status: null,
        apiKeyLabel: null,
        apiKeyPrefix: null,
        hasApiKey: false,
        initialized: true,
      });
      return;
    }
    // New token from another tab — sync token first, then refresh.
    useAuth.setState({ token: next });
    void useAuth.getState().refresh();
  });
}
