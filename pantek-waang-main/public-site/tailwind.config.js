/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.25rem",
      screens: {
        "2xl": "1440px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Semantic data-viz tokens
        emerald: {
          DEFAULT: "hsl(var(--emerald))",
          foreground: "hsl(var(--emerald-foreground))",
        },
        rose: {
          DEFAULT: "hsl(var(--rose))",
          foreground: "hsl(var(--rose-foreground))",
        },
        amber: {
          DEFAULT: "hsl(var(--amber))",
          foreground: "hsl(var(--amber-foreground))",
        },
        violet: {
          DEFAULT: "hsl(var(--violet))",
          foreground: "hsl(var(--violet-foreground))",
        },
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
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
        display: [
          "Geist",
          "Inter Tight",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
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
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "gradient-shift": {
          "0%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
        "marquee": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        "border-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "flash-positive": {
          "0%": { backgroundColor: "hsl(var(--positive) / 0.2)" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-negative": {
          "0%": { backgroundColor: "hsl(var(--negative) / 0.2)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "gradient-shift": "gradient-shift 8s linear infinite",
        "marquee": "marquee 38s linear infinite",
        "border-spin": "border-spin 6s linear infinite",
        "flash-positive": "flash-positive 600ms ease-out",
        "flash-negative": "flash-negative 600ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
