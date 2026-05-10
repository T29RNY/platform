import { colors as C, randomSplitTeams, areTeamsSet, sendTemplate, notificationTemplates } from "@platform/core";
import { BackBtn, Btn } from "@platform/ui";

export default function TeamsScreen({ squad, setSquad, schedule, onBack }) {
  const inPlayers = squad.filter(p => p.status==="in" && !p.disabled);
  const teamsSet  = areTeamsSet(squad);

  const assignTeam = (id, team) =>
    setSquad(squad.map(p => p.id===id ? { ...p, team:p.team===team?null:team } : p));

  const doRandomSplit = () => {
    const split = randomSplitTeams(inPlayers);
    setSquad(squad.map(p => {
      const s = split.find(x => x.id===p.id);
      return s ? { ...p, team:s.team } : p;
    }));
    sendTemplate(notificationTemplates.teamsConfirmed);
  };

  const clearTeams = () => setSquad(squad.map(p => ({ ...p, team:null })));

  return (
    <div style={{ padding:18 }}>
      <BackBtn onClick={onBack}/>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber, letterSpacing:2, marginBottom:18 }}>
        TEAM SELECTION
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
        <Btn label="🎲 Random Split"       color={C.purple} fill onClick={doRandomSplit} small/>
        <Btn label="Clear Teams"           color={C.red}         onClick={clearTeams}   small/>
        {teamsSet && (
          <Btn label="📣 Notify — Teams Set" color={C.blue} fill
            onClick={() => sendTemplate(notificationTemplates.teamsConfirmed)} small/>
        )}
      </div>
      {inPlayers.length === 0 && (
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted, padding:"20px 0", textAlign:"center" }}>
          No confirmed players yet.
        </div>
      )}
      {inPlayers.map(p => (
        <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10,
          padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1, fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, color:C.text }}>
            {p.name}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {["A","B"].map(t => (
              <button key={t} onClick={() => assignTeam(p.id, t)} style={{
                padding:"6px 16px", borderRadius:5,
                fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700, cursor:"pointer",
                border:`2px solid ${p.team===t?(t==="A"?C.teamA:C.teamB):C.border}`,
                background:p.team===t?(t==="A"?C.teamA+"20":C.teamB+"20"):"transparent",
                color:p.team===t?(t==="A"?C.teamA:C.teamB):C.muted }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
