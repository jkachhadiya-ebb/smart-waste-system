import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('App render error', error, info);
  }

  handleReload() {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '32px', fontFamily: 'system-ui, sans-serif' }}>
          <h1>Something went wrong.</h1>
          <p>The page failed to render. Try reloading.</p>
          <button type="button" onClick={this.handleReload}>
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
