import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, KeyRound, Eye, EyeOff } from "lucide-react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toast";
import { useTheme } from "@/hooks/useTheme";
import { destinationForStatus } from "@/lib/redirects";

export default function Login() {
  // Ensure data-theme is applied even when landing directly here.
  useTheme();

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const loginWithApiKey = useAuth((s) => s.loginWithApiKey);
  const clearError = useAuth((s) => s.clearError);
  const reduce = useReducedMotion();
  const inputControls = useAnimationControls();
  const lastErrorRef = useRef<string | null>(null);

  // Honour both router state (`from` set by <Protected>) and ?next= (set by
  // the 401 axios interceptor when the user is bounced from a protected page).
  const resolveNext = useCallback(
    (fallback: string): string => {
      const stateFrom = (location.state as { from?: string } | null)?.from;
      if (stateFrom && stateFrom.startsWith("/")) return stateFrom;
      const nextParam = searchParams.get("next");
      if (nextParam) {
        try {
          const decoded = decodeURIComponent(nextParam);
          // Only allow same-origin relative paths to prevent open-redirect.
          if (decoded.startsWith("/") && !decoded.startsWith("//")) {
            return decoded;
          }
        } catch {
          /* ignore malformed param */
        }
      }
      return fallback;
    },
    [location.state, searchParams],
  );

  useEffect(() => {
    if (token && status) {
      const target = resolveNext(destinationForStatus(status));
      navigate(target, { replace: true });
    }
  }, [token, status, navigate, resolveNext]);

  useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

  // Shake input on new error
  useEffect(() => {
    if (error && error !== lastErrorRef.current && !reduce) {
      lastErrorRef.current = error;
      void inputControls.start({
        x: [0, -6, 6, -6, 6, 0],
        transition: { duration: 0.45, ease: "easeInOut" },
      });
    }
    if (!error) lastErrorRef.current = null;
  }, [error, inputControls, reduce]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) return;
    const result = await loginWithApiKey(apiKey);
    if (result.ok) {
      toast({
        title: "Signed in",
        description: "Welcome back.",
        variant: "success",
      });
      const dest = resolveNext(destinationForStatus(result.status));
      navigate(dest, { replace: true });
    }
  }

  return (
    <Layout variant="marketing">
      <section className="relative flex-1 flex items-center justify-center px-6 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 30%, var(--glow), transparent 70%)",
          }}
        />

        <div className="w-full max-w-md mx-auto">
          <div className="liquid-glass rounded-full px-4 py-1.5 inline-flex items-center gap-2 mb-6 animate-fade-rise">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
            <span
              className="text-[10px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "var(--text-secondary)" }}
            >
              Secure Sign-in
            </span>
          </div>

          <div className="liquid-glass-strong rounded-3xl p-7 sm:p-8 animate-fade-rise-d1">
            <div className="flex items-center gap-3">
              <div
                className="liquid-glass w-10 h-10 rounded-full flex items-center justify-center"
              >
                <KeyRound
                  className="w-4 h-4"
                  style={{ color: "var(--accent-foid)" }}
                />
              </div>
              <div
                className="text-[10px] font-mono tracking-[0.2em] uppercase"
                style={{ color: "var(--accent-foid)" }}
              >
                // FlowOptionID
              </div>
            </div>

            <h1
              className="mt-5 text-4xl sm:text-5xl leading-[0.95] tracking-[-1.5px]"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                color: "var(--text-primary)",
              }}
            >
              Welcome back.
            </h1>
            <p
              className="mt-3 text-sm font-mono leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Sign in with your API key to access the dashboard.
            </p>

            {error ? (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-5 liquid-glass rounded-xl px-4 py-3 text-xs font-mono"
                style={{
                  color: "var(--accent-put)",
                  borderColor: "var(--accent-put)",
                }}
              >
                {error}
              </motion.div>
            ) : null}

            <form className="mt-6 grid gap-5" onSubmit={handleSubmit} noValidate>
              <div className="grid gap-2">
                <label
                  htmlFor="api_key"
                  className="text-[10px] font-mono tracking-[0.2em] uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  API Key
                </label>
                <motion.div
                  animate={inputControls}
                  className="liquid-glass rounded-xl flex items-center gap-2 px-4 py-3"
                >
                  <input
                    id="api_key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    autoFocus
                    placeholder="sk_live_…"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="flex-1 bg-transparent outline-none border-none text-sm tracking-wide"
                    style={{
                      fontFamily: "var(--font-mono-foid)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="opacity-70 hover:opacity-100 transition-opacity"
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? (
                      <EyeOff
                        className="w-4 h-4"
                        style={{ color: "var(--text-secondary)" }}
                      />
                    ) : (
                      <Eye
                        className="w-4 h-4"
                        style={{ color: "var(--text-secondary)" }}
                      />
                    )}
                  </button>
                </motion.div>
                <p
                  className="text-[10px] font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  Paste your assigned key. We never store it in the browser.
                </p>
              </div>

              <motion.button
                type="submit"
                whileHover={reduce ? undefined : { scale: 1.02 }}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                disabled={loading || !apiKey.trim()}
                className="rounded-full px-6 py-3 text-sm font-medium text-white cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent-foid) 0%, #8B5CF6 100%)",
                  boxShadow:
                    "0 0 20px var(--glow), inset 0 1px 1px rgba(255,255,255,0.15)",
                  outline: "2px solid rgba(255,255,255,0.12)",
                  outlineOffset: "-2px",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                <span>{loading ? "Signing in…" : "Sign in"}</span>
                {!loading && <ArrowRight className="w-4 h-4" />}
              </motion.button>
            </form>

            <div
              className="mt-6 pt-5 text-xs font-mono text-center"
              style={{
                borderTop: "1px solid var(--border-foid)",
                color: "var(--text-secondary)",
              }}
            >
              Don&apos;t have an API key?{" "}
              <Link
                to="/register"
                className="transition-colors hover:opacity-80"
                style={{ color: "var(--accent-foid)" }}
              >
                Register via Discord
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

