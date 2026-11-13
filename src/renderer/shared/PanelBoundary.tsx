import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from './log';

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Contains a crash to one panel. The rest of the app keeps working and the panel can be retried. */
export class PanelBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error(`Panel "${this.props.name}" crashed`, {
      message: error.message,
      stack: error.stack,
      component: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel-crash" role="alert">
        <strong>The {this.props.name} panel hit a problem.</strong>
        <p>Your deck is safe and the rest of the app still works. The details are in the log.</p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
