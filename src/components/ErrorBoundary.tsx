import { Component, ReactNode } from "react";

type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div className="min-h-screen bg-background p-6 flex items-start justify-center">
          <div className="max-w-2xl w-full as-card p-5">
            <div className="text-rose-300 text-xs uppercase tracking-wider font-bold mb-2">Render crashed</div>
            <div className="text-white text-sm font-medium mb-3">{err.message || "Unknown error"}</div>
            <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap bg-white/[0.02] p-3 rounded border border-white/[0.06] overflow-x-auto max-h-[400px]">
              {err.stack || String(err)}
            </pre>
            <button
              type="button"
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="mt-4 px-3 py-2 text-xs rounded bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
