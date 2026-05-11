import { useState } from "react";
import { colors as C, requestNotifPerm, sendTemplate, notificationTemplates,
  carryForwardDebts, nextWeekDateTime, storage } from "@platform/core";
import { addCoverPlayer, removeCoverPlayer } from "@platform/supabase";
import { Card, SecTitle, Btn } from "@platform/ui";
import TeamsScreen    from "./TeamsScreen.jsx";
import ScoreScreen    from "./ScoreScreen.jsx";
import BibsScreen     from "./BibsScreen.jsx";
import SquadScreen    from "./SquadScreen.jsx";
import ScheduleScreen from "./ScheduleScreen.jsx";

function CoverPoolSection({ coverPool, setCoverPool, teamId }) {
  const [newName,  setNewName]  = useState("");
  const [adding,   setAdding]   = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const player = await addCoverPlayer(teamId, newName.trim());
      setCoverPool(prev => [...prev, player]);
      setNewName("");
    } catch(e) { console.error(e); }
    finally { setAdding(false); }
  };

  const handleRemove = async (id) => {
    try {
      await removeCoverPlayer(id);
      setCoverPool(prev => prev.filter(p => p.id !== id));
      setConfirmDel(null);
    } catch(e) { console.error(e); }
  };

  return (
    <>
      <SecTitle color={C.muted}>🪑 Cover Pool</SecTitle>
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="Add cover player name..."
          onKeyDown={e => e.key==="Enter" && handleAdd()}
          style={{ flex:1, padding:"10px 12px", borderRadius:6,
            border:`1px solid ${C.border}`, background:"#0a0a0a", color:C.text,
            fontFamily:"Inter,sans-serif", fontSize:13, outline:"none" }}/>
        <button onClick={handleAdd} disabled={adding || !newName.trim()} style={{
          padding:"10px 14px", borderRadius:6, border:"none",
          background:newName.trim()?C.green:"#2a2a2a",
          color:newName.trim()?"#000":C.muted,
          fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700,
          cursor:newName.trim()?"pointer":"not-allowed", flexShrink:0 }}>
          {adding?"Adding...":"+ Add"}
        </button>
      </div>
      {coverPool.length === 0 && (
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted,
          padding:"10px 0" }}>No cover players yet.</div>
      )}
      {coverPool.map(p => (
        <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10,
          padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
              fontWeight:500, color:C.text }}>{p.name}</div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12,
              color:C.muted, marginTop:1 }}>
              Played {p.played}×
              {p.owes > 0 && <span style={{ color:C.red }}> · Owes £{p.owes}</span>}
            </div>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={() => sendTemplate(notificationTemplates.coverNeeded, p.name)}
              style={{ padding:"6px 10px", borderRadius:5, border:`1px solid ${C.blue}`,
                background:"transparent", color:C.blue,
                fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
              Notify
            </button>
            {confirmDel === p.id ? (
              <>
                <button onClick={() => handleRemove(p.id)} style={{ padding:"6px 10px",
                  borderRadius:5, border:`1px solid ${C.red}`, background:C.red+"18",
                  color:C.red, fontFamily:"Inter,sans-serif", fontSize:11,
                  fontWeight:700, cursor:"pointer" }}>Confirm</button>
                <button onClick={() => setConfirmDel(null)} style={{ padding:"6px 10px",
                  borderRadius:5, border:`1px solid ${C.border}`, background:"transparent",
                  color:C.muted, fontFamily:"Inter,sans-serif", fontSize:11, cursor:"pointer" }}>
                  Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirmDel(p.id)} style={{ padding:"6px 10px",
                borderRadius:5, border:`1px solid ${C.border}`, background:"transparent",
                color:C.muted, fontFamily:"Inter,sans-serif", fontSize:11, cursor:"pointer" }}>
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export default function AdminView({
  squad, setSquad, bibHistory, setBibHistory,
  schedule, setSchedule, matchHistory, setMatchHistory,
  settings, setSettings, coverPool, setCoverPool, teamId,
}) {
  const [screen,     setScreen]     = useState("main");
  const [notifPerm,  setNotifPerm]  = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [showCancel,    setShowCancel]    = useState(false);
  const [cancelReason,  setCancelReason]  = useState("");
  const [payments,      setPayments]      = useState(
    () => Object.fromEntries(squad.map(p => [p.id, p.paid]))
  );
  const [dragId, setDragId] = useState(null);

  const inPlayers      = squad.filter(p => p.status==="in"      && !p.disabled);
  const reservePlayers = squad.filter(p => p.status==="reserve" && !p.disabled);
  const selfPaidPending = inPlayers.filter(p => p.selfPaid && !p.paid);

  const moveReserve = (fromId, toId) => {
    if (fromId === toId) return;
    const reserveIndices = squad
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.status === "reserve" && !p.disabled)
      .map(({ i }) => i);
    const inOrder = reserveIndices.map(i => squad[i]);
    const fromPos = inOrder.findIndex(p => p.id === fromId);
    const toPos   = inOrder.findIndex(p => p.id === toId);
    const reordered = [...inOrder];
    const [moved] = reordered.splice(fromPos, 1);
    reordered.splice(toPos, 0, moved);
    const newSquad = [...squad];
    reserveIndices.forEach((squadIdx, i) => { newSquad[squadIdx] = reordered[i]; });
    setSquad(newSquad);
  };

  const enableNotifs = async () => {
    const p = await requestNotifPerm();
    setNotifPerm(p);
  };

  const togglePaid = (id) => {
    const nowPaid = !payments[id];
    setPayments(pm => ({ ...pm, [id]:nowPaid }));
    setSquad(squad.map(p => p.id===id ? { ...p, paid:nowPaid, selfPaid:false } : p));
  };

  const cancelWeek = () => {
    setSchedule({ ...schedule, isCancelled:true, gameIsLive:false, cancelReason });
    setMatchHistory([{
      id:"m"+Date.now(),
      date:new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"}),
      dateShort:new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short"}),
      teamA:[], teamB:[], winner:null, scoreA:0, scoreB:0,
      scorers:{}, motm:null, bibHolder:"", payments:{},
      cancelled:true, cancelReason,
    }, ...matchHistory]);
    sendTemplate(notificationTemplates.gameCancelled, cancelReason);
    setShowCancel(false);
    setCancelReason("");
  };

  const draftNextWeek = () => {
    const nextDT = nextWeekDateTime(schedule.gameDateTime);
    setSchedule({ ...schedule, gameDateTime:nextDT, gameIsLive:false, isDraft:true, isCancelled:false, cancelReason:"" });
    setSquad(carryForwardDebts(squad, schedule.pricePerPlayer));
    sendTemplate(notificationTemplates.nextWeekDraft);
  };

  const openNextWeek = () => {
    setSchedule({ ...schedule, gameIsLive:true, isDraft:false, isCancelled:false });
    sendTemplate(notificationTemplates.gameOpen, schedule.dayOfWeek);
  };

  // Route to sub-screens
  if (screen === "teams")    return <TeamsScreen    squad={squad} setSquad={setSquad} schedule={schedule} onBack={() => setScreen("main")}/>;
  if (screen === "score")    return <ScoreScreen    squad={squad} setSquad={setSquad} schedule={schedule} matchHistory={matchHistory} setMatchHistory={setMatchHistory} payments={payments} bibHistory={bibHistory} onBack={() => setScreen("main")} onDraftNext={draftNextWeek}/>;
  if (screen === "bibs")     return <BibsScreen     squad={squad} setSquad={setSquad} bibHistory={bibHistory} setBibHistory={setBibHistory} schedule={schedule} onBack={() => setScreen("main")}/>;
  if (screen === "squad")    return <SquadScreen    squad={squad} setSquad={setSquad} onBack={() => setScreen("main")} teamId={teamId}/>;
  if (screen === "schedule") return <ScheduleScreen schedule={schedule} setSchedule={setSchedule} settings={settings} setSettings={setSettings} onBack={() => setScreen("main")}/>;

  return (
    <div style={{ padding:18 }}>

      {/* Draft ready banner */}
      {schedule.isDraft && (
        <Card color={C.amber} style={{ marginBottom:16 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700, color:C.amber, marginBottom:8 }}>
            📋 Next week drafted — ready to go live
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginBottom:12 }}>
            {schedule.dayOfWeek} · {schedule.kickoff} · £{schedule.pricePerPlayer}/player
          </div>
          <Btn label="🟢 Go Live — Notify Players" color={C.green} fill onClick={openNextWeek}/>
        </Card>
      )}

      {/* Self-pay confirmations */}
      {selfPaidPending.length > 0 && (
        <Card color={C.green} style={{ marginBottom:16 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
            color:C.green, letterSpacing:1, marginBottom:10 }}>💰 PAYMENT CONFIRMATIONS NEEDED</div>
          {selfPaidPending.map(p => (
            <div key={p.id} style={{ display:"flex", alignItems:"center",
              justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.text }}>
                {p.name} says they've paid
              </div>
              <button onClick={() => togglePaid(p.id)} style={{ padding:"5px 12px", borderRadius:4,
                border:"none", background:C.green+"20", color:C.green,
                fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                Confirm ✓
              </button>
            </div>
          ))}
        </Card>
      )}

      {/* Notification permission */}
      {notifPerm !== "granted" && notifPerm !== "unsupported" && (
        <div style={{ background:C.amber+"14", border:`1px solid ${C.amber}40`, borderRadius:8,
          padding:"12px 14px", marginBottom:14,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, color:C.amber }}>
            Enable push notifications
          </span>
          <button onClick={enableNotifs} style={{ padding:"6px 13px", borderRadius:4,
            border:`1px solid ${C.amber}`, background:"transparent", color:C.amber,
            fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
            ENABLE
          </button>
        </div>
      )}
      {notifPerm === "granted" && (
        <div style={{ background:C.green+"10", border:`1px solid ${C.green}30`, borderRadius:6,
          padding:"9px 14px", marginBottom:14,
          fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:500, color:C.green }}>
          ✅ Push notifications active
        </div>
      )}

      {/* Squad summary */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <div style={{ flex:1, padding:"10px 12px", borderRadius:6, background:C.surface,
          border:`1px solid ${inPlayers.length>=(schedule.squadSize||14)?C.green+"50":C.border}`,
          textAlign:"center" }}>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
            color:inPlayers.length>=(schedule.squadSize||14)?C.green:C.amber }}>
            {inPlayers.length}<span style={{ fontSize:14, color:C.muted }}>/{schedule.squadSize||14}</span>
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:10, color:C.muted,
            letterSpacing:1, textTransform:"uppercase" }}>IN</div>
        </div>
        {reservePlayers.length > 0 && (
          <div style={{ flex:1, padding:"10px 12px", borderRadius:6, background:C.surface,
            border:`1px solid ${C.purple}40`, textAlign:"center" }}>
            <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.purple }}>
              {reservePlayers.length}
            </div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:10, color:C.muted,
              letterSpacing:1, textTransform:"uppercase" }}>RESERVE</div>
          </div>
        )}
      </div>

      {/* Reserve list */}
      {reservePlayers.length > 0 && (
        <Card color={C.purple} style={{ marginBottom:16 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
            color:C.purple, letterSpacing:1, marginBottom:4 }}>🟣 RESERVE LIST</div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginBottom:12 }}>
            Drag to reorder — #1 gets notified first when a spot opens
          </div>
          {/* TODO(Stripe session): on spot opening, reserve player has 30 mins to pay to confirm */}
          {reservePlayers.map((p, i) => (
            <div key={p.id}
              draggable
              onDragStart={() => setDragId(p.id)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { moveReserve(dragId, p.id); setDragId(null); }}
              style={{ display:"flex", alignItems:"center", gap:10,
                padding:"11px 0", borderBottom:`1px solid ${C.border}`,
                opacity:dragId===p.id?0.4:1, cursor:"grab" }}>
              <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:18,
                color:C.faint, minWidth:20 }}>{i+1}</div>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.faint,
                marginRight:2, userSelect:"none" }}>⠿</div>
              <div style={{ flex:1, fontFamily:"Inter,sans-serif", fontSize:14,
                fontWeight:500, color:C.purple }}>{p.name}</div>
              {i === 0 && (
                <span style={{ fontFamily:"Inter,sans-serif", fontSize:10, fontWeight:700,
                  padding:"2px 8px", borderRadius:4,
                  background:C.purple+"20", color:C.purple }}>Next</span>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Action grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
        {[
          { icon:"📨", label:"Send Reminder",  color:C.blue,    action:() => sendTemplate(notificationTemplates.gameOpen, schedule.dayOfWeek) },
          { icon:"👥", label:"Manage Squad",   color:C.green,   action:() => setScreen("squad") },
          { icon:"⚽", label:"Input Result",   color:C.amber,   action:() => setScreen("score") },
          { icon:"🟡", label:"Bibs Tracker",  color:"#F59E0B", action:() => setScreen("bibs")  },
          { icon:"⚙️", label:"Settings",       color:C.purple,  action:() => setScreen("schedule") },
          { icon:"👕", label:"Pick Teams",     color:C.blue,    action:() => setScreen("teams") },
        ].map(({ icon, label, color, action }) => (
          <button key={label} onClick={action} style={{
            padding:"14px 8px", borderRadius:6, background:C.surface,
            border:`1px solid ${color}30`, color, fontSize:11, cursor:"pointer",
            fontFamily:"Inter,sans-serif", fontWeight:700,
            display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:24 }}>{icon}</span>{label}
          </button>
        ))}
      </div>

      {/* Cancel this week */}
      {!schedule.isCancelled && (
        <div style={{ marginBottom:16 }}>
          {!showCancel
            ? <button onClick={() => setShowCancel(true)} style={{ width:"100%", padding:"11px 14px",
                borderRadius:6, border:`1px solid ${C.border}`, background:C.surface,
                color:C.red, fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:600,
                cursor:"pointer", textAlign:"left" }}>❌ Cancel This Week's Game</button>
            : <Card color={C.red}>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700, color:C.red, marginBottom:10 }}>
                  Cancel this week?
                </div>
                <input value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  placeholder="Reason (e.g. Venue unavailable)"
                  style={{ width:"100%", padding:"10px 12px", borderRadius:6,
                    border:`1px solid ${C.border}`, background:"#0a0a0a", color:C.text,
                    fontFamily:"Inter,sans-serif", fontSize:13, outline:"none",
                    boxSizing:"border-box", marginBottom:10 }}/>
                <div style={{ display:"flex", gap:8 }}>
                  <Btn label="Confirm Cancel" color={C.red}   fill onClick={cancelWeek} small block/>
                  <Btn label="Back"           color={C.muted}      onClick={() => setShowCancel(false)} small block/>
                </div>
              </Card>
          }
        </div>
      )}

      {/* Notification shortcuts */}
      <SecTitle>Notification Shortcuts</SecTitle>
      {[
        { label:"🟢 Game open — notify all",           action:() => sendTemplate(notificationTemplates.gameOpen, schedule.dayOfWeek) },
        { label:"★ Priority ping — first picks",        action:() => sendTemplate(notificationTemplates.priorityPing) },
        { label:"⚠️ Slots available — notify maybes",  action:() => sendTemplate(notificationTemplates.slotsAvailable) },
        { label:"✅ Squad full — notify all",           action:() => sendTemplate(notificationTemplates.squadFull, schedule.dayOfWeek) },
        { label:"👕 Teams confirmed — notify all",      action:() => sendTemplate(notificationTemplates.teamsConfirmed) },
        { label:"📣 Bulk notify cover pool",            action:() => coverPool.forEach(p => sendTemplate(notificationTemplates.coverNeeded, p.name)) },
      ].map(({ label, action }) => (
        <button key={label} onClick={action} style={{ width:"100%", padding:"11px 14px",
          borderRadius:6, border:`1px solid ${C.border}`, background:C.surface, color:C.text,
          fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, cursor:"pointer",
          textAlign:"left", marginBottom:8 }}>
          {label}
        </button>
      ))}

      {/* Schedule summary card */}
      <Card color={C.border} onClick={() => setScreen("schedule")} style={{ marginTop:8 }}>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
          color:C.purple, letterSpacing:1, textTransform:"uppercase" }}>⚙️ Schedule & Settings</div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, color:C.text, marginTop:4 }}>
          {schedule.dayOfWeek} {schedule.kickoff} · Opens {schedule.opensDay} {schedule.opensTime}
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginTop:2 }}>
          £{schedule.pricePerPlayer}/player · {schedule.squadSize} needed · {schedule.priorityLeadMins}min priority
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.purple, marginTop:4 }}>Edit →</div>
      </Card>

      {/* Bibs card */}
      <Card color={C.border} onClick={() => setScreen("bibs")}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
              color:C.amber, letterSpacing:1, textTransform:"uppercase" }}>🟡 Bibs</div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, color:C.text, marginTop:4 }}>
              {bibHistory[0]?.returned===false ? `${bibHistory[0].name} has them` : "All returned ✅"}
            </div>
          </div>
          <span style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.amber }}>Manage →</span>
        </div>
      </Card>

      {/* Payments */}
      <SecTitle color={C.muted}>💰 Payments — £{schedule.pricePerPlayer}/player</SecTitle>
      {inPlayers.length === 0 && (
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted, padding:"10px 0" }}>
          No confirmed players yet.
        </div>
      )}
      {inPlayers.length > 0 && (
        <button onClick={() => {
          const allPaid = Object.fromEntries(inPlayers.map(p => [p.id, true]));
          setPayments(pm => ({ ...pm, ...allPaid }));
          setSquad(squad.map(p => inPlayers.find(ip => ip.id===p.id) ? { ...p, paid:true, selfPaid:false } : p));
        }} style={{ width:"100%", padding:"10px 0", borderRadius:6, marginBottom:12,
          border:`1px solid ${C.green}`, background:C.green+"12", color:C.green,
          fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, cursor:"pointer" }}>
          ✅ Mark All Paid
        </button>
      )}
      {inPlayers.map(p => (
        <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10,
          padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500,
              color:C.text, display:"flex", alignItems:"center", gap:6 }}>
              {p.name}
              {p.selfPaid && !p.paid && (
                <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:4,
                  background:C.amber+"20", color:C.amber }}>self-paid</span>
              )}
            </div>
            {p.owes > 0 && (
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.red, marginTop:2 }}>
                Owes £{p.owes} from before
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {p.owes > 0 && (
              <button onClick={() => {
                setSquad(squad.map(s => s.id===p.id ? { ...s, owes:0 } : s));
              }} style={{ padding:"7px 10px", borderRadius:5, border:`1px solid ${C.amber}`,
                background:C.amber+"12", color:C.amber,
                fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                Clear Debt
              </button>
            )}
            <button onClick={() => togglePaid(p.id)} style={{ padding:"7px 14px", borderRadius:5,
              border:"none", cursor:"pointer",
              background:payments[p.id]?C.green+"20":C.red+"20",
              color:payments[p.id]?C.green:C.red,
              fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700 }}>
              {payments[p.id] ? "✅ Paid" : "Mark Paid"}
            </button>
          </div>
        </div>
      ))}

      {/* Outstanding debts — players not in this week's game */}
      {(() => {
        const debtors = squad.filter(p => !p.disabled && p.owes > 0 && p.status !== "in");
        if (!debtors.length) return null;
        return (
          <>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
              color:C.red, letterSpacing:1, textTransform:"uppercase",
              margin:"20px 0 10px" }}>
              💸 Outstanding Debts
            </div>
            {debtors.map(p => (
              <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10,
                padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
                    fontWeight:500, color:C.text }}>{p.name}</div>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:12,
                    color:C.red, marginTop:2 }}>Owes £{p.owes}</div>
                </div>
                <button onClick={() => {
                  setSquad(squad.map(s => s.id===p.id ? { ...s, owes:0 } : s));
                }} style={{ padding:"7px 12px", borderRadius:5,
                  border:`1px solid ${C.amber}`, background:C.amber+"12", color:C.amber,
                  fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  Clear Debt
                </button>
              </div>
            ))}
          </>
        );
      })()}

      {/* Cover pool */}
      <CoverPoolSection
        coverPool={coverPool}
        setCoverPool={setCoverPool}
        teamId={teamId}
      />

      {/* Bottom padding */}
      <div style={{ height:32 }}/>
    </div>
  );
}
