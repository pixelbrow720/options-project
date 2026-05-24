import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config (placeholder). E2E suites land alongside features.
 *
 * Strategy:
 *   - Run against `pnpm preview` (the production build), not the dev
 *     server. dev-mode HMR injects timing artefacts that flake every
 *     visual diff.
 *   - Single browser project for CI baseline (Chromium); add Firefox /
 *     WebKit when we hit a browser-specific bug worth gating on.
 *   - WebSocket tests use the engine's `samples/snapshot-spxw-friday.json`
 *     fixture as a stub; no live backend required.
 */

const PORT = 4173;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm preview",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 30_000,
  },
});
