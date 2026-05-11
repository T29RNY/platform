import { useState } from "react";
import { colors as C } from "@platform/core";
import { findPlayerByEmail } from "@platform/supabase";

function saveAndGo(token) {
  const path = `/p/${token}`;
  localStorage.setItem("ioo_last_visited", path);
  window.location.replace(path);
}

export default function PWAWelcome() {
  const [email,        setEmail]        = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError,   setEmailError]   = useState(null);
  const [teamPicker,   setTeamPicker]   = useState(null); // [{token, team_id, team_name}]

  const [link,      setLink]      = useState("");
  const [linkError, setLinkError] = useState(null);

  const handleEmailSubmit = async () => {
    if (!email.trim()) return;
    setEmailLoading(true);
    setEmailError(null);
    setTeamPicker(null);
    try {
      const rows = await findPlayerByEmail(email.trim());
      if (!rows.length) {
        setEmailError("No player found with that email — try pasting your link below");
        return;
      }
      if (rows.length === 1) {
        saveAndGo(rows[0].token);
        return;
      }
      setTeamPicker(rows);
    } catch {
      setEmailError("Something went wrong — try pasting your link below");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleLinkSubmit = () => {
    const val = link.trim();
    if (!val) return;
    const match = val.match(/\/p\/(p_[a-zA-Z0-9]+)/);
    const token = match ? match[1] : val;
    if (!token.startsWith("p_")) {
      setLinkError("That doesn't look right — check your link");
      return;
    }
    saveAndGo(token);
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
        Find your player page to get started
      </div>

      {/* Option A — email */}
      <div style={{ width:"100%" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.muted,
          letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
          Know your email? Enter it below
        </div>
        <input
          type="email"
          value={email}
          autoFocus
          onChange={e => { setEmail(e.target.value); setEmailError(null); setTeamPicker(null); }}
          onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
          placeholder="your@email.com"
          style={{ width:"100%", padding:"13px 14px", borderRadius:6,
            border:`1.5px solid ${email ? C.amber : C.border}`,
            background:"#0a0a0a", color:C.text,
            fontFamily:"Inter,sans-serif", fontSize:14,
            outline:"none", boxSizing:"border-box", marginBottom:8,
            transition:"border-color 0.15s" }}
        />

        {emailError && (
          <div style={{ padding:"9px 12px", borderRadius:6, marginBottom:8,
            background:C.red+"14", border:`1px solid ${C.red}40`,
            fontSize:12, color:C.red }}>
            {emailError}
          </div>
        )}

        {/* Multi-team picker */}
        {teamPicker && (
          <div style={{ padding:"14px", borderRadius:8, marginBottom:8,
            background:C.amber+"0c", border:`1px solid ${C.amber}30` }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.amber, marginBottom:10 }}>
              Which team?
            </div>
            {teamPicker.map(r => (
              <button key={r.team_id} onClick={() => saveAndGo(r.token)} style={{
                width:"100%", padding:"11px 14px", borderRadius:6, marginBottom:6,
                border:`1px solid ${C.border}`, background:C.surface,
                color:C.text, fontFamily:"Inter,sans-serif", fontSize:13,
                fontWeight:500, cursor:"pointer", textAlign:"left",
              }}>
                {r.team_name}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleEmailSubmit}
          disabled={emailLoading || !email.trim()}
          style={{ width:"100%", padding:"13px 0", borderRadius:6, border:"none",
            background: emailLoading || !email.trim() ? "#2a2a2a" : C.amber,
            color: emailLoading || !email.trim() ? C.muted : "#000",
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:800,
            cursor: emailLoading || !email.trim() ? "not-allowed" : "pointer" }}>
          {emailLoading ? "Looking up..." : "Find my link →"}
        </button>
      </div>

      {/* Divider */}
      <div style={{ display:"flex", alignItems:"center", gap:12,
        width:"100%", margin:"24px 0" }}>
        <div style={{ flex:1, height:1, background:C.border }}/>
        <span style={{ fontSize:11, color:C.muted, fontWeight:600 }}>or</span>
        <div style={{ flex:1, height:1, background:C.border }}/>
      </div>

      {/* Option B — paste link */}
      <div style={{ width:"100%" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.muted,
          letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
          Or paste your player link
        </div>
        <input
          type="url"
          value={link}
          onChange={e => { setLink(e.target.value); setLinkError(null); }}
          onKeyDown={e => e.key === "Enter" && handleLinkSubmit()}
          placeholder="https://in-or-out.com/p/p_..."
          style={{ width:"100%", padding:"13px 14px", borderRadius:6,
            border:`1.5px solid ${link ? C.amber : C.border}`,
            background:"#0a0a0a", color:C.text,
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
            background: link.trim() ? C.amber : "#2a2a2a",
            color: link.trim() ? "#000" : C.muted,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:800,
            cursor: link.trim() ? "pointer" : "not-allowed" }}>
          Go →
        </button>
      </div>
    </div>
  );
}
