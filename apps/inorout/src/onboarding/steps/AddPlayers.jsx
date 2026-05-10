import { colors as C } from "@platform/core";
import { ONBOARDING_CONFIG as CFG } from "../config.js";

export default function AddPlayers({
  playerNames, newName, setNewName,
  addPlayer, removePlayer,
  onSubmit, onSkip, loading, error,
}) {
  const handleKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); addPlayer(); }
  };

  return (
    <div style={{ padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ marginBottom:28 }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
          color:C.text, letterSpacing:1 }}>
          {CFG.steps.addPlayers.title}
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:6 }}>
          {CFG.steps.addPlayers.subtitle}
        </div>
      </div>

      {/* Add player input */}
      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Player name..."
          style={{ flex:1, padding:"12px 14px", borderRadius:6,
            border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, outline:"none" }}/>
        <button onClick={addPlayer} disabled={!newName.trim()} style={{
          padding:"12px 18px", borderRadius:6, border:"none",
          background:newName.trim()?C.green:"#2a2a2a",
          color:newName.trim()?"#000":C.muted,
          fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700,
          cursor:newName.trim()?"pointer":"not-allowed", flexShrink:0,
        }}>+ Add</button>
      </div>

      {/* Player list */}
      {playerNames.filter(n=>n.trim()).length > 0 && (
        <div style={{ background:C.surface, borderRadius:8,
          border:`1px solid ${C.border}`, marginBottom:20, overflow:"hidden" }}>
          {playerNames.filter(n=>n.trim()).map((name, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center",
              justifyContent:"space-between", padding:"12px 16px",
              borderBottom:`1px solid ${C.border}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:24, height:24, borderRadius:"50%",
                  background:C.amber+"20", border:`1px solid ${C.amber}40`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:"Bebas Neue,sans-serif", fontSize:13, color:C.amber }}>
                  {i+1}
                </div>
                <span style={{ fontFamily:"Inter,sans-serif", fontSize:14,
                  fontWeight:500, color:C.text }}>{name}</span>
              </div>
              <button onClick={() => removePlayer(i)} style={{
                background:"none", border:"none", color:C.muted,
                fontSize:18, cursor:"pointer", padding:"0 4px", lineHeight:1 }}>×</button>
            </div>
          ))}
          <div style={{ padding:"10px 16px", fontFamily:"Inter,sans-serif",
            fontSize:12, color:C.muted }}>
            {playerNames.filter(n=>n.trim()).length} player{playerNames.filter(n=>n.trim()).length!==1?"s":""} added
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding:"10px 14px", borderRadius:6, background:C.red+"18",
          border:`1px solid ${C.red}44`, fontFamily:"Inter,sans-serif",
          fontSize:13, color:C.red, marginBottom:16 }}>{error}</div>
      )}

      <button onClick={() => onSubmit(false)}
        disabled={loading || playerNames.filter(n=>n.trim()).length === 0}
        style={{
          width:"100%", padding:"15px 0", borderRadius:6, border:"none",
          background: loading || playerNames.filter(n=>n.trim()).length===0 ? "#2a2a2a" : C.amber,
          color: loading || playerNames.filter(n=>n.trim()).length===0 ? C.muted : "#000",
          fontFamily:"Inter,sans-serif", fontSize:15, fontWeight:800,
          cursor: loading || playerNames.filter(n=>n.trim()).length===0 ? "not-allowed" : "pointer",
          marginBottom:12,
        }}>
        {loading ? "Adding players..." : CFG.steps.addPlayers.cta}
      </button>

      <button onClick={() => onSubmit(true)} disabled={loading} style={{
        width:"100%", padding:"12px 0", borderRadius:6,
        border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
        fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:600, cursor:"pointer",
      }}>
        {CFG.steps.addPlayers.skipCta}
      </button>
    </div>
  );
}
