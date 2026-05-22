import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: number;
  animated?: boolean;
}

/**
 * FlowOptionID glyph: a strike-line crossed by a flow curve.
 * On hover the curve subtly shifts phase (when motion is allowed).
 */
export function Logo({ className, size = 28, animated = true }: LogoProps) {
  const reduce = useReducedMotion();
  const allowMotion = animated && !reduce;

  const id = "flow-grad";
  const dim = size;

  return (
    <motion.svg
      width={dim}
      height={dim}
      viewBox="0 0 28 28"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      whileHover={allowMotion ? "hover" : undefined}
      initial="rest"
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--accent))" />
        </linearGradient>
      </defs>
      <line
        x1="3.5"
        y1="14"
        x2="24.5"
        y2="14"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.25"
        strokeDasharray="2 2"
      />
      <motion.path
        d="M3.5 8 C 9 8, 11 20, 16 20 C 21 20, 22 12, 24.5 10"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="2.1"
        strokeLinecap="round"
        variants={{
          rest: { d: "M3.5 8 C 9 8, 11 20, 16 20 C 21 20, 22 12, 24.5 10" },
          hover: { d: "M3.5 10 C 9 22, 11 6, 16 14 C 21 22, 22 8, 24.5 12" },
        }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
      />
      <circle cx="24.5" cy="10" r="1.6" fill="hsl(var(--accent))" />
    </motion.svg>
  );
}
