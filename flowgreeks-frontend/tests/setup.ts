import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Vitest setup — runs before every test file.
 *
 * Notes:
 * - jsdom does not implement matchMedia or IntersectionObserver; we
 *   stub them so theme/density and virtualized list code under test
 *   don't blow up.
 * - Vitest 2's `globals: true` is enabled, so `expect`/`it`/etc. are
 *   ambient. No explicit imports needed in test files.
 * - WebSocket is intentionally NOT polyfilled — tests that exercise
 *   the WSClient mount their own mock server (see ws-mock.ts when it
 *   lands).
 */

afterEach(() => {
  cleanup();
});

// matchMedia stub — covers prefers-reduced-motion / prefers-color-scheme.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// IntersectionObserver stub — needed by any virtualized list under test.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class MockIntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn().mockReturnValue([]);
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: MockIntersectionObserver,
  });
}

// ResizeObserver stub.
if (typeof globalThis.ResizeObserver === "undefined") {
  class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: MockResizeObserver,
  });
}

// HTMLDialogElement.showModal / close — jsdom doesn't implement them.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

// Default env var stubs so client.ts doesn't throw on import.
if (typeof import.meta.env !== "undefined") {
  if (!import.meta.env.VITE_API_BASE_URL) {
    (import.meta.env as Record<string, string>).VITE_API_BASE_URL = "http://127.0.0.1:8000";
  }
  if (!import.meta.env.VITE_WS_BASE_URL) {
    (import.meta.env as Record<string, string>).VITE_WS_BASE_URL = "ws://127.0.0.1:8000";
  }
}
