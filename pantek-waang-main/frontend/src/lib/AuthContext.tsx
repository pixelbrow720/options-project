import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getStoredToken, setStoredToken } from "./api";

interface AuthValue {
  token: string | null;
  setToken: (t: string | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => {
    // Fixture mode bypasses auth so the design pass can iterate the
    // dashboard without a running backend or admin login.
    if (import.meta.env.VITE_USE_FIXTURE === "1") {
      return "fixture-mode-token";
    }
    return getStoredToken();
  });

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "ofa_admin_token") {
        setTokenState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setToken = useCallback((t: string | null) => {
    setStoredToken(t);
    setTokenState(t);
  }, []);

  const logout = useCallback(() => setToken(null), [setToken]);

  const value = useMemo(() => ({ token, setToken, logout }), [token, setToken, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
