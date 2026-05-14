import { useState } from "react";
import { colors as C } from "@platform/core";
import { BackBtn, Btn, SecTitle } from "@platform/ui";

export default function BibsScreen({ squad, setSquad, bibHistory, setBibHistory, schedule, onBack }) {
  const [bibHolder, setBibHolder] = useState("");
  const [bibSaved,  setBibSaved]  = useState(false);
  const bibCounts = bibHistory.reduce((acc,b) => ({ ...acc,[b.name]:(acc[b.name]||0)+1 }), {});

  const saveBibs = () => {
    if (!bibHolder) return;
    const date = new Date().toLocaleDateString("en-GB", { day:"numeric", month:"short" });
    setBibHistory([{ name:bibHolder, date, returned:false }, ...bibHistory]);
    setSquad(squad.map(p => p.name===bibHolder ? { ...p, bibCount:(p.bibCount||0)+1 } : p));
    setBibSaved(true);
  };

  return (
    <div style={{ padding:18 }}>
      <BackBtn onClick={() => { onBack(); setBibSaved(false); setBibHolder(""); }}/>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber, letterSpacing:2, marginBottom:18 }}>
        🟡 BIB TRACKER
      </div>
      <SecTitle>Who has them tonight?</SecTitle>
      {squad.filter(p => p.status==="in" && !p.disabled && !p.isGuest).map(p => (
        <button key={p.id} onClick={() => { setBibHolder(p.name); setBibSaved(false); }} style={{
          display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%",
          padding:"13px 14px", borderRadius:6, marginBottom:7, cursor:"pointer",
          border:`2px solid ${bibHolder===p.name?C.amber:C.border}`,
          background:bibHolder===p.name?C.amber+"12":"transparent",
          fontFamily:"Inter,sans-serif" }}>
          <span style={{ fontSize:14, fontWeight:500, color:bibHolder===p.name?C.amber:C.text }}>{p.nickname || p.name}</span>
          <span style={{ fontSize:12, color:C.muted }}>taken {bibCounts[p.name]||0}× before</span>
        </button>
      ))}
      <div style={{ height:14 }}/>
      {!bibSaved
        ? <Btn label={bibHolder?`Confirm — ${bibHolder} has the bibs`:"Select a player first"}
            color={C.amber} fill={!!bibHolder} onClick={saveBibs} disabled={!bibHolder}/>
        : <button onClick={onBack} style={{
            width: "100%", padding: "16px 0", borderRadius: 12, border: "none",
            background: "var(--gold)", color: "#0A0A08",
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.1em",
            cursor: "pointer",
          }}>
            DONE
          </button>
      }
      <SecTitle>History</SecTitle>
      {bibHistory.map((b,i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:12,
          padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ fontSize:18 }}>{b.returned?"✅":"🟡"}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, color:C.text }}>{b.name}</div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginTop:2 }}>{b.date}</div>
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:600,
            padding:"3px 9px", borderRadius:4,
            background:b.returned?C.green+"12":C.amber+"12",
            color:b.returned?C.green:C.amber }}>
            {b.returned?"Returned":"Has them"}
          </div>
        </div>
      ))}
    </div>
  );
}
