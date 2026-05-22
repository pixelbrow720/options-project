/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(222 47% 7%)",
        foreground: "hsl(210 40% 98%)",
        muted: "hsl(217 33% 17%)",
        "muted-foreground": "hsl(215 20% 65%)",
        border: "hsl(215 28% 17%)",
        primary: "hsl(217 91% 60%)",
        "primary-foreground": "hsl(0 0% 100%)",
        accent: "hsl(217 33% 17%)",
        "accent-foreground": "hsl(210 40% 98%)",
        destructive: "hsl(0 70% 45%)",
        "destructive-foreground": "hsl(0 0% 100%)",
        // Foundation design tokens (shared design language)
        "bg-base": "hsl(var(--bg-base) / <alpha-value>)",
        "bg-elevated": "hsl(var(--bg-elevated) / <alpha-value>)",
        "bg-card": "hsl(var(--bg-card) / <alpha-value>)",
        "fg-primary": "hsl(var(--fg-primary) / <alpha-value>)",
        "fg-muted": "hsl(var(--fg-muted) / <alpha-value>)",
        "fg-faint": "hsl(var(--fg-faint) / <alpha-value>)",
        positive: "hsl(var(--positive) / <alpha-value>)",
        negative: "hsl(var(--negative) / <alpha-value>)",
        flip: "hsl(var(--flip) / <alpha-value>)",
        "brand-primary": "hsl(var(--brand-primary) / <alpha-value>)",
        "brand-secondary": "hsl(var(--brand-secondary) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Geist",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
        display: [
          "Geist",
          "Inter Tight",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        "metric-sm": ["1rem", { lineHeight: "1.25", fontFeatureSettings: '"tnum"' }],
        "metric-md": ["1.5rem", { lineHeight: "1.2", fontFeatureSettings: '"tnum"' }],
        "metric-lg": ["2.25rem", { lineHeight: "1.1", fontFeatureSettings: '"tnum"' }],
        "metric-xl": ["3.5rem", { lineHeight: "1", fontFeatureSettings: '"tnum"' }],
      },
      boxShadow: {
        "glow-brand": "0 0 32px -8px hsl(var(--brand-primary) / 0.4)",
        "glow-positive": "0 0 24px -6px hsl(var(--positive) / 0.35)",
        "glow-negative": "0 0 24px -6px hsl(var(--negative) / 0.35)",
        card: "0 1px 3px rgb(0 0 0 / 0.5), 0 0 0 1px hsl(var(--border-token) / 0.5)",
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(135deg, hsl(var(--brand-primary)) 0%, hsl(var(--brand-secondary)) 100%)",
        "glow-radial":
          "radial-gradient(circle at 50% 50%, hsl(var(--brand-primary) / 0.15) 0%, transparent 70%)",
      },
      keyframes: {
        "flash-positive": {
          "0%": { backgroundColor: "hsl(var(--positive) / 0.2)" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-negative": {
          "0%": { backgroundColor: "hsl(var(--negative) / 0.2)" },
          "100%": { backgroundColor: "transparent" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "flash-positive": "flash-positive 600ms ease-out",
        "flash-negative": "flash-negative 600ms ease-out",
        "pulse-soft": "pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
