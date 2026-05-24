import type { Config } from "tailwindcss";

/**
 * Tailwind v4 keeps its primary configuration in CSS (@theme blocks in
 * src/styles.css and src/design-system/theme.css). This file exists to
 * satisfy editor tooling and to lock a couple of options that are not
 * expressible in CSS yet (content scan paths for legacy plugins, dark
 * mode strategy).
 */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./.storybook/**/*.{ts,tsx}",
  ],
  future: {
    hoverOnlyWhenSupported: true,
  },
  // All theme extensions live in CSS @theme blocks under src/design-system.
} satisfies Config;
