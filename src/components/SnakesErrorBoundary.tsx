import { Component, type ReactNode } from 'react';
import styles from './SnakesGame.module.css';

interface Props {
  children: ReactNode;
  onReset: () => void;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class SnakesErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'An unexpected error occurred' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[SnakesErrorBoundary]', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.lobby}>
          <span className={styles.errorText} style={{ fontSize: '1.6rem' }}>
            Something went wrong
          </span>
          <p style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            maxWidth: 320,
            textAlign: 'center',
            lineHeight: 1.5,
            margin: 0,
          }}>
            {this.state.errorMessage}
          </p>
          <button className={styles.createBtn} onClick={this.handleReset}>
            Return to lobby
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
