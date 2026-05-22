import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useInView } from "framer-motion";

type MetricKind = "currency-b" | "integer" | "percent";

interface Metric {
  kind: MetricKind;
  target: number;
  prefix: string;
  suffix: string;
  label: string;
  sub: string;
  subColor: string;
}

const metrics: readonly Metric[] = [
  {
    kind: "currency-b",
    target: 4.2,
    prefix: "+$",
    suffix: "B",
    label: "GEX Net Total",
    sub: "Bullish Gamma Regime",
    subColor: "var(--accent-foid)",
  },
  {
    kind: "integer",
    target: 5720,
    prefix: "",
    suffix: "",
    label: "Gamma Flip Level",
    sub: "5,800 Call Wall",
    subColor: "var(--text-muted)",
  },
  {
    kind: "percent",
    target: 14.8,
    prefix: "",
    suffix: "%",
    label: "ATM IV",
    sub: "25Δ RR −2.4%",
    subColor: "var(--accent-put)",
  },
] as const;

function useCountUp(target: number, durationMs: number, start: boolean): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(target * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, start]);
  return v;
}

function formatMetric(kind: MetricKind, value: number, prefix: string, suffix: string): string {
  switch (kind) {
    case "currency-b":
      return `${prefix}${value.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}${suffix}`;
    case "integer":
      return `${prefix}${Math.round(value).toLocaleString("en-US")}${suffix}`;
    case "percent":
      return `${prefix}${value.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}${suffix}`;
  }
}

interface MetricCellProps {
  metric: Metric;
  start: boolean;
  index: number;
}

function MetricCell({ metric, start, index }: MetricCellProps) {
  const value = useCountUp(metric.target, 1400, start);
  const formatted = formatMetric(metric.kind, value, metric.prefix, metric.suffix);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.5, delay: index * 0.12 }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "clamp(2.5rem, 6vw, 4rem)",
          color: "var(--text-primary)",
          lineHeight: 1,
        }}
      >
        {formatted}
      </div>
      <div
        className="text-[10px] font-mono tracking-widest uppercase mt-3"
        style={{ color: "var(--text-muted)" }}
      >
        {metric.label}
      </div>
      <div
        className="text-xs font-mono mt-1"
        style={{ color: metric.subColor }}
      >
        {metric.sub}
      </div>
    </motion.div>
  );
}

export function DataTeaserSection() {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="py-24 px-8 flex flex-col items-center text-center"
      style={{
        background: "var(--bg)",
        borderTop: "1px solid var(--border-foid)",
        borderBottom: "1px solid var(--border-foid)",
      }}
    >
      <div
        className="text-[9px] font-mono tracking-[0.25em] uppercase mb-16"
        style={{ color: "var(--accent-foid)" }}
      >
        // Sample Data — Live Values Updated Every 30s
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-3xl w-full">
        {metrics.map((metric, i) => (
          <MetricCell
            key={metric.label}
            metric={metric}
            start={inView}
            index={i}
          />
        ))}
      </div>

      <div className="liquid-glass rounded-2xl px-6 py-4 inline-flex items-center gap-3 mt-16">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
        <span
          className="text-xs font-mono"
          style={{ color: "var(--text-secondary)" }}
        >
          Live data requires Discord auth
        </span>
        <button
          type="button"
          className="text-xs font-mono underline underline-offset-2 cursor-pointer"
          style={{ color: "var(--accent-foid)" }}
          onClick={() => navigate("/register")}
        >
          Join Now
        </button>
      </div>
    </section>
  );
}

export default DataTeaserSection;
