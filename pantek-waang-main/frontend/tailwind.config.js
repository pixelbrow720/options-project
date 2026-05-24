/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Legacy shadcn-style aliases (kept for incremental migration)
        background: "hsl(var(--bg-base) / <alpha-value>)",
        foreground: "hsl(var(--fg-primary) / <alpha-value>)",
        muted: "hsl(var(--bg-card) / <alpha-value>)",
        "muted-foreground": "hsl(var(--fg-muted) / <alpha-value>)",
        border: "hsl(var(--border-subtle) / <alpha-value>)",
        primary: "hsl(var(--accent-strong) / <alpha-value>)",
        "primary-foreground": "hsl(213 15% 98% / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        "accent-foreground": "hsl(213 15% 98% / <alpha-value>)",
        destructive: "hsl(var(--negative) / <alpha-value>)",
        "destructive-foreground": "hsl(0 0% 100%)",

        // Surface ladder
        "bg-base": "hsl(var(--bg-base) / <alpha-value>)",
        "bg-elevated": "hsl(var(--bg-elevated) / <alpha-value>)",
        "bg-card": "hsl(var(--bg-card) / <alpha-value>)",
        "bg-card-hover": "hsl(var(--bg-card-hover) / <alpha-value>)",
        "bg-popover": "hsl(var(--bg-popover) / <alpha-value>)",
        "bg-input": "hsl(var(--bg-input) / <alpha-value>)",

        // Border ladder
        "border-subtle": "hsl(var(--border-subtle) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
        "border-hover": "hsl(var(--border-hover) / <alpha-value>)",
        "border-focus": "hsl(var(--border-focus) / <alpha-value>)",

        // Foreground
        "fg-primary": "hsl(var(--fg-primary) / <alpha-value>)",
        "fg-secondary": "hsl(var(--fg-secondary) / <alpha-value>)",
        "fg-muted": "hsl(var(--fg-muted) / <alpha-value>)",
        "fg-faint": "hsl(var(--fg-faint) / <alpha-value>)",

        // Semantic
        positive: "hsl(var(--positive) / <alpha-value>)",
        "positive-soft": "hsl(var(--positive-soft) / <alpha-value>)",
        negative: "hsl(var(--negative) / <alpha-value>)",
        "negative-soft": "hsl(var(--negative-soft) / <alpha-value>)",
        flip: "hsl(var(--flip) / <alpha-value>)",
        "flip-soft": "hsl(var(--flip-soft) / <alpha-value>)",
        neutral: "hsl(var(--neutral) / <alpha-value>)",

        // Brand
        "brand-primary": "hsl(var(--brand-primary) / <alpha-value>)",
        "brand-secondary": "hsl(var(--brand-secondary) / <alpha-value>)",
        "accent-strong": "hsl(var(--accent-strong) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Geist", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "JetBrains Mono", "ui-monospace", "monospace"],
        display: ["Geist", "Inter Tight", "ui-sans-serif", "sans-serif"],
      },
      fontSize: {
        "metric-xs": ["0.875rem", { lineHeight: "1.25", fontFeatureSettings: '"tnum"' }],
        "metric-sm": ["1rem", { lineHeight: "1.25", fontFeatureSettings: '"tnum"' }],
        "metric-md": ["1.5rem", { lineHeight: "1.2", fontFeatureSettings: '"tnum"' }],
        "metric-lg": ["2rem", { lineHeight: "1.1", fontFeatureSettings: '"tnum"' }],
        "metric-xl": ["2.75rem", { lineHeight: "1", fontFeatureSettings: '"tnum"', letterSpacing: "-0.02em" }],
        "metric-2xl": ["3.5rem", { lineHeight: "1", fontFeatureSettings: '"tnum"', letterSpacing: "-0.025em" }],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        popover: "var(--shadow-popover)",
        "glow-positive": "var(--shadow-glow-positive)",
        "glow-negative": "var(--shadow-glow-negative)",
        "glow-accent": "var(--shadow-glow-accent)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.22, 1, 0.36, 1)",
        snap: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      backgroundImage: {
        "accent-gradient":
          "linear-gradient(135deg, hsl(var(--accent)) 0%, hsl(var(--brand-secondary)) 100%)",
        "card-sheen":
          "radial-gradient(ellipse 80% 50% at 50% 0%, hsl(var(--accent) / 0.06), transparent 60%)",
        "gex-gradient":
          "linear-gradient(180deg, hsl(var(--positive) / 0.06) 0%, transparent 60%)",
      },
      keyframes: {
        "flash-positive": {
          "0%": { backgroundColor: "hsl(var(--positive) / 0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-negative": {
          "0%": { backgroundColor: "hsl(var(--negative) / 0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translate3d(0,6px,0)" },
          to: { opacity: "1", transform: "translate3d(0,0,0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "flash-positive": "flash-positive 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        "flash-negative": "flash-negative 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        "fade-in-up": "fade-in-up 200ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
