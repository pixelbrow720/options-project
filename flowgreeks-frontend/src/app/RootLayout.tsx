import { Outlet } from "react-router-dom";
import { ThemeProvider } from "@/app/ThemeProvider";

/**
 * Root layout shell. Houses the persistent header + side rail and a
 * route outlet. Concrete chrome components are added in feature work;
 * this version is structure-only so the workspace boots.
 */
export function RootLayout() {
  return (
    <ThemeProvider>
      <div className="grid min-h-dvh grid-cols-[64px_minmax(0,1fr)] grid-rows-[56px_minmax(0,1fr)]">
        <header
          className="glass glass-border col-span-2 flex items-center px-4"
          style={{ borderRadius: 0 }}
        >
          <div className="font-semibold tracking-tight">FlowGreeks</div>
          <div
            className="ml-3 text-xs"
            style={{ color: "var(--color-fg-muted)" }}
          >
            options-flow intelligence
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* connection pill, symbol picker, density toggle, command-k slot */}
          </div>
        </header>

        <nav
          aria-label="primary"
          className="border-r"
          style={{
            borderColor: "var(--color-border-hairline)",
            background: "var(--color-bg-base)",
          }}
        >
          {/* feature nav — populated by features/* */}
        </nav>

        <main className="overflow-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </ThemeProvider>
  );
}
