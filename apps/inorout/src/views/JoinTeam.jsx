import { useState } from "react";
import { colors as C } from "@platform/core";

export default function JoinTeam({ team, onJoin, loading, error }) {
  const [name, setName] = useState("");

  const handleKey = (e) => {
    if (e.key === "Enter" && name.trim()) onJoin(name.trim());
  };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif",
      display:"flex", flexDirection:"column" }}>

      {/* Header */}
      <div style={{ padding:"24px 24px 20px", background:"#0f0f0f",
        borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28,
          color:C.amber, letterSpacing:3 }}>IN OR OUT</div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:4 }}>You've been invited to join</div>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
          color:C.text, letterSpacing:1, marginTop:2 }}>{team.name}</div>
      </div>

      {/* Form */}
      <div style={{ padding:24, flex:1 }}>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
          color:C.muted, marginBottom:24, lineHeight:1.6 }}>
          Enter your name to join. You'll get a personal link to bookmark —
          tap it every week to confirm you're in or out.
        </div>

        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
          color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
          Your Name
        </div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          placeholder="e.g. Dave"
          autoFocus
          style={{ width:"100%", padding:"14px 16px", borderRadius:6,
            border:`1.5px solid ${name.trim()?C.amber:C.border}`,
            background:"#0a0a0a", color:C.text,
            fontFamily:"Inter,sans-serif", fontSize:16, fontWeight:500,
            outline:"none", boxSizing:"border-box", marginBottom:16,
            transition:"border-color 0.2s" }}
        />

        {error && (
          <div style={{ padding:"10px 14px", borderRadius:6, background:C.red+"18",
            border:`1px solid ${C.red}44`, fontFamily:"Inter,sans-serif",
            fontSize:13, color:C.red, marginBottom:16 }}>{error}</div>
        )}

        <button
          onClick={() => name.trim() && onJoin(name.trim())}
          disabled={loading || !name.trim()}
          style={{ width:"100%", padding:"15px 0", borderRadius:6, border:"none",
            background: loading || !name.trim() ? "#2a2a2a" : C.amber,
            color: loading || !name.trim() ? C.muted : "#000",
            fontFamily:"Inter,sans-serif", fontSize:15, fontWeight:800,
            cursor: loading || !name.trim() ? "not-allowed" : "pointer",
            letterSpacing:0.5 }}>
          {loading ? "Joining..." : `Join ${team.name} →`}
        </button>

        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted,
          textAlign:"center", marginTop:16, lineHeight:1.5 }}>
          No account needed · Takes 5 seconds
        </div>
      </div>
    </div>
  );
}
