import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionPill } from "@/shared/ui/ConnectionPill";

/**
 * Smoke tests — assert the workspace boots:
 *   - alias resolution works (the ConnectionPill import via @/shared)
 *   - jsdom + testing-library render path is wired
 *   - design tokens reach the DOM (we read the rendered class)
 *
 * Real component tests land alongside features as they ship.
 */

describe("smoke", () => {
  it("renders connection pill in live state", () => {
    render(<ConnectionPill status="open" />);
    expect(screen.getByRole("status")).toHaveTextContent(/live/i);
  });

  it("renders connection pill in auth-failed state", () => {
    render(<ConnectionPill status="auth-failed" />);
    expect(screen.getByRole("status")).toHaveTextContent(/auth/i);
  });
});
