import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
            <h1 className="text-xl font-semibold">Something went wrong.</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message ?? "Unknown error"}
            </p>
            <button
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
