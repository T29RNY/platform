// RefMatch.jsx — Referee track, the in-app officiating handoff (full-screen overlay).
//
// The sanctioned "pull the ref view in, unchanged" mechanism: instead of re-porting
// the meticulously-designed ref app (apps/ref), we IFRAME its existing token-driven
// route. The ref_token carries all authority (get_fixture_state_by_ref_token is
// SECURITY DEFINER + anon), so no parent session/cookie sharing is needed — it works
// cross-origin, including inside the iOS WKWebView wrap.
//
// Rendered by MobileShell as a shell-level overlay (mirrors the `tournament` overlay
// pattern) covering the header + tab bar; a slim amber back bar returns to "My fixtures".
// Confirmed embeddable: platform-ref.vercel.app sets no X-Frame-Options / CSP frame
// headers (apps/ref/vercel.json adds none).

import MIcon from "../icons.jsx";

// Mirrors ProfileSheet's REF_APP_BASE — the live ref deployment until a *.in-or-out.com
// subdomain is attached. The ref app reads /ref/<TOKEN> and self-resolves the fixture.
const REF_APP_BASE = import.meta.env.VITE_REF_APP_URL || "https://platform-ref.vercel.app";

function titleFor(g) {
  if (!g) return "Officiating";
  if (g.context === "casual") return g.squad_name || "Casual match";
  return `${g.home_team || "Home"} v ${g.away_team || "Away"}`;
}

export default function RefMatch({ game, onBack }) {
  const token = game?.ref_token;
  const src = token ? `${REF_APP_BASE}/ref/${encodeURIComponent(token)}` : REF_APP_BASE;
  const live = game?.is_in_progress;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column",
        background: "var(--bg)",
      }}>
      {/* slim amber back bar */}
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
            background: "none", border: "none", color: "var(--amber)", fontFamily: "var(--m-font)",
            fontSize: 14, fontWeight: 700, padding: "4px 4px",
          }}>
          <MIcon name="chevleft" size={18} color="var(--amber)" />
          Fixtures
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {titleFor(game)}
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
        title="Officiating"
        src={src}
        allow="clipboard-write; fullscreen; screen-wake-lock"
        style={{ flex: 1, width: "100%", border: "none", background: "var(--bg)" }}
      />
    </div>
  );
}
