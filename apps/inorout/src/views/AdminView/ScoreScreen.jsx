import { useState } from "react";
import { colors as C, newMatch, updatePlayerRecords } from "@platform/core";
import { BackBtn, Btn, SecTitle } from "@platform/ui";

export default function ScoreScreen({
  squad, setSquad, schedule, matchHistory, setMatchHistory,
  payments, bibHistory, onBack, onDraftNext,
}) {
  const [winner,       setWinner]       = useState(null);
  const [scoreA,       setScoreA]       = useState(0);
  const [scoreB,       setScoreB]       = useState(0);
  const [scorers,      setScorers]      = useState({});
  const [motmVote,     setMotmVote]     = useState(null);
  const [pendingResult,setPendingResult]= useState(null); // result staged, awaiting bib pick
  const [bibHolder,    setBibHolder]    = useState("");
  const [scoreSaved,   setScoreSaved]   = useState(false);

  const inPlayers  = squad.filter(p => p.status==="in" && !p.disabled);
  const addGoal    = id => setScorers(s => ({ ...s,[id]:(s[id]||0)+1 }));
  const removeGoal = id => setScorers(s => {
    const u = { ...s,[id]:Math.max(0,(s[id]||0)-1) };
    if (!u[id]) delete u[id];
    return u;
  });

  // Stage the result — show bib picker before committing
  const stageResult = () => {
    if (!winner) return;
    const teamAPlayers = inPlayers.filter(p=>p.team==="A").map(p=>p.name);
    const teamBPlayers = inPlayers.filter(p=>p.team==="B").map(p=>p.name);
    const scorerMap    = Object.fromEntries(inPlayers.map(p=>[p.name, scorers[p.id]||0]));
    const payMap       = Object.fromEntries(inPlayers.map(p=>[p.name, payments[p.id]||false]));
    setPendingResult({ teamAPlayers, teamBPlayers, scorerMap, payMap });
  };

  // Commit result with bib holder
  const confirmResult = () => {
    if (!pendingResult) return;
    const { teamAPlayers, teamBPlayers, scorerMap, payMap } = pendingResult;
    const match = newMatch({
      teamA:teamAPlayers, teamB:teamBPlayers, winner, scoreA, scoreB,
      scorers:scorerMap, motm:motmVote,
      bibHolder,
      payments:payMap,
    });
    setMatchHistory([match, ...matchHistory]);
    setSquad(updatePlayerRecords(squad, match, scorers, motmVote, payMap, schedule.pricePerPlayer));
    setScoreSaved(true);
  };

  const GoalCounter = ({ label, val, setter, color }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"12px 14px", borderRadius:6, background:C.surface,
      border:`1px solid ${C.border}`, marginBottom:8 }}>
      <span style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:600, color }}>{label}</span>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        {["−","+"].map((sym,i) => (
          <button key={sym} onClick={() => setter(v => Math.max(0,v+(i===0?-1:1)))}
            style={{ width:30, height:30, borderRadius:"50%", border:`1px solid ${C.border}`,
              background:"transparent", color:i===0?C.red:C.green, fontSize:18, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center" }}>{sym}</button>
        ))}
        <span style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:26, color,
          minWidth:22, textAlign:"center", order:-1 }}>{val}</span>
      </div>
    </div>
  );

  return (
    <div style={{ padding:18 }}>
      <BackBtn onClick={() => { onBack(); }}/>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber, letterSpacing:2, marginBottom:4 }}>FULL TIME</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginBottom:20 }}>
        Saves to history and updates all player records.
      </div>

      <SecTitle>Who Won?</SecTitle>
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        {["A","B"].map(t => (
          <button key={t} onClick={() => setWinner(t)} style={{
            flex:1, padding:"16px 0", borderRadius:6,
            border:`2px solid ${winner===t?(t==="A"?C.teamA:C.teamB):C.border}`,
            background:winner===t?(t==="A"?C.teamA+"18":C.teamB+"18"):"transparent",
            color:winner===t?(t==="A"?C.teamA:C.teamB):C.muted,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, cursor:"pointer" }}>
            TEAM {t}
          </button>
        ))}
      </div>
      <button onClick={() => setWinner("D")} style={{ width:"100%", padding:"12px 0", borderRadius:6,
        border:`2px solid ${winner==="D"?C.amber:C.border}`,
        background:winner==="D"?C.amber+"18":"transparent",
        color:winner==="D"?C.amber:C.muted,
        fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:22 }}>
        🤝 Draw
      </button>

      <SecTitle>Score — Optional</SecTitle>
      <GoalCounter label="Team A" val={scoreA} setter={setScoreA} color={C.teamA}/>
      <GoalCounter label="Team B" val={scoreB} setter={setScoreB} color={C.teamB}/>

      <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color:C.muted,
        letterSpacing:1, textTransform:"uppercase", margin:"20px 0 10px" }}>
        ⚽ Who Scored? <span style={{ color:C.faint, fontWeight:500 }}>Optional</span>
      </div>
      {inPlayers.map(p => (
        <div key={p.id} style={{ display:"flex", alignItems:"center", padding:"10px 12px",
          borderRadius:6, marginBottom:6,
          background:scorers[p.id]?C.green+"0c":C.surface,
          border:`1px solid ${scorers[p.id]?C.green+"44":C.border}` }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, color:C.text }}>{p.name}</div>
            {p.team && (
              <div style={{ fontSize:10, fontWeight:700,
                color:p.team==="A"?C.teamA:C.teamB, marginTop:1 }}>TEAM {p.team}</div>
            )}
          </div>
          {(scorers[p.id]||0)>0 && (
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700,
              color:C.green, marginRight:10 }}>
              {"⚽".repeat(Math.min(scorers[p.id],5))} {scorers[p.id]}
            </div>
          )}
          <div style={{ display:"flex", gap:8 }}>
            {(scorers[p.id]||0)>0 && (
              <button onClick={() => removeGoal(p.id)} style={{ width:28,height:28,borderRadius:"50%",
                border:`1px solid ${C.border}`,background:"transparent",color:C.red,fontSize:16,
                cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>−</button>
            )}
            <button onClick={() => addGoal(p.id)} style={{ width:28,height:28,borderRadius:"50%",
              border:`1px solid ${C.border}`,background:"transparent",color:C.green,fontSize:16,
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>+</button>
          </div>
        </div>
      ))}

      <SecTitle>🏆 Man of the Match</SecTitle>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:22 }}>
        {inPlayers.map(p => (
          <button key={p.id} onClick={() => setMotmVote(p.name)} style={{
            padding:"7px 14px", borderRadius:5,
            border:`1.5px solid ${motmVote===p.name?C.amber:C.border}`,
            background:motmVote===p.name?C.amber+"18":"transparent",
            color:motmVote===p.name?C.amber:C.muted,
            fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, cursor:"pointer" }}>
            {p.name}
          </button>
        ))}
      </div>

      {!pendingResult && !scoreSaved && (
        <Btn label={winner?"Save & Update All Records":"Select a Winner First"}
          color={C.amber} fill={!!winner} onClick={stageResult} disabled={!winner}/>
      )}

      {/* Bib holder picker — shown after staging, before committing */}
      {pendingResult && !scoreSaved && (
        <div style={{ padding:16, borderRadius:8, background:C.amber+"0c",
          border:`1px solid ${C.amber}40` }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700,
            color:C.amber, marginBottom:4 }}>🧺 Who took the bibs home?</div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginBottom:14 }}>
            They'll get a reminder before next week's game.
          </div>
          {inPlayers.filter(p => !p.isGuest).map(p => (
            <button key={p.id} onClick={() => setBibHolder(p.name)} style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              width:"100%", padding:"11px 14px", borderRadius:6, marginBottom:6,
              cursor:"pointer",
              border:`2px solid ${bibHolder===p.name?C.amber:C.border}`,
              background:bibHolder===p.name?C.amber+"12":"transparent",
              fontFamily:"Inter,sans-serif" }}>
              <span style={{ fontSize:13, fontWeight:500,
                color:bibHolder===p.name?C.amber:C.text }}>{p.name}</span>
              {bibHolder===p.name && <span style={{ fontSize:16 }}>🟡</span>}
            </button>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <Btn label="Confirm & Save Result" color={C.amber} fill onClick={confirmResult}
              disabled={!bibHolder} small block/>
            <Btn label="Skip" color={C.muted} onClick={confirmResult} small block/>
          </div>
        </div>
      )}

      {scoreSaved && (
        <div style={{ padding:14, borderRadius:6, textAlign:"center",
          background:C.green+"12", border:`1px solid ${C.green}44` }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:600, color:C.green }}>
            ✅ Result saved — all records updated
          </div>
          {motmVote && (
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginTop:4 }}>
              MOTM: {motmVote} 🏆
            </div>
          )}
          {bibHolder && (
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginTop:2 }}>
              🧺 {bibHolder} has the bibs — reminder set
            </div>
          )}
          <div style={{ marginTop:12 }}>
            <Btn label="📋 Draft Next Week" color={C.purple} fill
              onClick={() => { onDraftNext(); onBack(); }} block/>
          </div>
        </div>
      )}
    </div>
  );
}
