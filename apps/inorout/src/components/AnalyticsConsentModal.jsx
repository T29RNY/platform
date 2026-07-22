// AnalyticsConsentModal — the first-run opt-IN ask for product analytics.
//
// Shown once, when no decision has been recorded. Nothing is sent to our
// analytics processor until the person taps "Yes, that's fine" here (PostHog is
// configured opt_out_capturing_by_default). Styling mirrors PushOptInModal so it
// feels native to the app; kept intentionally light-touch and honest rather than
// a dark-pattern cookie wall — the decline option is a peer, not hidden.

import { ChartLineUp } from "@phosphor-icons/react";

export default function AnalyticsConsentModal({ open, onAllow, onDecline }) {
  if (!open) return null;

  const heading = {
    textAlign: "center", fontFamily: "var(--font-heading)", fontSize: 24,
    fontWeight: 400, letterSpacing: "0.5px", color: "var(--t1)",
    textTransform: "uppercase", lineHeight: 1.15, marginBottom: 10,
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1350, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--s1)", borderRadius: "var(--rs)", maxWidth: 340, width: "100%",
        padding: "24px 22px", border: "0.5px solid var(--border-subtle)",
        boxShadow: "0 10px 44px rgba(0,0,0,0.45)" }}>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%",
            background: "color-mix(in srgb, var(--gold) 16%, var(--s2))",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChartLineUp size={27} weight="thin" color="var(--gold)" />
          </div>
        </div>

        <div style={heading}>Help us improve the app?</div>
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300,
          lineHeight: 1.5, marginBottom: 6, fontFamily: "var(--font-body)" }}>
          We'd like to use privacy-first analytics to see how the app is used and make it better:
        </div>
        <ul style={{ margin: "0 0 16px", padding: "0 0 0 2px", listStyle: "none",
          display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "Which screens people use, and where they get stuck",
            "Hosted in the EU — never sold, never used for ads",
            "No personal details are ever sent",
          ].map((line, i) => (
            <li key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start",
              fontSize: 13, color: "var(--t1)", fontWeight: 300, lineHeight: 1.45,
              fontFamily: "var(--font-body)" }}>
              <span style={{ color: "var(--gold)", flexShrink: 0 }}>•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div style={{ fontSize: 11.5, color: "var(--t2)", fontWeight: 300,
          lineHeight: 1.45, marginBottom: 20, fontFamily: "var(--font-body)", opacity: 0.85 }}>
          You can change your mind any time on the Privacy page. Either choice keeps the app working exactly the same.
        </div>

        <button onClick={() => onAllow?.()} style={{
          width: "100%", background: "var(--gold)", color: "var(--bg)", border: "none",
          borderRadius: "var(--r-button)", padding: "13px", fontSize: 15, fontWeight: 600,
          fontFamily: "var(--font-body)", cursor: "pointer", marginBottom: 8 }}>
          Yes, that's fine
        </button>
        <button onClick={() => onDecline?.()} style={{
          width: "100%", background: "none", color: "var(--t2)", border: "none",
          padding: "11px", fontSize: 14, fontWeight: 400, fontFamily: "var(--font-body)",
          cursor: "pointer" }}>
          No thanks
        </button>
      </div>
    </div>
  );
}
