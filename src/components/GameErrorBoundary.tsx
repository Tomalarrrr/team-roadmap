import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClose: () => void;
  gameName: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class GameErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'An unexpected error occurred' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.gameName}ErrorBoundary]`, error, info.componentStack);
  }

  private handleClose = () => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onClose();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          minHeight: 200,
        }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 600 }}>
            Something went wrong
          </span>
          <p style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted, #888)',
            maxWidth: 320,
            textAlign: 'center',
            lineHeight: 1.5,
            margin: 0,
          }}>
            {this.state.errorMessage}
          </p>
          <button
            onClick={this.handleClose}
            style={{
              padding: '0.5rem 1.5rem',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent, #4a90d9)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Close {this.props.gameName}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
