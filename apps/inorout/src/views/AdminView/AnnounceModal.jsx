import { useState } from "react";

export default function AnnounceModal({ squad, settings, teamId, schedule, onClose }) {
  const [targets, setTargets] = useState(new Set(["in", "maybe", "reserve"]));
  const [msg,     setMsg]     = useState("");

  const groups = [
    { key:"in",      label:"In",          players: squad.filter(p => p.status==="in"      && !p.disabled && !p.injured) },
    { key:"out",     label:"Out",         players: squad.filter(p => p.status==="out"     && !p.disabled && !p.injured) },
    { key:"maybe",   label:"Maybe",       players: squad.filter(p => p.status==="maybe"   && !p.disabled && !p.injured) },
    { key:"reserve", label:"Reserve",     players: squad.filter(p => p.status==="reserve" && !p.disabled && !p.injured) },
    { key:"none",    label:"No Response", players: squad.filter(p => p.status==="none"    && !p.disabled && !p.injured) },
    { key:"injured", label:"Injured",     players: squad.filter(p => p.injured && !p.disabled) },
  ];

  const toggle = (key) => setTargets(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const selectedCount = groups.reduce((sum, g) => targets.has(g.key) ? sum + g.players.length : sum, 0);

  const send = () => {
    if (!msg.trim() || !selectedCount) return;
    const ids = groups.filter(g => targets.has(g.key)).flatMap(g => g.players.map(p => p.id));
    fetch("/api/notify", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        type:"announce", teamId, playerIds: ids,
        payload: { title: settings?.groupName || "In or Out ⚽", body: msg, icon:"/icons/icon-192.png" },
        gameDate: schedule.gameDateTime?.split("T")[0],
      }),
    }).catch(console.error);
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200 }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)" }}/>
      <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430, background:"var(--s1)",
        borderRadius:"var(--r) var(--r) 0 0", padding:"20px 16px 44px",
        border:"0.5px solid var(--border-subtle)" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:26, letterSpacing:"0.04em",
          marginBottom:16, color:"var(--t1)" }}>Announce to Squad</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
          {groups.map(({ key, label, players }) => {
            const checked = targets.has(key);
            return (
              <div key={key} onClick={() => toggle(key)}
                style={{ display:"flex", alignItems:"center",
                  justifyContent:"space-between", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:18, height:18, borderRadius:4,
                    border:`0.5px solid ${checked ? "var(--green)" : "var(--border-subtle)"}`,
                    background: checked ? "var(--green2)" : "transparent",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    flexShrink:0 }}>
                    {checked && <span style={{ fontSize:10, color:"var(--green)" }}>✓</span>}
                  </div>
                  <span style={{ fontSize:13, color:"var(--t1)" }}>{label}</span>
                </div>
                <span style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>{players.length}</span>
              </div>
            );
          })}
        </div>
        <textarea value={msg} onChange={e => setMsg(e.target.value)}
          placeholder="Write your message..."
          rows={3}
          style={{ width:"100%", background:"var(--s2)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--rs)", padding:"10px 12px", fontSize:13, color:"var(--t1)",
            fontFamily:"var(--font-body)", outline:"none", resize:"none",
            marginBottom:12, boxSizing:"border-box" }}/>
        <button onClick={send} disabled={!msg.trim() || !selectedCount}
          style={{ width:"100%", padding:"13px 0", borderRadius:"var(--r)", border:"none",
            background: msg.trim() && selectedCount ? "var(--gold)" : "var(--s3)",
            color: msg.trim() && selectedCount ? "var(--black)" : "var(--t2)",
            fontFamily:"var(--font-body)", fontSize:14, fontWeight:600,
            cursor: msg.trim() && selectedCount ? "pointer" : "not-allowed" }}>
          Send to {selectedCount} player{selectedCount !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}
