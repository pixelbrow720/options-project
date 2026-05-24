/**
 * FlowGreeks design tokens.
 *
 * Single TS source of truth for color, depth, motion and typography
 * primitives. Tailwind v4 reads matching CSS custom properties from
 * theme.css; this file lets TS code (R3F materials, framer-motion
 * variants, uPlot themes) consume the same values without parsing CSS.
 *
 * NEVER add raw hex literals in components. Add a token here and a
 * matching CSS variable in theme.css instead.
 */

export const colors = {
  // Background depth (darker = deeper). All UI surfaces sit on one of
  // these; glass surfaces add backdrop-filter blur on top.
  bg: {
    abyss: "#05070b",
    base: "#0a0e15",
    raised: "#0f141d",
    sunken: "#070a10",
  },

  // Foreground. tnum-friendly off-whites; never pure white.
  fg: {
    primary: "#e6edf3",
    secondary: "#9aa6b2",
    muted: "#6b7480",
    inverse: "#0a0e15",
  },

  // Hairline borders; gradient borders are composed from these.
  border: {
    hairline: "rgba(255,255,255,0.06)",
    subtle: "rgba(255,255,255,0.10)",
    strong: "rgba(255,255,255,0.18)",
    glow: "rgba(140,170,255,0.35)",
  },

  // Brand accents — kept minimal. Gradient stops compose from these.
  accent: {
    cyan: "#5cc7ff",
    indigo: "#7c8cff",
    violet: "#a07bff",
    teal: "#3fd8c5",
  },

  // Signed-value semantics. Distinct from error/warn so we never collide
  // red-as-short with red-as-error on the same screen. CVD-friendly:
  // green leans yellow-green (#27d97a), red leans magenta (#ff4d6d).
  signed: {
    longStrong: "#27d97a",
    longSoft: "rgba(39,217,122,0.18)",
    shortStrong: "#ff4d6d",
    shortSoft: "rgba(255,77,109,0.18)",
    flat: "#7a8696",
  },

  // System feedback (status only, never overload onto signed values).
  status: {
    info: "#5cc7ff",
    success: "#3fd8c5",
    warn: "#ffb454",
    error: "#ff7a90",
  },

  // Domain accents — used sparingly to mark special UI state.
  domain: {
    callWall: "#5cc7ff",
    putWall: "#ff85a1",
    maxPain: "#ffd166",
    zeroGamma: "#a07bff",
    spot: "#e6edf3",
    futures: "#9aa6b2",
  },
} as const;

/**
 * Depth scale — the number of "layers" a surface is lifted off the
 * abyss background. Maps to box-shadow + border-glow + (optional)
 * backdrop-filter blur radius.
 */
export const depth = {
  flat: 0,
  resting: 1,
  raised: 2,
  floating: 3,
  overlay: 4,
} as const;

export const shadows = {
  resting: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 4px 12px -8px rgba(0,0,0,0.6)",
  raised:
    "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 8px 24px -12px rgba(0,0,0,0.7), 0 2px 6px -2px rgba(0,0,0,0.5)",
  floating:
    "0 1px 0 0 rgba(255,255,255,0.07) inset, 0 16px 40px -16px rgba(0,0,0,0.75), 0 4px 12px -4px rgba(0,0,0,0.5)",
  overlay:
    "0 1px 0 0 rgba(255,255,255,0.08) inset, 0 32px 60px -24px rgba(0,0,0,0.8), 0 8px 20px -6px rgba(0,0,0,0.55)",
} as const;

export const radii = {
  none: "0px",
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  pill: "9999px",
} as const;

/**
 * Motion. Keep it tight — traders dislike floaty UI.
 * State transitions <= 200ms, entrances <= 600ms, motion respects
 * prefers-reduced-motion (handled in shared/ui MotionProvider).
 */
export const motion = {
  duration: {
    instant: 80,
    fast: 140,
    base: 200,
    medium: 320,
    slow: 600,
  },
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    decel: [0, 0, 0.2, 1] as const,
    accel: [0.4, 0, 1, 1] as const,
    spring: [0.34, 1.56, 0.64, 1] as const,
  },
} as const;

export const typography = {
  // Inter for UI, JetBrains Mono for numbers and code. Both expose
  // tnum/lnum OpenType features.
  fontFamily: {
    sans: '"Inter", "Inter Tight", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
    numeric: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  // Tabular numerals are MANDATORY in any column of numbers. Add this
  // to the parent surface, do not sprinkle it on individual <span>s.
  featureSettings: {
    tabular: '"tnum" 1, "lnum" 1, "ss01" 1',
    proportional: '"pnum" 1, "lnum" 1',
  },
  size: {
    xs: "11px",
    sm: "12px",
    md: "13px",
    base: "14px",
    lg: "16px",
    xl: "20px",
    "2xl": "24px",
    "3xl": "32px",
    "4xl": "44px",
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

/**
 * Glass surface tokens — the brand. Use sparingly; never on dense data
 * tables. See design-system/README.md for the full restraint policy.
 */
export const glass = {
  blur: {
    sm: "6px",
    md: "14px",
    lg: "24px",
    xl: "40px",
  },
  saturation: {
    sm: 1.1,
    md: 1.4,
    lg: 1.6,
  },
  tint: {
    cool: "rgba(140,170,255,0.04)",
    warm: "rgba(255,200,140,0.04)",
    neutral: "rgba(255,255,255,0.03)",
  },
} as const;

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  overlay: 800,
  modal: 900,
  toast: 1000,
  tooltip: 1100,
} as const;

export type DesignTokens = {
  colors: typeof colors;
  depth: typeof depth;
  shadows: typeof shadows;
  radii: typeof radii;
  motion: typeof motion;
  typography: typeof typography;
  glass: typeof glass;
  zIndex: typeof zIndex;
};

export const tokens: DesignTokens = {
  colors,
  depth,
  shadows,
  radii,
  motion,
  typography,
  glass,
  zIndex,
};
