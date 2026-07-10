// ErrorBoundary.jsx — contains a render-time throw in any /hub screen so it shows a
// fallback card instead of unmounting the whole React root (which, in the Capacitor
// WKWebView, presents as "the app blanked and reloaded"). Added after the GuardianSchedule
// infinite-render-loop crash — a stray unstable useCallback dep looped setState until React
// threw "maximum update depth exceeded", and with no boundary the entire native app died.
// React error boundaries MUST be class components (no hook equivalent).
import { Component } from "react";
import MIcon from "./icons.jsx";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // Leave a trace via console.error (the hygiene-approved logger) so the crash is
    // diagnosable from device logs instead of a silent white screen.
    console.error("[hub] screen render error", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Recover when the user navigates: a new resetKey (tab / child / sub-view) clears the
    // failed state so the next screen renders fresh instead of staying on the fallback.
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="m-card" style={{ marginTop: 24, padding: "20px 18px", textAlign: "center" }}>
        <div style={{
          width: 46, height: 46, borderRadius: 14, margin: "0 auto 12px", background: "var(--amber-soft)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <MIcon name="alert" size={22} color="var(--amber)" />
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--ink)" }}>This screen hit a snag</div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 6, lineHeight: 1.5 }}>
          Something went wrong loading this view. Your data is safe — try again, or switch tabs.
        </div>
        <button
          onClick={() => this.setState({ failed: false })}
          style={{
            marginTop: 16, padding: "10px 18px", borderRadius: "var(--r-pill)", cursor: "pointer",
            background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
            fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
          }}>
          Try again
        </button>
      </div>
    );
  }
}
