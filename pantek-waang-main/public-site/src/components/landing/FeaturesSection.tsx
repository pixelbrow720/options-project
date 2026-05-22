import { motion } from "framer-motion";

interface FeatureCard {
  num: string;
  tag: string;
  name: string;
  desc: string;
  chips: readonly string[];
}

const cards: readonly FeatureCard[] = [
  {
    num: "01",
    tag: "DEFAULT",
    name: "Pro",
    desc: "SpotHero, GammaCompass, HIRO Chart, Key Levels, Pin Risk, Vol Trigger, Move Tracker.",
    chips: ["GEX", "HIRO", "Charm", "Vanna", "0DTE"],
  },
  {
    num: "02",
    tag: "INTRADAY",
    name: "Intraday",
    desc: "Charm Heatmap, Gamma Flip Tracker, Historical Replay scrubber, GEX Curve chain-wide.",
    chips: ["Time Series", "Replay", "Flip Level"],
  },
  {
    num: "03",
    tag: "FLOW",
    name: "Flow",
    desc: "Premium Flow Panel (calls/puts/net), Dealer Positioning ±5%, Strike Migration 1H→NOW.",
    chips: ["Block Trades", "Dealer", "Migration"],
  },
  {
    num: "04",
    tag: "CHAIN",
    name: "Chain",
    desc: "Full Chain Heatmap 200+ strikes, Absolute Gamma, TOS-style Options Chain Table.",
    chips: ["200+ Strikes", "OI · IV", "Delta · Gamma"],
  },
  {
    num: "05",
    tag: "VOL SURFACE",
    name: "Vol Surface",
    desc: "IV Skew by expiry, Term Structure contango/inverted, Move Tracker 0–150%, 25Δ RR.",
    chips: ["Skew", "Term Struct", "25Δ RR"],
  },
] as const;

export function FeaturesSection() {
  return (
    <section
      className="min-h-screen flex flex-col justify-center px-8 md:px-16 lg:px-20 py-24"
      style={{ background: "var(--bg)" }}
    >
      {/* Header */}
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
          // 21 Analytics Components
        </div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            color: "var(--text-primary)",
          }}
          className="text-5xl md:text-6xl lg:text-7xl leading-[0.9] tracking-[-2px] max-w-3xl"
        >
          Everything the<br />
          market hides.<br />
          Revealed.
        </h2>
        <p
          className="mt-6 text-sm font-mono leading-relaxed max-w-lg"
          style={{ color: "var(--text-secondary)" }}
        >
          Computed from live OPRA Pillar data every 30 seconds. Five analytical tabs, zero noise.
        </p>
      </motion.div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-16">
        {cards.map((card, i) => (
          <motion.div
            key={card.num}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="liquid-glass rounded-[1.5rem] p-6 min-h-[260px] flex flex-col cursor-default"
          >
            <div className="flex items-start justify-between">
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "3rem",
                  color: "var(--text-muted)",
                  lineHeight: "1",
                }}
              >
                {card.num}
              </span>
              <span
                className="liquid-glass rounded-full px-2.5 py-0.5 text-[9px] font-mono tracking-widest uppercase"
                style={{ color: "var(--text-secondary)" }}
              >
                {card.tag}
              </span>
            </div>
            <div className="flex-1" />
            <div className="mt-6">
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "1.5rem",
                  letterSpacing: "-0.5px",
                  color: "var(--text-primary)",
                }}
              >
                {card.name}
              </div>
              <p
                className="mt-2 text-xs font-mono leading-relaxed max-w-[32ch]"
                style={{ color: "var(--text-secondary)" }}
              >
                {card.desc}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {card.chips.map((c) => (
                  <span
                    key={c}
                    className="liquid-glass rounded-full px-2.5 py-0.5 text-[10px] font-mono"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        ))}

        {/* Sixth card — real-time highlight */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="liquid-glass-strong rounded-[1.5rem] p-8 flex flex-col md:flex-row items-center justify-between gap-6 lg:col-span-3 md:col-span-2"
        >
          <div>
            <div
              className="text-[9px] font-mono tracking-[0.2em] uppercase mb-3"
              style={{ color: "var(--accent-foid)" }}
            >
              REAL-TIME
            </div>
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "1.875rem",
                color: "var(--text-primary)",
              }}
            >
              Sub-second tick stream.
            </h3>
            <p
              className="text-sm font-mono leading-relaxed mt-2 max-w-md"
              style={{ color: "var(--text-secondary)" }}
            >
              SSE + WebSocket with automatic reconnect. Snapshot computed every 30 seconds from live OPRA Pillar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {["SSE · WS Fallback", "30s Snapshot", "Auto-reconnect"].map((pill) => (
              <span
                key={pill}
                className="liquid-glass rounded-full px-4 py-2 text-xs font-mono"
                style={{ color: "var(--text-secondary)" }}
              >
                {pill}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default FeaturesSection;
