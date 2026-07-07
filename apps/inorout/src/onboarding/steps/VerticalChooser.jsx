import { useState } from "react";
import { CaretRight, CaretLeft } from "@phosphor-icons/react";
import { VERTICALS } from "../verticalRegistry.js";

// subStep-0 of /create: "What do you want to set up?" — the front door that reveals
// In or Out is a platform, not just a squad tool. Renders one card per vertical from
// the config-driven registry. A 'live' card routes into its create flow (PR1: only
// Casual); a 'soon' card opens an honest hand-off panel — never a dead end.
// Self-contained (no WizardShell → no ProgressBar/Continue): the card IS the action.

function ChooserCard({ v, onClick }) {
  const { Icon, label, sublabel, surface } = v;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%",
        textAlign: "left", cursor: "pointer",
        background: "var(--s2)", border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r)", padding: "16px 16px", color: "var(--t1)",
      }}
    >
      <Icon size={26} weight="thin" color="var(--gold)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 19, letterSpacing: 0.4 }}>
          {label}
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
          {sublabel}
        </div>
      </div>
      {surface === "computer" && (
        <span
          style={{
            fontFamily: "var(--font-body)", fontSize: 9.5, letterSpacing: 0.8,
            textTransform: "uppercase", color: "var(--t2)", whiteSpace: "nowrap",
            border: "1px solid var(--border-subtle)", borderRadius: "var(--r-pill)",
            padding: "3px 8px",
          }}
        >
          On computer
        </span>
      )}
      <CaretRight size={18} weight="thin" color="var(--t2)" />
    </button>
  );
}

export default function VerticalChooser({ onPick, cancelTo }) {
  const [soon, setSoon] = useState(null); // the vertical whose hand-off panel is open

  const pageStyle = { padding: "calc(28px + env(safe-area-inset-top)) 20px calc(40px + env(safe-area-inset-bottom))", minHeight: "100dvh" };

  // ── "Coming soon" hand-off panel ─────────────────────────────────────────
  if (soon) {
    const { Icon, label, surface } = soon;
    const body = surface === "computer"
      ? `Setting up a ${label.toLowerCase()} works best on a bigger screen. We're building self-serve sign-up for it now — check back soon. For now, tap back to set up a casual squad instead.`
      : `You'll be able to set this up right here in the app very soon. For now, tap back to set up a casual squad instead.`;
    return (
      <div style={pageStyle}>
        <button
          type="button"
          onClick={() => setSoon(null)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "none",
            border: "none", color: "var(--t2)", fontFamily: "var(--font-body)",
            fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 28,
          }}
        >
          <CaretLeft size={16} weight="thin" /> Back
        </button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16, marginTop: 24 }}>
          <Icon size={48} weight="thin" color="var(--gold)" />
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 30, letterSpacing: 0.6, margin: 0 }}>
            {label}
          </h2>
          <div
            style={{
              fontFamily: "var(--font-body)", fontSize: 9.5, letterSpacing: 1,
              textTransform: "uppercase", color: "var(--gold)",
              border: "1px solid var(--goldb)", borderRadius: "var(--r-pill)",
              padding: "4px 12px",
            }}
          >
            Coming soon
          </div>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.5, color: "var(--t2)", maxWidth: 320, margin: "4px 0 0" }}>
            {body}
          </p>
        </div>
      </div>
    );
  }

  // ── The chooser ──────────────────────────────────────────────────────────
  return (
    <div style={pageStyle}>
      {cancelTo && (
        <button
          type="button"
          onClick={() => { window.location.href = cancelTo; }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "none",
            border: "none", color: "var(--t2)", fontFamily: "var(--font-body)",
            fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 24,
          }}
        >
          <CaretLeft size={16} weight="thin" /> Cancel
        </button>
      )}
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, letterSpacing: 0.6, margin: "0 0 6px" }}>
        What do you want to set up?
      </h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--t2)", margin: "0 0 24px" }}>
        Pick one to get started. You can always set up more later.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {VERTICALS.map((v) => (
          <ChooserCard
            key={v.key}
            v={v}
            onClick={() => (v.status === "live" ? onPick(v.key) : setSoon(v))}
          />
        ))}
      </div>
    </div>
  );
}
