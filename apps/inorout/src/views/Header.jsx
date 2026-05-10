import { colors as C } from "@platform/core";
import { getConfirmedCount } from "@platform/core";

export default function Header({ view, setView, squad, schedule, settings, isAdmin }) {
  const inCount = getConfirmedCount(squad.filter(p => !p.disabled));
  const needed  = schedule.squadSize || 14;
  const full    = inCount >= needed;
  const teamsSet = inCount > 0 && squad.filter(p => p.status === "in" && !p.disabled).every(p => p.team);

  const tabs = [
    ["player",  "MY VIEW"],
    ["stats",   "STATS"],
    ["history", "HISTORY"],
    ...(isAdmin ? [["admin", "ADMIN"]] : []),
  ];

  const statusLine = () => {
    if (schedule.isCancelled) return { text:"❌ THIS WEEK CANCELLED", color:C.red };
    if (schedule.isDraft)     return { text:"📋 DRAFT — NOT YET LIVE", color:C.amber };
    if (teamsSet)             return { text:"🏟 TEAMS CONFIRMED", color:C.blue };
    if (schedule.gameIsLive)  return { text:"🟢 GAME IS OPEN", color:C.green };
    return { text:"⏸ NOT YET OPEN", color:C.muted };
  };

  const { text, color } = statusLine();

  return (
    <div style={{ background:"#0f0f0f", borderBottom:`1px solid ${C.border}`,
      position:"sticky", top:0, zIndex:20 }}>
      <div style={{ padding:"14px 18px 12px", display:"flex",
        justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:600,
            color:C.muted, letterSpacing:1, textTransform:"uppercase" }}>
            {settings.groupName}
          </div>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:30, color:C.amber,
            letterSpacing:3, lineHeight:1.1, marginTop:2 }}>
            IN OR OUT
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:500,
            color:C.muted, marginTop:3 }}>
            {schedule.dayOfWeek} · {schedule.venue} · {schedule.kickoff}
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:600,
            color, marginTop:3, letterSpacing:0.5 }}>
            {text}
          </div>
        </div>
        <div style={{ textAlign:"center", background:full?C.green+"20":C.amber+"20",
          border:`2px solid ${full?C.green:C.amber}`, borderRadius:8,
          padding:"8px 14px", minWidth:58 }}>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:34,
            color:full?C.green:C.amber, lineHeight:1 }}>{inCount}</div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:10,
            fontWeight:600, color:C.muted }}>/{needed}</div>
        </div>
      </div>
      <div style={{ display:"flex", borderTop:`1px solid ${C.border}` }}>
        {tabs.map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} style={{
            flex:1, padding:"11px 0", border:"none",
            borderBottom: view===v ? `2px solid ${C.amber}` : "2px solid transparent",
            background:"transparent", color:view===v ? C.amber : C.muted,
            fontFamily:"Inter,sans-serif", fontSize:10, fontWeight:700,
            letterSpacing:1, cursor:"pointer", textTransform:"uppercase" }}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
