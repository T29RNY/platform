import { useState } from "react";
import { colors as C, groupByStatus, isLateDropout, sendTemplate, notificationTemplates } from "@platform/core";
import { Card, Badge, Btn } from "@platform/ui";

export default function PlayerView({ squad, setSquad, myId, schedule }) {
  const me = squad.find(p => p.id === myId);
  const [note, setNote]         = useState(me?.note || "");
  const [showNote, setShowNote] = useState(false);
  const SC = { in:C.green, maybe:C.amber, out:C.red, none:C.muted };

  const setStatus = (s) => {
    const late = isLateDropout(me?.status, s, schedule.gameDateTime);
    if (late) sendTemplate(notificationTemplates.lateDropout, me?.name);
    setSquad(squad.map(p => p.id === myId
      ? { ...p, status:s, note, lateDropouts:(p.lateDropouts||0)+(late?1:0) }
      : p
    ));
  };

  const saveNote = () => {
    setSquad(squad.map(p => p.id === myId ? { ...p, note } : p));
    setShowNote(false);
  };

  const markSelfPaid = () => {
    setSquad(squad.map(p => p.id === myId ? { ...p, selfPaid:true } : p));
    sendTemplate(notificationTemplates.gameOpen, schedule.dayOfWeek);
  };

  const inPlayers    = squad.filter(p => p.status === "in" && !p.disabled);
  const teamsSet     = inPlayers.length > 0 && inPlayers.every(p => p.team);
  const isFull       = inPlayers.length >= (schedule.squadSize || 14);
  const groups       = groupByStatus(squad);
  const teamAPlayers = [...inPlayers.filter(p => p.team==="A")].sort((a,b)=>a.name.localeCompare(b.name));
  const teamBPlayers = [...inPlayers.filter(p => p.team==="B")].sort((a,b)=>a.name.localeCompare(b.name));

  if (schedule.isCancelled) return (
    <div style={{ padding:18 }}>
      <Card color={C.red} style={{ textAlign:"center", padding:"30px 20px" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>❌</div>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28, color:C.red, letterSpacing:2 }}>
          THIS WEEK CANCELLED
        </div>
        {schedule.cancelReason && (
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted, marginTop:8 }}>
            {schedule.cancelReason}
          </div>
        )}
      </Card>
    </div>
  );

  return (
    <div style={{ padding:18 }}>
      {/* Price strip */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"10px 14px", background:C.surface, borderRadius:6,
        border:`1px solid ${C.border}`, marginBottom:16 }}>
        <span style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, color:C.muted }}>
          💵 This week
        </span>
        <span style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:800, color:C.amber }}>
          £{schedule.pricePerPlayer}
        </span>
      </div>

      {/* Teams confirmed */}
      {teamsSet && (
        <Card color={C.blue} style={{ marginBottom:20 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800, color:C.blue,
            letterSpacing:1.5, textTransform:"uppercase", marginBottom:14 }}>🏟 TEAMS CONFIRMED</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            {[["A", teamAPlayers, C.teamA], ["B", teamBPlayers, C.teamB]].map(([t, players, color]) => (
              <div key={t}>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:800, color,
                  letterSpacing:1, textTransform:"uppercase", marginBottom:10,
                  paddingBottom:6, borderBottom:`2px solid ${color}` }}>TEAM {t}</div>
                {players.map((p, i) => (
                  <div key={p.id} style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500,
                    color:p.id===myId?color:C.text, padding:"4px 0",
                    borderBottom:`1px solid ${C.border}`,
                    display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:11, color:C.faint, minWidth:16 }}>{i+1}</span>
                    {p.name}{p.id===myId && <Badge text="you" color={color}/>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Full squad list */}
      {isFull && !teamsSet && (
        <Card color={C.green} style={{ marginBottom:20 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800, color:C.green,
            letterSpacing:1.5, textTransform:"uppercase", marginBottom:12 }}>✅ SQUAD CONFIRMED</div>
          {inPlayers.map((p, i) => (
            <div key={p.id} style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500,
              color:p.id===myId?C.green:C.text, padding:"5px 0",
              borderBottom:`1px solid ${C.border}`,
              display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:16,
                color:C.faint, minWidth:22 }}>{i+1}</span>
              {p.name}{p.id===myId && <Badge text="you" color={C.green}/>}
            </div>
          ))}
        </Card>
      )}

      {/* Response card */}
      {!schedule.gameIsLive ? (
        <Card style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:28, marginBottom:10 }}>⏸</div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:600, color:C.muted }}>
            Game not open yet
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.faint, marginTop:4 }}>
            Opens {schedule.opensDay} at {schedule.opensTime}
          </div>
        </Card>
      ) : (
        <Card style={{ marginBottom:20 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color:C.muted,
            letterSpacing:1, textTransform:"uppercase", marginBottom:14 }}>
            {me?.name} — are you in {schedule.dayOfWeek}?
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            {["in","out"].map(s => (
              <button key={s} onClick={() => setStatus(s)} style={{
                flex:1, padding:"14px 0", borderRadius:6,
                border:`2px solid ${me?.status===s ? SC[s] : C.border}`,
                background:me?.status===s ? SC[s]+"18" : "transparent",
                color:me?.status===s ? SC[s] : C.muted,
                fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, cursor:"pointer" }}>
                {s==="in" ? "✅ I'M IN" : "❌ I'M OUT"}
              </button>
            ))}
          </div>
          <button onClick={() => setStatus("maybe")} style={{
            width:"100%", padding:"12px 0", borderRadius:6,
            border:`2px solid ${me?.status==="maybe" ? C.amber : C.border}`,
            background:me?.status==="maybe" ? C.amber+"18" : "transparent",
            color:me?.status==="maybe" ? C.amber : C.muted,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700,
            cursor:"pointer", marginBottom:10 }}>
            ❓ MAYBE — I'll try
          </button>

          {/* Note */}
          {me?.status && me.status !== "none" && me.status !== "in" && (
            <div style={{ marginBottom:10 }}>
              {showNote ? (
                <div>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder="Add a note e.g. 'Might be late from work'" rows={2}
                    style={{ width:"100%", padding:"10px 12px", borderRadius:6,
                      border:`1px solid ${C.border}`, background:"#0a0a0a", color:C.text,
                      fontFamily:"Inter,sans-serif", fontSize:13, outline:"none",
                      boxSizing:"border-box", resize:"none", marginBottom:8 }}/>
                  <div style={{ display:"flex", gap:8 }}>
                    <Btn label="Save Note" color={C.amber} fill onClick={saveNote} small block/>
                    <Btn label="Cancel" color={C.muted} onClick={() => setShowNote(false)} small block/>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowNote(true)} style={{ background:"none", border:"none",
                  color:C.muted, fontFamily:"Inter,sans-serif", fontSize:12, cursor:"pointer", padding:0 }}>
                  {me?.note ? `📝 "${me.note}"` : "+ Add a note"}
                </button>
              )}
            </div>
          )}

          {me?.status && me.status !== "none" && (
            <div style={{ padding:"10px 12px", borderRadius:6, textAlign:"center",
              background:SC[me.status]+"12", color:SC[me.status],
              fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500 }}>
              {me.status==="in" ? `Locked in 👊 See you ${schedule.dayOfWeek}`
               : me.status==="maybe" ? "Got it — we'll keep a spot open 🤞"
               : "No worries, we'll find cover 👍"}
            </div>
          )}
        </Card>
      )}

      {/* Live board */}
      {!teamsSet && (
        <>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800, color:C.muted,
            letterSpacing:1.5, textTransform:"uppercase", margin:"20px 0 12px" }}>LIVE BOARD</div>
          {[["in","✅","IN",C.green],["maybe","❓","MAYBE",C.amber],
            ["out","❌","OUT",C.red],["none","⏳","NO RESPONSE",C.muted]].map(([k,emoji,label,color]) =>
            groups[k].length > 0 && (
              <div key={k} style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color,
                  letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
                  {emoji} {label} ({groups[k].length})
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {groups[k].map(p => (
                    <div key={p.id} style={{ padding:"5px 12px", borderRadius:4,
                      background:color+"14", border:`1px solid ${color}40`,
                      fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, color,
                      display:"flex", flexDirection:"column", gap:2 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                        {p.name}{p.type==="guest" && <Badge text="guest" color={C.muted}/>}
                      </div>
                      {p.note && (
                        <div style={{ fontSize:10, color:C.muted, fontStyle:"italic" }}>
                          "{p.note}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* Balance + self-pay */}
      <div style={{ marginTop:16, padding:"13px 16px", background:C.surface,
        borderRadius:6, border:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
              color:C.muted, letterSpacing:1, textTransform:"uppercase" }}>Your Balance</div>
            <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
              color:me?.owes ? C.red : C.green, marginTop:2 }}>
              {me?.owes ? `£${me.owes} OWED` : "ALL CLEAR ✅"}
            </div>
          </div>
          <div style={{ fontSize:26 }}>💰</div>
        </div>
        {me?.status==="in" && !me?.paid && !me?.selfPaid && (
          <button onClick={markSelfPaid} style={{ marginTop:10, width:"100%", padding:"10px 0",
            borderRadius:6, border:`1.5px solid ${C.green}`, background:"transparent", color:C.green,
            fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            I've Paid — Notify Admin
          </button>
        )}
        {me?.selfPaid && !me?.paid && (
          <div style={{ marginTop:10, padding:"8px 12px", borderRadius:6,
            background:C.amber+"12", fontFamily:"Inter,sans-serif", fontSize:12,
            fontWeight:500, color:C.amber, textAlign:"center" }}>
            ⏳ Payment flagged — awaiting admin confirmation
          </div>
        )}
      </div>
    </div>
  );
}
