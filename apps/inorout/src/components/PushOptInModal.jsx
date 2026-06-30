// PushOptInModal — shared push opt-in dialog used across every user type.
//
// First shipped inline in PlayerView for casual players (PR #171); extracted here
// so managers, guardians, gym members and league players get the SAME soft ask —
// a centred dialog that explains what notifications do and offers Allow / Not now
// / Never, BEFORE the hard OS prompt. Asking in our own dialog first means the
// platform's one-shot permission prompt is never burned on someone who'd decline.
//
// Theme-parameterised via `tone`:
//   'gold'  — the casual :root theme (PlayerView, SessionsScreen)
//   'amber' — the scoped mobile /hub shell (must render INSIDE data-surface="mobile"
//             so the amber tokens resolve)
//
// Pure presentational: the parent owns the registration call, the notif state, and
// the localStorage book-keeping (subscribed / denied / never / ask-count). This
// component only renders and routes the three button taps + the backdrop dismiss.

import { Bell } from "@phosphor-icons/react";

const TONES = {
  gold: {
    accent: "var(--gold)", accentInk: "var(--bg)",
    text: "var(--t1)", textDim: "var(--t2)", green: "var(--green)",
    border: "var(--border-subtle)", radius: "var(--rs)", btnRadius: "var(--r-button)",
    iconSoftGold: "color-mix(in srgb, var(--gold) 16%, var(--s2))",
    iconSoftGreen: "color-mix(in srgb, var(--green) 18%, var(--s2))",
    headingFont: "var(--font-heading)", headingTransform: "uppercase",
    headingSize: 24, headingWeight: 400, headingSpacing: "0.5px",
    bodyFont: "var(--font-body)",
  },
  amber: {
    accent: "var(--amber)", accentInk: "var(--amber-ink)",
    text: "var(--ink)", textDim: "var(--ink2)", green: "var(--ok)",
    border: "var(--hair2)", radius: "var(--r-md)", btnRadius: "var(--r-sm)",
    iconSoftGold: "var(--amber-soft)",
    iconSoftGreen: "var(--ok-soft)",
    headingFont: "var(--m-font)", headingTransform: "none",
    headingSize: 21, headingWeight: 800, headingSpacing: "-0.01em",
    bodyFont: "var(--m-font)",
  },
};

export default function PushOptInModal({
  open,
  tone = "gold",
  // state: "idle" | "asking" | "subscribed" | "denied"
  state = "idle",
  heading = "Turn on notifications?",
  intro = "We'll only message you when it matters:",
  bullets = [],
  subscribedHeading = "You're all set",
  subscribedText = "We'll ping you the moment it matters.",
  deniedHeading = "Notifications are blocked",
  deniedText = "Turn them on in your device settings to start getting pinged.",
  onAllow,
  onNotNow,
  onNever,
  onClose,
}) {
  if (!open) return null;
  const t = TONES[tone] || TONES.gold;
  const busy = state === "asking";

  // Backdrop tap: a terminal state (denied/subscribed) just closes; an open ask
  // counts as "Not now" so the bounded re-ask logic still advances.
  const onBackdrop = () => {
    if (busy) return;
    if (state === "denied" || state === "subscribed") onClose?.();
    else onNotNow?.();
  };

  const headingStyle = {
    textAlign: "center", fontFamily: t.headingFont, fontSize: t.headingSize,
    fontWeight: t.headingWeight, letterSpacing: t.headingSpacing, color: t.text,
    textTransform: t.headingTransform, lineHeight: 1.15, marginBottom: 10,
  };

  return (
    <div onClick={onBackdrop} style={{
      position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--s1)", borderRadius: t.radius, maxWidth: 340, width: "100%",
        padding: "24px 22px", border: `0.5px solid ${t.border}`,
        boxShadow: "0 10px 44px rgba(0,0,0,0.45)" }}>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%",
            background: state === "subscribed" ? t.iconSoftGreen : t.iconSoftGold,
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Bell size={27} weight="thin" color={state === "subscribed" ? t.green : t.accent} />
          </div>
        </div>

        {state === "subscribed" ? (
          <>
            <div style={headingStyle}>{subscribedHeading}</div>
            <div style={{ textAlign: "center", fontSize: 13, color: t.textDim,
              fontWeight: 300, lineHeight: 1.5, fontFamily: t.bodyFont }}>
              {subscribedText}
            </div>
          </>
        ) : state === "denied" ? (
          <>
            <div style={headingStyle}>{deniedHeading}</div>
            <div style={{ textAlign: "center", fontSize: 13, color: t.textDim,
              fontWeight: 300, lineHeight: 1.5, marginBottom: 20, fontFamily: t.bodyFont }}>
              {deniedText}
            </div>
            <button onClick={() => onClose?.()} style={{
              width: "100%", background: "var(--s3)", color: t.text, border: "none",
              borderRadius: t.btnRadius, padding: "13px", fontSize: 14, fontWeight: 500,
              fontFamily: t.bodyFont, cursor: "pointer" }}>
              Got it
            </button>
          </>
        ) : (
          <>
            <div style={headingStyle}>{heading}</div>
            <div style={{ fontSize: 13, color: t.textDim, fontWeight: 300,
              lineHeight: 1.5, marginBottom: 6, fontFamily: t.bodyFont }}>
              {intro}
            </div>
            <ul style={{ margin: "0 0 22px", padding: "0 0 0 2px", listStyle: "none",
              display: "flex", flexDirection: "column", gap: 8 }}>
              {bullets.map((line, i) => (
                <li key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start",
                  fontSize: 13, color: t.text, fontWeight: 300, lineHeight: 1.45,
                  fontFamily: t.bodyFont }}>
                  <span style={{ color: t.accent, flexShrink: 0 }}>•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <button onClick={() => onAllow?.()} disabled={busy} style={{
              width: "100%", background: t.accent, color: t.accentInk, border: "none",
              borderRadius: t.btnRadius, padding: "13px", fontSize: 15, fontWeight: 600,
              fontFamily: t.bodyFont, cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1, marginBottom: 8 }}>
              {busy ? "Turning on…" : "Allow"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onNotNow?.()} disabled={busy} style={{
                flex: 1, background: "none", color: t.textDim, border: "none",
                padding: "11px", fontSize: 14, fontWeight: 400, fontFamily: t.bodyFont,
                cursor: busy ? "default" : "pointer" }}>
                Not now
              </button>
              <button onClick={() => onNever?.()} disabled={busy} style={{
                flex: 1, background: "none", color: t.textDim, border: "none",
                padding: "11px", fontSize: 14, fontWeight: 400, fontFamily: t.bodyFont,
                cursor: busy ? "default" : "pointer", opacity: 0.7 }}>
                Never
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
