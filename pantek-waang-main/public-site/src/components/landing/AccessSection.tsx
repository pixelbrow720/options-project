import type { ComponentType, SVGProps } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageSquare, Clock, LayoutDashboard } from "lucide-react";
import { DiscordIcon } from "../DiscordIcon";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface Step {
  step: string;
  icon: LucideIcon;
  title: string;
  desc: string;
}

const steps: readonly Step[] = [
  {
    step: "STEP 01",
    icon: MessageSquare,
    title: "Join Discord",
    desc: "Authorize OAuth2 via Discord. Your guild membership is verified automatically.",
  },
  {
    step: "STEP 02",
    icon: Clock,
    title: "Pending Approval",
    desc: "Admin reviews and approves your access. Notification arrives in the guild.",
  },
  {
    step: "STEP 03",
    icon: LayoutDashboard,
    title: "Access Dashboard",
    desc: "Full access to all 5 analytical tabs. Real-time data, zero setup.",
  },
] as const;

export function AccessSection() {
  const navigate = useNavigate();

  return (
    <section
      className="px-8 md:px-16 lg:px-20 py-24"
      style={{ background: "var(--bg)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.7 }}
      >
        <div
          className="text-xs tracking-[0.2em] uppercase font-mono mb-4"
          style={{ color: "var(--accent-foid)" }}
        >
          // Access Control
        </div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            color: "var(--text-primary)",
          }}
          className="text-5xl md:text-6xl lg:text-7xl leading-[0.9] tracking-[-2px] max-w-2xl"
        >
          Exclusive.
          <br />
          Discord-Gated.
        </h2>
        <p
          className="mt-6 text-sm font-mono leading-relaxed max-w-lg"
          style={{ color: "var(--text-secondary)" }}
        >
          Institutional tools deserve institutional access control. Join the
          Discord guild, get approved by admin, and unlock the full dashboard.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 relative">
        <div
          className="absolute hidden md:block h-px"
          style={{
            top: "1.375rem",
            left: "calc(16.67% + 24px)",
            right: "calc(16.67% + 24px)",
            background: "var(--border-foid)",
          }}
        />
        {steps.map(({ step, icon: Icon, title, desc }, i) => (
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: i * 0.15 }}
          >
            <div className="flex flex-col items-center text-center">
              <div
                className="text-[9px] font-mono tracking-[0.2em] uppercase mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                {step}
              </div>
              <div className="liquid-glass-strong w-11 h-11 rounded-full flex items-center justify-center">
                <Icon
                  className="w-5 h-5"
                  style={{ color: "var(--accent-foid)" }}
                />
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "1.25rem",
                  color: "var(--text-primary)",
                }}
                className="mt-5"
              >
                {title}
              </div>
              <div
                className="text-xs font-mono leading-relaxed mt-2 max-w-[220px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {desc}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex justify-center mt-16">
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
      </div>
    </section>
  );
}

export default AccessSection;
