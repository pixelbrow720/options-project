import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

interface Props {
  children: ReactNode;
  /** Optional fallback override; defaults to the built-in panel. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

/**
 * Top-level error boundary. Lives above QueryClientProvider so that a
 * thrown error in any descendant lands here.
 *
 * Routes mount their own `RouteErrorBoundary` (added when needed) so a
 * busted route doesn't blank the entire app — but anything above the
 * router (provider crash, Suspense throw outside a boundary) lands on
 * this fallback.
 *
 * Keep this component tiny and dependency-free — if it throws, there is
 * no recovery surface left.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Send to telemetry sink. We do not have one wired yet; keep this
    // minimal so no PII or token strings leak into a console transcript.
    // Sentry/OTel hookup goes here.
    console.error("[boundary]", error.message, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
        }}
      >
        <div
          className="glass-raised"
          style={{
            maxWidth: 480,
            padding: "24px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>
            Something went off-script
          </h1>
          <p style={{ margin: 0, color: "var(--color-fg-secondary)" }}>
            The dashboard hit an unrecoverable error. Reload to retry; if
            this keeps happening, capture the console and ping the
            backend on-call.
          </p>
          <pre
            style={{
              margin: 0,
              padding: 12,
              fontSize: 12,
              borderRadius: 8,
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border-subtle)",
              color: "var(--color-fg-secondary)",
              whiteSpace: "pre-wrap",
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            style={{
              alignSelf: "flex-start",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg-raised)",
              color: "var(--color-fg-primary)",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
