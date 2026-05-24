import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook 8 — design system lab. Runs against the same Vite config
 * as the app so Tailwind v4, GLSL imports, and path aliases resolve
 * identically. No separate webpack pipeline.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    check: false,
    reactDocgen: "react-docgen-typescript",
  },
  docs: {
    autodocs: "tag",
  },
};

export default config;
