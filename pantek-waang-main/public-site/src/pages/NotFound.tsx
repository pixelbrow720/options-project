import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useTheme } from "@/hooks/useTheme";

export default function NotFound() {
  // Apply data-theme even when landing directly here.
  useTheme();

  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 60, damping: 14 });
  const y = useSpring(my, { stiffness: 60, damping: 14 });

  const [size, setSize] = useState({ w: 1, h: 1 });

  useEffect(() => {
    if (reduce) return;
    function onMove(e: MouseEvent) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      mx.set((e.clientX - cx) / 28);
      my.set((e.clientY - cy) / 36);
    }
    function onResize() {
      setSize({ w: window.innerWidth, h: window.innerHeight });
    }
    onResize();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
    };
  }, [mx, my, reduce]);

  return (
    <Layout variant="marketing">
      <section className="relative flex-1 flex items-center justify-center px-6 py-12 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 30%, var(--glow), transparent 70%)",
          }}
        />

        <div className="w-full max-w-2xl mx-auto text-center">
          <div className="liquid-glass rounded-full px-4 py-1.5 inline-flex items-center gap-2 mb-8 animate-fade-rise">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
            <span
              className="text-[10px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "var(--text-secondary)" }}
            >
              Route Not Found
            </span>
          </div>

          <motion.div
            style={{ x: reduce ? 0 : x, y: reduce ? 0 : y }}
            aria-hidden={size.w === 1}
            className="text-[8rem] sm:text-[10rem] md:text-[14rem] leading-[0.85] tracking-[-6px] animate-fade-rise-d1"
          >
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                color: "var(--text-primary)",
              }}
            >
              4
              <em
                className="not-italic"
                style={{ color: "var(--accent-foid)", fontStyle: "italic" }}
              >
                0
              </em>
              4
            </span>
          </motion.div>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.45 }}
            className="mt-6 text-sm sm:text-base font-mono leading-relaxed max-w-md mx-auto"
            style={{ color: "var(--text-secondary)" }}
          >
            This page doesn&apos;t exist. The market is volatile, but
            FlowOptionID&apos;s routes aren&apos;t.
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.45 }}
            className="mt-8 flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Link
              to="/"
              className="rounded-full px-6 py-3 text-sm font-medium text-white cursor-pointer inline-flex items-center justify-center gap-2 transition-transform hover:scale-[1.03]"
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
              <ArrowLeft className="w-4 h-4" />
              <span>Back to home</span>
            </Link>
            <Link
              to="/dashboard"
              className="liquid-glass rounded-full px-6 py-3 text-sm cursor-pointer inline-flex items-center justify-center"
              style={{
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Dashboard
            </Link>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
