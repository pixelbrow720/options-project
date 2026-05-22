import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, RefreshCw, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import { DiscordIcon } from "@/components/DiscordIcon";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toast";
import { useTheme } from "@/hooks/useTheme";

const ADMINS = ["@nods911_", "@arveloon", "@iqbal4o4"] as const;
const DISCORD_INVITE = "https://discord.gg/dy78P5vP62";
const POLL_INTERVAL_MS = 15_000;

export default function PendingApproval() {
  // Apply data-theme even when landing directly here.
  useTheme();

  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const refresh = useAuth((s) => s.refresh);
  const [refreshing, setRefreshing] = useState(false);
  const reduce = useReducedMotion();

  // Auto-poll /public/me so the user gets pushed to /dashboard the moment an
  // admin approves them, without having to mash the "Refresh status" button.
  // Pauses while the tab is hidden to avoid noisy background traffic.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled || document.hidden) {
        schedule();
        return;
      }
      try {
        const me = await refresh();
        if (cancelled) return;
        if (me?.status === "approved") {
          navigate("/dashboard", { replace: true });
          return;
        }
        if (me?.status === "rejected") {
          navigate("/rejected", { replace: true });
          return;
        }
      } catch {
        /* keep polling — transient errors shouldn't kill the loop */
      }
      schedule();
    }

    function schedule() {
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    function onVisibility() {
      // Run an immediate poll when the tab regains focus.
      if (!document.hidden) {
        if (timer) clearTimeout(timer);
        void tick();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, navigate]);

  async function handleRefresh() {
    setRefreshing(true);
    const me = await refresh();
    setRefreshing(false);
    if (!me) {
      toast({
        title: "Could not refresh",
        description: "Try signing in again.",
        variant: "destructive",
      });
      return;
    }
    if (me.status === "approved") {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (me.status === "rejected") {
      navigate("/rejected", { replace: true });
      return;
    }
    toast({
      title: "Still pending",
      description: "An admin will review your request shortly.",
    });
  }

  async function copyHandle(handle: string) {
    try {
      await navigator.clipboard.writeText(handle);
      toast({ title: "Copied", description: handle, variant: "success" });
    } catch {
      toast({ title: "Copy failed", description: handle, variant: "destructive" });
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
              "radial-gradient(60% 50% at 30% 20%, var(--glow), transparent 70%), radial-gradient(50% 50% at 80% 80%, rgba(246, 173, 85, 0.08), transparent 70%)",
          }}
        />

        <div className="w-full max-w-xl mx-auto">
          <div className="liquid-glass rounded-full px-4 py-1.5 inline-flex items-center gap-2 mb-6 animate-fade-rise">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
              style={{ background: "var(--accent-amber)" }}
            />
            <span
              className="text-[10px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "var(--text-secondary)" }}
            >
              Pending Approval
            </span>
          </div>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="liquid-glass-strong rounded-3xl p-7 sm:p-9"
          >
            <div className="flex items-center gap-3">
              <div className="liquid-glass w-10 h-10 rounded-full flex items-center justify-center">
                <Sparkles
                  className="w-4 h-4"
                  style={{ color: "var(--accent-amber)" }}
                />
              </div>
              <div
                className="text-[10px] font-mono tracking-[0.2em] uppercase"
                style={{ color: "var(--accent-foid)" }}
              >
                // Queue Position
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
              You&apos;re in the queue.
            </h1>
            <p
              className="mt-3 text-sm font-mono leading-relaxed max-w-md"
              style={{ color: "var(--text-secondary)" }}
            >
              Admin approval pending. We&apos;ll notify you in the Discord guild
              once your access is granted.
            </p>

            <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="liquid-glass rounded-2xl p-4">
                <div
                  className="text-[10px] font-mono tracking-[0.2em] uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  Status
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
                    style={{ background: "var(--accent-amber)" }}
                  />
                  <span
                    className="text-base"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      color: "var(--accent-amber)",
                    }}
                  >
                    Pending review
                  </span>
                </div>
              </div>
              <div className="liquid-glass rounded-2xl p-4">
                <div
                  className="text-[10px] font-mono tracking-[0.2em] uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  Discord
                </div>
                <div
                  className="mt-2 text-base truncate"
                  style={{
                    fontFamily: "var(--font-mono-foid)",
                    color: "var(--text-primary)",
                  }}
                >
                  {user?.discord_username
                    ? `@${user.discord_username}`
                    : "—"}
                </div>
              </div>
            </div>

            <div className="mt-7">
              <div
                className="text-[10px] font-mono tracking-[0.2em] uppercase mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Ping an admin (click to copy)
              </div>
              <div className="flex flex-wrap gap-2">
                {ADMINS.map((handle, i) => (
                  <motion.button
                    type="button"
                    key={handle}
                    onClick={() => copyHandle(handle)}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.06, duration: 0.4 }}
                    whileHover={reduce ? undefined : { scale: 1.03, y: -1 }}
                    whileTap={reduce ? undefined : { scale: 0.97 }}
                    className="liquid-glass rounded-full px-3.5 py-1.5 inline-flex items-center gap-2 text-xs cursor-pointer"
                    style={{
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono-foid)",
                    }}
                  >
                    <Copy
                      className="w-3 h-3"
                      style={{ color: "var(--text-muted)" }}
                    />
                    {handle}
                  </motion.button>
                ))}
              </div>
            </div>

            <div
              className="mt-8 pt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
              style={{ borderTop: "1px solid var(--border-foid)" }}
            >
              <a
                href={DISCORD_INVITE}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full px-5 py-2.5 text-sm font-medium text-white cursor-pointer inline-flex items-center justify-center gap-2 transition-transform hover:scale-[1.03]"
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
                <DiscordIcon className="w-4 h-4" />
                <span>Open Discord</span>
              </a>
              <motion.button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                whileHover={reduce ? undefined : { scale: 1.02 }}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                className="liquid-glass rounded-full px-5 py-2.5 text-sm cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                <RefreshCw
                  className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
                />
                <span>{refreshing ? "Checking…" : "Refresh status"}</span>
              </motion.button>
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
