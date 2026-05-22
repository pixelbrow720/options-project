import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/hooks/useTheme";
import { destinationForStatus } from "@/lib/redirects";

// Discord OAuth errors are echoed back into the URL by the backend. They
// can in theory be arbitrarily long if a misconfigured proxy concatenates
// them. Cap before rendering so a giant error string can't blow up layout.
const ERROR_PARAM_MAX = 256;

export default function AuthCallback() {
  // Apply data-theme even when landing directly here.
  useTheme();

  const [params] = useSearchParams();
  const navigate = useNavigate();
  const consumeToken = useAuth((s) => s.consumeToken);
  const reduce = useReducedMotion();

  const [phase, setPhase] = useState<"working" | "error">("working");
  const [error, setError] = useState<string | null>(null);

  // Capture the relevant query params ONCE so the effect's second invocation
  // under React.StrictMode (or any subsequent re-render that swaps `params`)
  // doesn't re-read a token that we already replaced out of the URL bar.
  const initial = useMemo(() => {
    return {
      token: params.get("token"),
      error: params.get("error"),
      status: params.get("status"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // StrictMode in dev mounts every effect twice. Without this guard we
  // would call /me with the token twice, which is harmless but logs a
  // confusing duplicate request and can race the navigate() call.
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;

    const { token, error: errParam, status: statusParam } = initial;

    // Strip sensitive query params from the visible URL ASAP so the JWT
    // doesn't end up in browser history, the Referer header on the next
    // navigation, or any analytics/error reporter that captures location.
    // We do this before any async work so a slow /me round-trip can't
    // leave the token visible in the address bar.
    if (typeof window !== "undefined" && (token || errParam || statusParam)) {
      try {
        window.history.replaceState({}, "", "/auth/callback");
      } catch {
        /* ignore — replaceState is best-effort */
      }
    }

    if (errParam) {
      setPhase("error");
      // Discord/back-end-supplied error strings are rendered as plain text
      // (React escapes by default), but we still keep the value short and
      // never pass it to dangerouslySetInnerHTML.
      let decoded: string;
      try {
        decoded = decodeURIComponent(errParam);
      } catch {
        decoded = errParam;
      }
      setError(decoded.slice(0, ERROR_PARAM_MAX));
      return;
    }

    if (statusParam === "pending") {
      navigate("/pending", { replace: true });
      return;
    }
    if (statusParam === "rejected") {
      navigate("/rejected", { replace: true });
      return;
    }

    if (!token) {
      setPhase("error");
      setError("Missing token in callback URL.");
      return;
    }

    let cancelled = false;
    (async () => {
      const result = await consumeToken(token);
      if (cancelled) return;
      if (!result.ok) {
        setPhase("error");
        setError(result.error.slice(0, ERROR_PARAM_MAX));
        return;
      }
      navigate(destinationForStatus(result.status), { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [initial, consumeToken, navigate]);

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

        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md mx-auto"
        >
          <div className="liquid-glass rounded-full px-4 py-1.5 inline-flex items-center gap-2 mb-6 animate-fade-rise">
            <span
              className={`w-1.5 h-1.5 rounded-full animate-pulse-dot ${
                phase === "working" ? "bg-green-400" : "bg-red-400"
              }`}
            />
            <span
              className="text-[10px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "var(--text-secondary)" }}
            >
              {phase === "working" ? "Verifying" : "Error"}
            </span>
          </div>

          <div className="liquid-glass-strong rounded-3xl p-7 sm:p-8 animate-fade-rise-d1 text-center">
            {phase === "working" ? (
              <>
                <h1
                  className="text-3xl sm:text-4xl leading-tight tracking-[-1px]"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    color: "var(--text-primary)",
                  }}
                >
                  Verifying Discord identity…
                </h1>
                <p
                  className="mt-4 text-sm font-mono leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Validating your FlowOptionID Discord verification. Just a moment.
                </p>

                <div className="mt-8 flex items-center justify-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse-dot" />
                  <span
                    className="text-[10px] font-mono tracking-[0.2em] uppercase"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Awaiting OAuth response
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-center">
                  <div
                    className="liquid-glass w-12 h-12 rounded-full flex items-center justify-center"
                  >
                    <AlertTriangle
                      className="w-5 h-5"
                      style={{ color: "var(--accent-put)" }}
                    />
                  </div>
                </div>
                <h1
                  className="mt-5 text-3xl sm:text-4xl leading-tight tracking-[-1px]"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    color: "var(--text-primary)",
                  }}
                >
                  Sign-in failed.
                </h1>
                <p
                  className="mt-3 text-sm font-mono leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Something went wrong while completing the sign-in.
                </p>

                {error ? (
                  <div
                    className="mt-5 liquid-glass rounded-xl px-4 py-3 text-xs font-mono text-left"
                    style={{ color: "var(--accent-put)" }}
                  >
                    {error}
                  </div>
                ) : null}

                <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    to="/register"
                    className="rounded-full px-5 py-2.5 text-sm font-medium text-white cursor-pointer inline-flex items-center justify-center gap-2"
                    style={{
                      background:
                        "linear-gradient(135deg, #5865F2 0%, #4752C4 60%, #8B5CF6 100%)",
                      boxShadow:
                        "0 0 20px rgba(88, 101, 242, 0.35), inset 0 1px 1px rgba(255,255,255,0.15)",
                      outline: "2px solid rgba(255,255,255,0.12)",
                      outlineOffset: "-2px",
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  >
                    Try again
                  </Link>
                  <Link
                    to="/login"
                    className="liquid-glass rounded-full px-5 py-2.5 text-sm cursor-pointer inline-flex items-center justify-center"
                    style={{
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  >
                    Sign in with API key
                  </Link>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </section>
    </Layout>
  );
}

