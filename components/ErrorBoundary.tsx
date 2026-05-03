import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  declare public props: Props;
  public state: State;
  declare public setState: (state: State) => void;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorData: any = null;
      try {
        errorData = JSON.parse(this.state.error?.message || '{}');
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-red-500/50 rounded-2xl p-6 max-w-2xl w-full shadow-2xl">
            <h2 className="text-2xl font-bold text-red-400 mb-4">Something went wrong</h2>
            
            {errorData && errorData.error ? (
              <div className="space-y-4 text-slate-300">
                <p className="font-semibold text-white">Firestore Error:</p>
                <div className="bg-slate-900 p-4 rounded-lg font-mono text-sm overflow-x-auto">
                  <p><span className="text-blue-400">Operation:</span> {errorData.operationType}</p>
                  <p><span className="text-blue-400">Path:</span> {errorData.path}</p>
                  <p className="text-red-400 mt-2">{errorData.error}</p>
                </div>
                <p className="text-sm text-slate-400 mt-4">
                  This is likely due to missing or insufficient permissions in your Firestore Security Rules.
                </p>
              </div>
            ) : (
              <p className="text-slate-300">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            )}
            
            <button
              className="mt-6 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
