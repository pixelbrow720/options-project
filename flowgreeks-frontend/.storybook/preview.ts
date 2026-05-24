import type { Preview } from "@storybook/react";
import "../src/styles.css";

/**
 * Storybook preview — applies the dark + compact body class so every
 * story matches production chrome. Stories that need light theme can
 * override via the parameters block.
 */
const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "abyss",
      values: [
        { name: "abyss", value: "#05070b" },
        { name: "base", value: "#0a0e15" },
        { name: "raised", value: "#0f141d" },
        { name: "light", value: "#f5f7fa" },
      ],
    },
    options: {
      storySort: {
        order: ["design-system", "ui", "three", "features"],
      },
    },
  },
  decorators: [
    (Story) => {
      if (typeof document !== "undefined") {
        document.documentElement.classList.add("dark", "density-compact");
        document.documentElement.classList.remove("light", "density-comfortable");
      }
      return Story();
    },
  ],
};

export default preview;
