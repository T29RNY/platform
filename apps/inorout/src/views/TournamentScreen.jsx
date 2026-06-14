import React from "react";

// Public tournament page stub.
// Phase 1: placeholder only — no public RPC exists yet.
// Phase 2 will add get_tournament_public(slug) and wire live data here.

export default function TournamentScreen({ slug }) {
  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg, #0A0A08)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
    }}>
      <div style={{
        maxWidth: 420, width: "100%",
        background: "var(--b2, rgba(255,255,255,0.04))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
        borderRadius: 16, padding: "32px 28px",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{
          fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)",
          fontSize: 32, lineHeight: 1,
          color: "var(--t1, #fff)",
        }}>
          Tournament
        </div>

        <div style={{ fontSize: 13, color: "var(--t2, rgba(255,255,255,0.5))" }}>
          <code style={{ fontSize: 12, background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 4 }}>
            {slug}
          </code>
        </div>

        <div style={{
          padding: "16px",
          background: "rgba(255,190,60,0.08)",
          border: "1px solid rgba(255,190,60,0.2)",
          borderRadius: 10,
          fontSize: 14,
          color: "var(--t1, #fff)",
          lineHeight: 1.5,
        }}>
          Tournament registration and live results coming soon.
        </div>

        <a
          href="/"
          style={{
            fontSize: 13, color: "var(--t2, rgba(255,255,255,0.5))",
            textDecoration: "none", textAlign: "center", marginTop: 4,
          }}
        >
          ← Back to home
        </a>
      </div>
    </div>
  );
}
