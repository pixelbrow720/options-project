import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, ArrowUpRight, Clock, TrendingUp, Users } from "lucide-react";
import { VideoBackground } from "../VideoBackground";
import { DiscordIcon } from "../DiscordIcon";
import { Navbar } from "./Navbar";
import type { Theme } from "../../hooks/useTheme";

interface HeroSectionProps {
  theme: Theme;
  onThemeToggle: () => void;
}

/**
 * Animates a number from 0 to `target` over `durationMs` using easeOutCubic.
 * Returns the current interpolated value; consumers format as needed.
 */
function useCountUp(target: number, durationMs = 1200): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface StatCardProps {
  Icon: LucideIcon;
  iconColor: string;
  label: string;
  value: string;
  valueColor: string;
}

function StatCard({ Icon, iconColor, label, value, valueColor }: StatCardProps) {
  return (
    <div className="liquid-glass rounded-2xl p-4 w-[155px] flex flex-col gap-3">
      <div className="w-6 h-6" style={{ color: iconColor }}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div
          className="text-[10px] font-mono tracking-widest uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "1.5rem",
            color: valueColor,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

export function HeroSection({ theme, onThemeToggle }: HeroSectionProps) {
  const navigate = useNavigate();

  const gex = useCountUp(4.2);
  const snapshotAge = useCountUp(28);

  const gexFormatted = `+$${gex.toFixed(1)}B`;
  const snapshotFormatted = `${Math.round(snapshotAge)}s`;

  return (
    <section
      className="relative min-h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      <VideoBackground theme={theme} />
      <Navbar theme={theme} onThemeToggle={onThemeToggle} />

      <div className="relative z-10 flex flex-col items-center justify-center flex-1 text-center px-6 pb-16">
        {/* (a) Status badge */}
        <div className="liquid-glass rounded-full px-4 py-1.5 inline-flex items-center gap-2 mb-8 animate-fade-rise">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
          <span
            className="text-[10px] font-mono tracking-[0.2em] uppercase"
            style={{ color: "var(--text-secondary)" }}
          >
            Real-time SPX · NDX Options Flow
          </span>
        </div>

        {/* (b) Headline */}
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            color: "var(--text-primary)",
          }}
          className="animate-fade-rise-d1 text-5xl sm:text-7xl md:text-8xl leading-[0.88] tracking-[-3px] max-w-4xl mx-auto"
        >
          Institutional<br />
          <em className="not-italic" style={{ color: "var(--accent-foid)" }}>
            Options Flow.
          </em>
          <br />
          For Everyone.
        </h1>

        {/* (c) Subheading */}
        <p
          className="animate-fade-rise-d2 mt-8 text-base sm:text-lg font-mono font-light leading-relaxed max-w-xl mx-auto"
          style={{ color: "var(--text-secondary)" }}
        >
          GEX, HIRO, Charm, Vanna, Pin Risk — computed every 30 seconds from live OPRA data.
          Institutional-grade analytics. Discord-gated access.
        </p>

        {/* (d) CTA row */}
        <div className="animate-fade-rise-d3 flex items-center justify-center gap-4 mt-10 flex-wrap">
          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            onClick={() => navigate("/register")}
            className="rounded-full px-8 py-3.5 text-sm font-mono font-medium text-white cursor-pointer flex items-center gap-2"
            style={{
              background:
                "linear-gradient(135deg, #5865F2 0%, #4752C4 60%, #8B5CF6 100%)",
              boxShadow:
                "0 0 30px rgba(88,101,242,0.35), inset 0 1px 1px rgba(255,255,255,0.15)",
              outline: "2px solid rgba(255,255,255,0.12)",
              outlineOffset: "-2px",
            }}
          >
            <DiscordIcon className="w-4 h-4" />
            <span>Join via Discord</span>
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            onClick={() => navigate("/dashboard")}
            className="liquid-glass-strong rounded-full px-8 py-3.5 text-sm font-mono cursor-pointer flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <span>View Live Dashboard</span>
            <ArrowUpRight className="w-4 h-4" />
          </motion.button>
        </div>

        {/* (e) Stat cards row */}
        <div className="animate-fade-rise-d4 flex items-stretch justify-center gap-3 mt-12 flex-wrap">
          <StatCard
            Icon={Activity}
            iconColor="var(--accent-foid)"
            label="GEX Net Total"
            value={gexFormatted}
            valueColor="var(--text-primary)"
          />
          <StatCard
            Icon={TrendingUp}
            iconColor="#4ADE80"
            label="HIRO Signal"
            value="BULLISH"
            valueColor="#4ADE80"
          />
          <StatCard
            Icon={Clock}
            iconColor="var(--accent-amber)"
            label="Snapshot Age"
            value={snapshotFormatted}
            valueColor="var(--text-primary)"
          />
          <StatCard
            Icon={Users}
            iconColor="var(--text-muted)"
            label="Active Users"
            value="—"
            valueColor="var(--text-muted)"
          />
        </div>
      </div>
    </section>
  );
}

export default HeroSection;
