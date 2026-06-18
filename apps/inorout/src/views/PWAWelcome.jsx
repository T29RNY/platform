import { useState } from "react";
import { colors as C } from "@platform/core";

// Accept three link shapes: player tokens (p_*), admin tokens (admin_*),
// and join codes (/join/<code>). Each routes to its correct surface.
// Routes are written to ioo_last_visited as a breadcrumb in case the user
// re-installs later — same key the App.jsx redirect bridge reads.
function parseAndRoute(input) {
  const v = input.trim();
  if (!v) return { ok: false };

  // /join/<code> — from full URL or bare path
  const joinMatch = v.match(/\/join\/([a-zA-Z0-9_-]+)/);
  if (joinMatch) return { ok: true, path: `/join/${joinMatch[1]}` };

  // /admin/<token> from full URL
  const adminUrlMatch = v.match(/\/admin\/(admin_[a-zA-Z0-9_-]+)/);
  if (adminUrlMatch) return { ok: true, path: `/admin/${adminUrlMatch[1]}` };

  // /p/<token> from full URL
  const playerUrlMatch = v.match(/\/p\/(p_[a-zA-Z0-9]+)/);
  if (playerUrlMatch) return { ok: true, path: `/p/${playerUrlMatch[1]}` };

  // Bare token paste
  if (/^admin_[a-zA-Z0-9_-]+$/.test(v)) return { ok: true, path: `/admin/${v}` };
  if (/^p_[a-zA-Z0-9]+$/.test(v))       return { ok: true, path: `/p/${v}` };

  return { ok: false };
}

export default function PWAWelcome() {
  const [link,      setLink]      = useState("");
  const [linkError, setLinkError] = useState(null);

  const handleLinkSubmit = () => {
    const parsed = parseAndRoute(link);
    if (!parsed.ok) {
      setLinkError("That doesn't look right — try your player link, your admin link, or your team invite link.");
      return;
    }
    localStorage.setItem("ioo_last_visited", parsed.path);
    window.location.replace(parsed.path);
  };

  return (
    <div style={{
      background:C.bg, minHeight:"100dvh", color:C.text,
      display:"flex", flexDirection:"column", alignItems:"center",
      padding:"52px 24px 40px", fontFamily:"Inter,sans-serif",
      maxWidth:430, margin:"0 auto", boxSizing:"border-box",
    }}>

      {/* Wordmark */}
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:52,
        color:C.amber, letterSpacing:4, textAlign:"center", marginBottom:6 }}>
        IN OR OUT
      </div>

      {/* Headlines */}
      <div style={{ fontSize:18, fontWeight:700, color:C.text,
        textAlign:"center", marginBottom:6 }}>
        Welcome to In or Out ⚽
      </div>
      <div style={{ fontSize:13, color:C.muted, textAlign:"center",
        lineHeight:1.6, marginBottom:44 }}>
        Paste your player link to get started
      </div>

      {/* Paste link */}
      <div style={{ width:"100%" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.muted,
          letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
          Paste your player link
        </div>
        <input
          type="url"
          value={link}
          autoFocus
          onChange={e => { setLink(e.target.value); setLinkError(null); }}
          onKeyDown={e => e.key === "Enter" && handleLinkSubmit()}
          placeholder="https://app.in-or-out.com/p/p_..."
          style={{ width:"100%", padding:"13px 14px", borderRadius:6,
            border:`1.5px solid ${link ? C.amber : C.border}`,
            background:C.bg, color:C.text,
            fontFamily:"Inter,sans-serif", fontSize:14,
            outline:"none", boxSizing:"border-box", marginBottom:8,
            transition:"border-color 0.15s" }}
        />
        {linkError && (
          <div style={{ padding:"9px 12px", borderRadius:6, marginBottom:8,
            background:C.red+"14", border:`1px solid ${C.red}40`,
            fontSize:12, color:C.red }}>
            {linkError}
          </div>
        )}
        <button
          onClick={handleLinkSubmit}
          disabled={!link.trim()}
          style={{ width:"100%", padding:"13px 0", borderRadius:6, border:"none",
            background: link.trim() ? C.amber : C.border,
            color: link.trim() ? C.black : C.muted,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:800,
            cursor: link.trim() ? "pointer" : "not-allowed" }}>
          Go →
        </button>
      </div>

      {/* Help text */}
      <div style={{ fontSize:12, color:C.muted, textAlign:"center",
        marginTop:32, lineHeight:1.6 }}>
        Can't find your link? Ask your admin to reshare the invite.
      </div>
    </div>
  );
}
