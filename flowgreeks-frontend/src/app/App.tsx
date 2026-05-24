import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useMemo } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppErrorBoundary } from "@/app/ErrorBoundary";
import { AppRoutes } from "@/routes";

const enableDevtools = import.meta.env.VITE_ENABLE_QUERY_DEVTOOLS === "true";

// Lazy-load devtools so the prod bundle tree-shakes them out entirely
// when VITE_ENABLE_QUERY_DEVTOOLS !== "true". The dynamic import is
// the only reference; no top-level import keeps the dep dev-only.
const Devtools = enableDevtools
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

/**
 * Root composition. Order matters:
 *   ErrorBoundary > QueryClientProvider > Router > Routes
 *
 * Query is above the router so a route swap doesn't reset the cache,
 * and the error boundary is at the top so a thrown render error inside
 * the cache provider can still reach the global fallback UI.
 */
export function App() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Snapshot endpoints are computed every 60s; we don't want
            // four panes hammering the same key. WS frames invalidate
            // on tick, so this acts as a polling backstop, not the
            // primary update channel.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (failureCount, error) => {
              // Auth failures aren't retryable; let the UI surface them.
              if (
                error instanceof Error &&
                /401|403|4401/.test(error.message)
              ) {
                return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: 0,
          },
        },
      }),
    [],
  );

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        {Devtools ? (
          <Suspense fallback={null}>
            <Devtools initialIsOpen={false} buttonPosition="bottom-right" />
          </Suspense>
        ) : null}
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
