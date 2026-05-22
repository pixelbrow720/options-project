import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Compass } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { decimalsFor, formatDollarsCompact, formatPrice } from "@/lib/format";

interface GammaCompassProps {
  symbol: string;
  gexNetTotal: number | null;
  zeroGamma: number | null;
  spot: number | null;
  volTrigger: number | null;
  loading?: boolean;
  className?: string;
}

/**
 * Normalize a gamma score into the range [-1, 1] using a soft compression curve.
 * Treats $5B as a saturated reading either direction.
 */
function normalizeGamma(value: number, ceiling = 5e9): number {
  if (!Number.isFinite(value)) return 0;
  const ratio = value / ceiling;
  // tanh-like compression so big swings still leave room for finer reads.
  const compressed = Math.tanh(ratio * 1.1);
  return Math.max(-1, Math.min(1, compressed));
}

/**
 * Convert a normalized gamma score (-1..+1) to a needle rotation in degrees.
 * -1 = -90deg (left/red), 0 = 0deg (center/amber), +1 = +90deg (right/green).
 */
function scoreToAngle(score: number): number {
  return Math.max(-90, Math.min(90, score * 90));
}

/**
 * Cartesian point on the gauge arc for the given angle (in degrees).
 * Uses the gauge's own coordinate frame: cx, cy = arc center; r = radius.
 */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function GammaCompassImpl({
  symbol,
  gexNetTotal,
  zeroGamma,
  spot,
  volTrigger,
  loading = false,
  className,
}: GammaCompassProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);

  const score = useMemo(() => {
    if (gexNetTotal === null || !Number.isFinite(gexNetTotal)) return 0;
    return normalizeGamma(gexNetTotal);
  }, [gexNetTotal]);

  const needleAngle = scoreToAngle(score);
  const isPositive = (gexNetTotal ?? 0) >= 0;
  const regimeLabel = isPositive ? "POSITIVE" : "NEGATIVE";
  const regimeColor = isPositive ? "hsl(var(--emerald))" : "hsl(var(--rose))";

  const caption = isPositive
    ? "Dealers long gamma — sell rallies, buy dips. Suppressed vol."
    : "Dealers short gamma — chase moves. Volatility expansion likely.";

  // Color the spot value based on its position relative to flip and trigger.
  const spotTone = useMemo(() => {
    if (spot === null) return "var(--text-secondary)";
    if (zeroGamma !== null) {
      if (spot >= zeroGamma) {
        // Above flip — long-gamma side. Compare to vol trigger if present.
        if (volTrigger !== null && spot < volTrigger) {
          return "hsl(var(--amber))";
        }
        return "hsl(var(--emerald))";
      }
      // Below flip — short-gamma territory.
      return "hsl(var(--rose))";
    }
    return "var(--text-primary)";
  }, [spot, zeroGamma, volTrigger]);

  // SVG geometry
  const SIZE = 240;
  const CX = SIZE / 2;
  const CY = SIZE / 2 + 12; // shift down so arc sits in upper portion
  const R = 96;
  const STROKE = 16;

  // Arc spans from -90 (left) to 90 (right), top half.
  const ARC_START = -90;
  const ARC_END = 90;

  // Three gradient zones: red(-90..-30), amber(-30..30), green(30..90).
  const zoneRed = describeArc(CX, CY, R, ARC_START, -30);
  const zoneAmber = describeArc(CX, CY, R, -30, 30);
  const zoneGreen = describeArc(CX, CY, R, 30, ARC_END);

  // Inner tick marks (every 30 degrees within the arc).
  const tickAngles = [-90, -60, -30, 0, 30, 60, 90];

  const hasGauge = gexNetTotal !== null && Number.isFinite(gexNetTotal);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={cn("liquid-glass-strong rounded-3xl p-6", className)}
    >
      <div className="space-y-4">
        <div className="flex flex-row items-baseline justify-between gap-3">
          <div>
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Gamma compass
            </div>
            <p
              className="mt-1.5 text-xs font-mono"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              Dealer gamma regime · 0DTE
            </p>
          </div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.18em]"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono-foid)",
            }}
          >
            {symbol}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-5">
            <Skeleton className="h-[240px] w-[240px] rounded-full" />
            <div className="grid w-full grid-cols-3 gap-2">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
            <Skeleton className="h-3 w-full rounded" />
          </div>
        ) : !hasGauge ? (
          <EmptyState
            icon={<Compass />}
            headline="Gamma regime pending"
            subline="Compass populates once the chain has computed today's net dealer gamma."
            pad="md"
            inline
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            {/* Gauge */}
            <div className="relative">
              <svg
                width={SIZE}
                height={SIZE / 2 + 36}
                viewBox={`0 0 ${SIZE} ${SIZE / 2 + 36}`}
                role="img"
                aria-label={`Gamma regime ${regimeLabel}`}
              >
                <defs>
                  <linearGradient id="gc-track" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="hsl(var(--rose))" stopOpacity="0.85" />
                    <stop offset="50%" stopColor="hsl(var(--amber))" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="hsl(var(--emerald))" stopOpacity="0.85" />
                  </linearGradient>
                </defs>

                {/* Zone arcs */}
                <path
                  d={zoneRed}
                  fill="none"
                  stroke="hsl(var(--rose))"
                  strokeOpacity={0.85}
                  strokeWidth={STROKE}
                  strokeLinecap="butt"
                />
                <path
                  d={zoneAmber}
                  fill="none"
                  stroke="hsl(var(--amber))"
                  strokeOpacity={0.85}
                  strokeWidth={STROKE}
                  strokeLinecap="butt"
                />
                <path
                  d={zoneGreen}
                  fill="none"
                  stroke="hsl(var(--emerald))"
                  strokeOpacity={0.85}
                  strokeWidth={STROKE}
                  strokeLinecap="butt"
                />

                {/* Inner edge ring (subtle) */}
                <path
                  d={describeArc(CX, CY, R - STROKE / 2 - 1, ARC_START, ARC_END)}
                  fill="none"
                  stroke="hsl(var(--background))"
                  strokeOpacity={0.6}
                  strokeWidth={1}
                />

                {/* Tick marks */}
                {tickAngles.map((a) => {
                  const outer = polar(CX, CY, R - STROKE / 2 - 2, a);
                  const inner = polar(CX, CY, R - STROKE - 4, a);
                  return (
                    <line
                      key={`tick-${a}`}
                      x1={inner.x}
                      y1={inner.y}
                      x2={outer.x}
                      y2={outer.y}
                      stroke="hsl(var(--background))"
                      strokeOpacity={0.7}
                      strokeWidth={1.25}
                    />
                  );
                })}

                {/* Needle pivot */}
                <circle
                  cx={CX}
                  cy={CY}
                  r={6}
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--foreground))"
                  strokeWidth={1.25}
                />

                {/* Needle */}
                <motion.g
                  style={{ transformOrigin: `${CX}px ${CY}px` }}
                  initial={reduce ? false : { rotate: -90 }}
                  animate={{ rotate: needleAngle }}
                  transition={{
                    duration: reduce ? 0 : 0.85,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <line
                    x1={CX}
                    y1={CY}
                    x2={CX}
                    y2={CY - (R - STROKE / 2 - 6)}
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={CX}
                    cy={CY - (R - STROKE / 2 - 6)}
                    r={3.5}
                    fill="hsl(var(--foreground))"
                  />
                </motion.g>

                {/* End labels */}
                <text
                  x={CX - R - 4}
                  y={CY + 6}
                  textAnchor="end"
                  fontFamily="var(--font-mono-foid)"
                  fontSize={10}
                  fill="var(--text-muted)"
                >
                  SHORT Γ
                </text>
                <text
                  x={CX + R + 4}
                  y={CY + 6}
                  textAnchor="start"
                  fontFamily="var(--font-mono-foid)"
                  fontSize={10}
                  fill="var(--text-muted)"
                >
                  LONG Γ
                </text>
              </svg>

              {/* Center value overlay */}
              <div
                className="pointer-events-none absolute left-0 right-0 flex flex-col items-center"
                style={{ top: CY + 14 }}
              >
                <div
                  className="leading-none tabular-nums"
                  style={{
                    color: regimeColor,
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
                  }}
                >
                  {formatDollarsCompact(gexNetTotal)}
                </div>
                <div
                  className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: regimeColor, fontFamily: "var(--font-mono-foid)" }}
                >
                  {regimeLabel} Γ
                </div>
              </div>
            </div>

            {/* Micro stats */}
            <div className="grid w-full grid-cols-3 gap-2 pt-2">
              <div className="liquid-glass rounded-xl px-3 py-2 text-center">
                <div
                  className="text-[10px] font-mono uppercase tracking-[0.2em]"
                  style={{
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Spot
                </div>
                <div
                  className="mt-0.5 font-mono text-sm font-semibold tabular-nums"
                  style={{
                    color: spotTone,
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  {spot !== null ? formatPrice(spot, dec) : "—"}
                </div>
              </div>
              <div className="liquid-glass rounded-xl px-3 py-2 text-center">
                <div
                  className="text-[10px] font-mono uppercase tracking-[0.2em]"
                  style={{
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Flip
                </div>
                <div
                  className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[hsl(var(--violet))]"
                  style={{ fontFamily: "var(--font-mono-foid)" }}
                >
                  {zeroGamma !== null ? formatPrice(zeroGamma, dec) : "—"}
                </div>
              </div>
              <div className="liquid-glass rounded-xl px-3 py-2 text-center">
                <div
                  className="text-[10px] font-mono uppercase tracking-[0.2em]"
                  style={{
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Trigger
                </div>
                <div
                  className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[hsl(var(--amber))]"
                  style={{ fontFamily: "var(--font-mono-foid)" }}
                >
                  {volTrigger !== null ? formatPrice(volTrigger, dec) : "—"}
                </div>
              </div>
            </div>

            {/* Caption */}
            <p
              className="text-center text-xs font-mono leading-relaxed"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              {caption}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const GammaCompass = memo(GammaCompassImpl);

export default GammaCompass;
