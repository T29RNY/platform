import React from "react";

// Per-panel error boundary (HANDOVER §13): one malformed panel must never
// blank the whole wall. Renders an empty shell in place of the crash.
export default class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.error(`[display] panel "${this.props.name}" crashed`, err);
  }
  componentDidUpdate(prevProps) {
    // a fresh payload is a fresh chance — retry the panel on next data
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }
  render() {
    if (this.state.failed) {
      return this.props.fallback ?? <div className="panel" />;
    }
    return this.props.children;
  }
}
