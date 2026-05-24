import { test, expect } from "@playwright/test";

/**
 * Smoke E2E — boots the SPA and asserts the shell paints. Real flows
 * (auth, dashboard, WS reconnect) land alongside their features.
 */
test("dashboard shell paints", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/FlowGreeks/i)).toBeVisible();
});
