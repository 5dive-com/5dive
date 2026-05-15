import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="text-[0.9375rem] font-medium text-ink">Something went wrong</p>
          <p className="max-w-sm text-[0.8125rem] text-ink-secondary">
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded-lg border border-border-subtle px-3.5 py-2 text-[0.8125rem] text-ink-secondary hover:bg-surface-raised"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
