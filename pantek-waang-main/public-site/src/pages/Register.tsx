import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, ExternalLink, MessageSquare } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import { DiscordIcon } from "@/components/DiscordIcon";
import { Auth, describeApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { useTheme } from "@/hooks/useTheme";

const ADMINS = ["@nods911_", "@arveloon", "@iqbal4o4"] as const;
const DISCORD_INVITE = "https://discord.gg/dy78P5vP62";

interface Step {
  step: string;
  title: string;
  description: string;
}

const STEPS: readonly Step[] = [
  {
    step: "STEP 01",
    title: "Join the Discord guild",
    description: "Our community runs on Discord. Join, then move on to verification.",
  },
  {
    step: "STEP 02",
    title: "Verify with Discord OAuth",
    description: "We confirm your handle is in our server. No DMs, no scope creep.",
  },
  {
    step: "STEP 03",
    title: "Wait for admin approval",
    description: "Ping one of our admins on Discord and they'll issue your API key.",
  },
] as const;

export default function Register() {
  // Apply data-theme even when landing directly here.
  useTheme();

  const [discordLoading, setDiscordLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) setError(err);
  }, []);

  async function startDiscord() {
    setDiscordLoading(true);
    setError(null);
    try {
      const resp = await Auth.discordStart();
      // Defence-in-depth: only redirect to an HTTPS discord.com authorize URL.
      // If the backend is ever tampered with to return a different host, we
      // refuse to navigate there rather than ship the user off to a phishing
      // page that pretends to be Discord OAuth.
      let target: URL;
      try {
        target = new URL(resp.url);
      } catch {
        setError("Discord OAuth returned an invalid URL.");
        setDiscordLoading(false);
        return;
      }
      const okHost = target.hostname === "discord.com" || target.hostname === "discordapp.com";
      if (target.protocol !== "https:" || !okHost) {
        setError("Discord OAuth target rejected (not an https://discord.com URL).");
        setDiscordLoading(false);
        return;
      }
      window.location.assign(target.toString());
    } catch (err) {
      setError(describeApiError(err, "Could not start Discord OAuth."));
      setDiscordLoading(false);
    }
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
              "radial-gradient(60% 50% at 50% 30%, var(--glow), transparent 70%)",
          }}
        />

        <div className="w-full max-w-2xl mx-auto">
          <div className="liquid-glass rounded-full px-4 py-1.5 inline-flex items-center gap-2 mb-6 animate-fade-rise">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
            <span
              className="text-[10px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "var(--text-secondary)" }}
            >
              Discord-Gated Access
            </span>
          </div>

          <div className="liquid-glass-strong rounded-3xl p-7 sm:p-9 animate-fade-rise-d1">
            <div
              className="text-[10px] font-mono tracking-[0.2em] uppercase mb-3"
              style={{ color: "var(--accent-foid)" }}
            >
              // Onboarding
            </div>
            <h1
              className="text-4xl sm:text-5xl md:text-6xl leading-[0.95] tracking-[-2px]"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                color: "var(--text-primary)",
              }}
            >
              Join the guild.
            </h1>
            <p
              className="mt-4 text-sm font-mono leading-relaxed max-w-md"
              style={{ color: "var(--text-secondary)" }}
            >
              Three steps to FlowOptionID: join Discord, verify with OAuth, then
              wait for admin approval.
            </p>

            <div className="grid gap-4 mt-8">
              {STEPS.map(({ step, title, description }, i) => (
                <motion.div
                  key={step}
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.15 + i * 0.08 }}
                  className="liquid-glass rounded-2xl p-5 flex items-start gap-4"
                >
                  <div className="liquid-glass w-9 h-9 rounded-full flex items-center justify-center shrink-0">
                    <span
                      className="text-[10px] font-mono tracking-[0.15em]"
                      style={{ color: "var(--accent-foid)" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex-1">
                    <div
                      className="text-[10px] font-mono tracking-[0.2em] uppercase"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {step}
                    </div>
                    <div
                      className="mt-1.5 text-lg leading-snug"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontStyle: "italic",
                        color: "var(--text-primary)",
                      }}
                    >
                      {title}
                    </div>
                    <div
                      className="mt-1 text-xs font-mono leading-relaxed"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {description}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {error ? (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 liquid-glass rounded-xl px-4 py-3 text-xs font-mono"
                style={{ color: "var(--accent-put)" }}
              >
                {error}
              </motion.div>
            ) : null}

            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <a
                href={DISCORD_INVITE}
                target="_blank"
                rel="noopener noreferrer"
                className="liquid-glass-strong rounded-full px-6 py-3 text-sm font-mono cursor-pointer inline-flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
                style={{ color: "var(--text-primary)" }}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Join Discord</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </a>
              <motion.button
                type="button"
                whileHover={reduce ? undefined : { scale: 1.02 }}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                onClick={startDiscord}
                disabled={discordLoading}
                className="rounded-full px-6 py-3 text-sm font-medium text-white cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed flex-1"
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
                <span>{discordLoading ? "Redirecting…" : "Continue with Discord"}</span>
              </motion.button>
            </div>

            <div
              className="mt-8 pt-6"
              style={{ borderTop: "1px solid var(--border-foid)" }}
            >
              <div
                className="text-[10px] font-mono tracking-[0.2em] uppercase mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Ping an admin (click to copy)
              </div>
              <div className="flex flex-wrap gap-2">
                {ADMINS.map((handle) => (
                  <motion.button
                    type="button"
                    key={handle}
                    onClick={() => copyHandle(handle)}
                    whileHover={reduce ? undefined : { y: -1, scale: 1.03 }}
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
              <div
                className="mt-5 text-xs font-mono text-center sm:text-left"
                style={{ color: "var(--text-secondary)" }}
              >
                Already have a key?{" "}
                <Link
                  to="/login"
                  className="transition-colors hover:opacity-80"
                  style={{ color: "var(--accent-foid)" }}
                >
                  Sign in →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
