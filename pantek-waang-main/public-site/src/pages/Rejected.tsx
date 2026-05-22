import { Link } from "react-router-dom";
import { ShieldX, Copy } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import { DiscordIcon } from "@/components/DiscordIcon";
import { toast } from "@/components/ui/toast";
import { useTheme } from "@/hooks/useTheme";

const ADMINS = ["@nods911_", "@arveloon", "@iqbal4o4"] as const;
const DISCORD_INVITE = "https://discord.gg/dy78P5vP62";

export default function Rejected() {
  // Apply data-theme even when landing directly here.
  useTheme();

  const reduce = useReducedMotion();

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
              "radial-gradient(60% 50% at 50% 30%, rgba(246, 135, 179, 0.10), transparent 70%)",
          }}
        />

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-lg mx-auto"
        >
          <div className="liquid-glass rounded-full px-4 py-1.5 inline-flex items-center gap-2 mb-6 animate-fade-rise">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
              style={{ background: "var(--accent-put)" }}
            />
            <span
              className="text-[10px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "var(--text-secondary)" }}
            >
              Access Denied
            </span>
          </div>

          <div
            className="liquid-glass-strong rounded-3xl p-7 sm:p-9"
            style={{
              boxShadow:
                "4px 4px 8px rgba(0, 0, 0, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.15), 0 0 30px rgba(246, 135, 179, 0.10)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="liquid-glass w-10 h-10 rounded-full flex items-center justify-center">
                <ShieldX
                  className="w-4 h-4"
                  style={{ color: "var(--accent-put)" }}
                />
              </div>
              <div
                className="text-[10px] font-mono tracking-[0.2em] uppercase"
                style={{ color: "var(--accent-put)" }}
              >
                // Status: Rejected
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
              Access not approved.
            </h1>
            <p
              className="mt-4 text-sm font-mono leading-relaxed max-w-md"
              style={{ color: "var(--text-secondary)" }}
            >
              A FlowOptionID admin reviewed your account and chose not to grant
              access. Reach out to the team if this was unexpected.
            </p>

            <div className="mt-7">
              <div
                className="text-[10px] font-mono tracking-[0.2em] uppercase mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Contact admins (click to copy)
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
              <Link
                to="/"
                className="liquid-glass rounded-full px-5 py-2.5 text-sm cursor-pointer inline-flex items-center justify-center"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                Back to home
              </Link>
            </div>
          </div>
        </motion.div>
      </section>
    </Layout>
  );
}
