import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import glsl from "vite-plugin-glsl";
import path from "node:path";

/**
 * FlowGreeks frontend bundler config.
 *
 * Notes:
 * - Three.js + R3F is code-split via manualChunks. The first paint
 *   (login + dashboard chrome) must not pull three.js into the entry
 *   bundle — see performance budget in CLAUDE.md.
 * - GLSL shader files in src/shared/three/shaders/*.glsl are imported
 *   as strings via vite-plugin-glsl.
 * - Env vars are accessed via import.meta.env.VITE_*; nothing else is
 *   exposed to the client. Backend secrets stay backend-side.
 */
export default defineConfig({
  envPrefix: "VITE_",
  plugins: [react(), tailwindcss(), glsl({ compress: false, watch: true })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@/app": path.resolve(__dirname, "src/app"),
      "@/features": path.resolve(__dirname, "src/features"),
      "@/shared": path.resolve(__dirname, "src/shared"),
      "@/design-system": path.resolve(__dirname, "src/design-system"),
      "@/contracts": path.resolve(__dirname, "src/contracts"),
      "@/pages": path.resolve(__dirname, "src/pages"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: "127.0.0.1",
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("three") || id.includes("@react-three")) return "three";
            if (id.includes("react-router") || id.includes("react-dom") || id.includes("react/")) return "react";
            if (id.includes("@tanstack")) return "query";
            if (id.includes("framer-motion")) return "motion";
            if (id.includes("uplot")) return "uplot";
            if (id.includes("zustand")) return "zustand";
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    css: true,
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.stories.tsx", "**/*.config.*", "src/contracts/**"],
    },
  },
});
