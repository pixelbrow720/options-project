import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
    host: true,
  },
  build: {
    target: "es2020",
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Split heavy vendor packages so the dashboard's recharts /
        // framer-motion bundles can be cached independently of the rest of
        // the app. Order matters: more specific tests first.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("victory-vendor") || id.includes("d3-")) {
            return "chart-vendor";
          }
          if (id.includes("framer-motion") || id.includes("motion-utils") || id.includes("motion-dom")) {
            return "motion-vendor";
          }
          if (id.includes("@radix-ui")) {
            return "radix-vendor";
          }
          if (id.includes("lucide-react")) {
            return "icons-vendor";
          }
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            id.includes("scheduler") ||
            id.includes("react/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
});
