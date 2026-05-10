import { useState } from "react";
import { colors as C, generateMatchReport } from "@platform/core";
import { Card, SecTitle, BackBtn } from "@platform/ui";

export default function HistoryView({ matchHistory, settings }) {
  const [selected, setSelected] = useState(null);
  const [copied,   setCopied]   = useState(false);

  const copyReport = (match) => {
    const report = generateMatchReport(match, settings.groupName);
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (selected) {
    const m = matchHistory.find(x => x.id === selected);
    if (!m) return null;

    if (m.cancelled) return (
      <div style={{ padding:18 }}>
        <BackBtn onClick={() => setSelected(null)}/>
        <Card color={C.red} style={{ textAlign:"center", padding:"30px 20px" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>❌</div>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:26, color:C.red, letterSpacing:2 }}>{m.date}</div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:600, color:C.red, marginTop:8 }}>CANCELLED</div>
          {m.cancelReason && (
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted, marginTop:8 }}>{m.cancelReason}</div>
          )}
        </Card>
      </div>
    );

    const resultColor = m.winner==="A" ? C.teamA : m.winner==="B" ? C.teamB : C.amber;
    return (
      <div style={{ padding:18 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
          <BackBtn onClick={() => setSelected(null)}/>
          <button onClick={() => copyReport(m)} style={{ padding:"6px 12px", borderRadius:5,
            border:`1px solid ${C.border}`, background:"transparent",
            color:copied?C.green:C.muted, fontFamily:"Inter,sans-serif",
            fontSize:11, fontWeight:700, cursor:"pointer" }}>
            {copied ? "✓ Copied" : "📋 Share Report"}
          </button>
        </div>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber, letterSpacing:2, marginBottom:2 }}>{m.date}</div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700, color:resultColor,
          letterSpacing:1, textTransform:"uppercase", marginBottom:20 }}>
          {m.winner==="D" ? "DRAW" : `TEAM ${m.winner} WIN`}
        </div>

        <Card color={resultColor} style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:20 }}>
            <div>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color:C.teamA, letterSpacing:1 }}>TEAM A</div>
              <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:52, color:C.teamA, lineHeight:1 }}>{m.scoreA}</div>
            </div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:18, fontWeight:800, color:C.muted }}>VS</div>
            <div>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color:C.teamB, letterSpacing:1 }}>TEAM B</div>
              <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:52, color:C.teamB, lineHeight:1 }}>{m.scoreB}</div>
            </div>
          </div>
          {m.motm && (
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, color:C.amber, marginTop:10 }}>
              🏆 MOTM: {m.motm}
            </div>
          )}
        </Card>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
          {[["A", m.teamA, C.teamA], ["B", m.teamB, C.teamB]].map(([t, players, color]) => (
            <div key={t}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800, color,
                letterSpacing:1, textTransform:"uppercase", marginBottom:8,
                paddingBottom:5, borderBottom:`2px solid ${color}` }}>TEAM {t}</div>
              {[...(players||[])].sort().map(name => (
                <div key={name} style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500,
                  color:C.text, padding:"4px 0", borderBottom:`1px solid ${C.border}`,
                  display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  {name}
                  {m.scorers[name] > 0 && (
                    <span style={{ color:C.green, fontSize:11, fontWeight:700 }}>
                      {"⚽".repeat(Math.min(m.scorers[name],4))} {m.scorers[name]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <SecTitle>Payments</SecTitle>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {Object.entries(m.payments||{}).map(([name, paid]) => (
            <div key={name} style={{ padding:"4px 10px", borderRadius:4,
              background:paid?C.green+"14":C.red+"14",
              border:`1px solid ${paid?C.green+"40":C.red+"40"}`,
              fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:500,
              color:paid?C.green:C.red }}>
              {name} {paid ? "✅" : "💸"}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding:18 }}>
      <SecTitle size={13} color={C.text}>Match History</SecTitle>
      {matchHistory.length === 0 && (
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted,
          padding:"20px 0", textAlign:"center" }}>No matches recorded yet.</div>
      )}
      {matchHistory.map(m => {
        if (m.cancelled) return (
          <Card key={m.id} color={C.red} onClick={() => setSelected(m.id)}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, color:C.text }}>{m.date}</div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, color:C.red, marginTop:3 }}>❌ Cancelled</div>
            {m.cancelReason && (
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginTop:2 }}>{m.cancelReason}</div>
            )}
          </Card>
        );

        const resultColor = m.winner==="A" ? C.teamA : m.winner==="B" ? C.teamB : C.amber;
        return (
          <Card key={m.id} color={C.border} onClick={() => setSelected(m.id)}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, color:C.text }}>{m.date}</div>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, color:resultColor, marginTop:3 }}>
                  {m.winner==="D" ? "Draw" : `Team ${m.winner} Win`}
                </div>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginTop:2 }}>
                  {(m.teamA||[]).length+(m.teamB||[]).length} players · MOTM: {m.motm||"—"}
                </div>
              </div>
              <div style={{ textAlign:"center" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:32, color:C.teamA, lineHeight:1 }}>{m.scoreA}</div>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, color:C.muted }}>—</div>
                  <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:32, color:C.teamB, lineHeight:1 }}>{m.scoreB}</div>
                </div>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:9, fontWeight:700, color:C.muted, letterSpacing:1 }}>A — B</div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
