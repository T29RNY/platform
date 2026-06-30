// LiveMatchSheet.jsx — shared live-match overlay (referee + broadcast/operator).
//
// Extracted from RefMatch.jsx (P1 of the referee-owed epic) so the same token-driven
// live-match surface can be reused by the broadcast composer (P2) and ref ratings (P4)
// without re-porting it per surface. Behaviour for the referee path is unchanged:
// RefMatch now renders this with the referee defaults (amber accent, "Fixtures" label,
// "Officiating" iframe title). New surfaces override those props and pass a `footer`
// slot for their extra UI (composer, rating); when `footer` is absent the layout is
// byte-for-byte the old RefMatch overlay.
//
// Still the sanctioned "pull the ref view in, unchanged" mechanism: it IFRAMEs the
// existing token-driven apps/ref route. The ref_token carries all authority
// (get_fixture_state_by_ref_token is SECURITY DEFINER + anon), so no parent
// session/cookie sharing is needed — works cross-origin, including inside the iOS
// WKWebView wrap. Confirmed embeddable: platform-ref.vercel.app sets no
// X-Frame-Options / CSP frame headers (apps/ref/vercel.json adds none).

import MIcon from "./icons.jsx";

// Mirrors ProfileSheet's REF_APP_BASE — the live ref deployment until a *.in-or-out.com
// subdomain is attached. The ref app reads /ref/<TOKEN> and self-resolves the fixture.
const REF_APP_BASE = import.meta.env.VITE_REF_APP_URL || "https://platform-ref.vercel.app";

export function liveMatchTitle(g) {
  if (!g) return "Officiating";
  if (g.context === "casual") return g.squad_name || "Casual match";
  return `${g.home_team || "Home"} v ${g.away_team || "Away"}`;
}

export default function LiveMatchSheet({
  game,
  onBack,
  backLabel = "Fixtures",
  accent = "var(--amber)",
  iframeTitle = "Officiating",
  title,
  footer = null,
}) {
  const token = game?.ref_token;
  const src = token ? `${REF_APP_BASE}/ref/${encodeURIComponent(token)}` : REF_APP_BASE;
  const live = game?.is_in_progress;
  const heading = title ?? liveMatchTitle(game);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column",
        background: "var(--bg)",
      }}>
      {/* slim back bar (accent-tinted) */}
      <div
        style={{
          flex: "none", display: "flex", alignItems: "center", gap: 10,
          padding: "calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px",
          background: "var(--s1)", borderBottom: "1px solid var(--hair)",
        }}>
        <button
          onClick={onBack}
          aria-label="Back to my fixtures"
          style={{
            flex: "none", display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
            background: "none", border: "none", color: accent, fontFamily: "var(--m-font)",
            fontSize: 14, fontWeight: 700, padding: "4px 4px",
          }}>
          <MIcon name="chevleft" size={18} color={accent} />
          {backLabel}
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {heading}
          </div>
        </div>
        <div style={{ flex: "none", width: 64, display: "flex", justifyContent: "flex-end" }}>
          {live && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--live-soft)", color: "var(--live-ink)" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--live)" }} />LIVE
            </span>
          )}
        </div>
      </div>

      {/* the real ref app, embedded unchanged */}
      <iframe
        title={iframeTitle}
        src={src}
        allow="clipboard-write; fullscreen; screen-wake-lock"
        style={{ flex: 1, width: "100%", border: "none", background: "var(--bg)" }}
      />

      {/* optional surface-specific footer (composer / rating UI); absent for referee */}
      {footer}
    </div>
  );
}
