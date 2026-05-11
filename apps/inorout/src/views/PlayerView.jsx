import { useState } from "react";
import { colors as C, groupByStatus, isLateDropout, sendTemplate, notificationTemplates } from "@platform/core";
import { savePushSubscription, addGuestPlayer, deletePlayer } from "@platform/supabase";
import { Card, Badge, Btn } from "@platform/ui";

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const b   = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b).split('').map(c => c.charCodeAt(0)));
}

function notifyServer(type, teamId, playerIds, payload, gameDate) {
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, teamId, playerIds, payload, gameDate }),
  }).catch(console.error);
}

export default function PlayerView({ squad, setSquad, myId, teamId, schedule }) {
  const me = squad.find(p => p.id === myId);
  const [note, setNote]         = useState(me?.note || "");
  const [showNote, setShowNote] = useState(false);
  const [notifState, setNotifState] = useState(
    () => (typeof localStorage !== "undefined" && localStorage.getItem(`notif_${myId}`)) || "idle"
  );

  // Plus one state
  const [showPlusOneForm, setShowPlusOneForm] = useState(false);
  const [guestName,       setGuestName]       = useState("");
  const [guestSelfPaid,   setGuestSelfPaid]   = useState(false);
  const [addingGuest,     setAddingGuest]     = useState(false);
  const [pickerPlayer,    setPickerPlayer]    = useState(null);
  const [removingGuest,   setRemovingGuest]   = useState(false);

  const SC = { in:C.green, maybe:C.amber, out:C.red, reserve:C.purple, none:C.muted };

  const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const canPush = "PushManager" in window && "serviceWorker" in navigator && (!isIOS || isStandalone);

  const myGuest = squad.find(p => p.isGuest && p.guestOf === myId);
  // Can remove guest until next week is drafted (i.e., result not yet saved)
  const canRemoveGuest = !schedule.isDraft;

  const handleSubscribe = async () => {
    setNotifState("asking");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        localStorage.setItem(`notif_${myId}`, "denied");
        setNotifState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
      });
      await savePushSubscription(myId, teamId, sub.toJSON(), me?.token);
      localStorage.setItem(`notif_${myId}`, "subscribed");
      setNotifState("subscribed");
    } catch(e) {
      console.error("Push subscribe failed:", e);
      setNotifState("idle");
    }
  };

  const setStatus = (s) => {
    const late = isLateDropout(me?.status, s, schedule.gameDateTime);
    if (late) sendTemplate(notificationTemplates.lateDropout, me?.name);
    setSquad(squad.map(p => p.id === myId
      ? { ...p, status:s, note, lateDropouts:(p.lateDropouts||0)+(late?1:0) }
      : p
    ));

    if (!teamId) return;
    const gameDate = schedule.gameDateTime?.split("T")[0];

    if (me?.status === "in" && s !== "in") {
      const reserves = squad.filter(p => p.status === "reserve" && !p.disabled);
      if (reserves.length) {
        const hoursToKick = schedule.gameDateTime
          ? (new Date(schedule.gameDateTime) - new Date()) / 3600000
          : Infinity;
        const toNotify = hoursToKick < 24 ? reserves : [reserves[0]];
        notifyServer("spotOpened", teamId, toNotify.map(p => p.id), {
          title: "In or Out ⚽",
          body: `🟣 A spot's opened up for ${schedule.dayOfWeek} — tap to claim it!`,
          icon: "/icons/icon-192.png",
        }, gameDate);
      }
    }

    if (s === "in" && me?.status !== "in") {
      const currentInCount = inPlayers.length;
      const willBeFull     = currentInCount + 1 >= (schedule.squadSize || 14);
      if (willBeFull) {
        const toNotify = squad.filter(p => p.id !== myId && p.status !== "in" && !p.disabled);
        notifyServer("squadFull", teamId, toNotify.map(p => p.id), {
          title: "In or Out ⚽",
          body: "🔒 Squad's full! Get on the reserve list before it's too late.",
          icon: "/icons/icon-192.png",
        }, gameDate);
      }
    }
  };

  const saveNote = () => {
    setSquad(squad.map(p => p.id === myId ? { ...p, note } : p));
    setShowNote(false);
  };

  const markSelfPaid = () => {
    setSquad(squad.map(p => p.id === myId ? { ...p, selfPaid:true } : p));
    sendTemplate(notificationTemplates.gameOpen, schedule.dayOfWeek);
  };

  const handleGuestNameChange = (val) => {
    setGuestName(val);
    if (val.trim().length >= 2) {
      const match = squad.find(p => !p.isGuest && !p.disabled && p.id !== myId &&
        p.name.toLowerCase().startsWith(val.toLowerCase().trim()));
      setPickerPlayer(match || null);
    } else {
      setPickerPlayer(null);
    }
  };

  const submitGuest = async () => {
    if (!guestName.trim() || addingGuest) return;
    setAddingGuest(true);
    try {
      const guest = await addGuestPlayer(myId, guestName.trim(), teamId, guestSelfPaid);
      setSquad([...squad, guest]);
      setGuestName("");
      setGuestSelfPaid(false);
      setPickerPlayer(null);
      setShowPlusOneForm(false);
    } catch(e) {
      console.error("Failed to add guest:", e);
    } finally {
      setAddingGuest(false);
    }
  };

  const confirmExistingPlayer = () => {
    if (!pickerPlayer) return;
    setSquad(squad.map(p => p.id === pickerPlayer.id ? { ...p, status: "in" } : p));
    setGuestName("");
    setPickerPlayer(null);
    setShowPlusOneForm(false);
  };

  const removeMyGuest = async () => {
    if (!myGuest || removingGuest) return;
    setRemovingGuest(true);
    try {
      await deletePlayer(myGuest.id);
      setSquad(squad.filter(p => p.id !== myGuest.id));
    } catch(e) {
      console.error("Failed to remove guest:", e);
    } finally {
      setRemovingGuest(false);
    }
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
      {/* Debt banner */}
      {me?.owes > 0 && (
        <div style={{ padding:"12px 16px", borderRadius:8, marginBottom:14,
          background:C.red+"14", border:`1px solid ${C.red}40`,
          fontFamily:"Inter,sans-serif" }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.red, marginBottom:2 }}>
            💸 You owe £{me.owes}
          </div>
          <div style={{ fontSize:12, color:C.muted }}>
            {/* TODO(Stripe session): link to payment flow */}
            See the balance section below to sort it
          </div>
        </div>
      )}

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
                    {p.isGuest && <span style={{ fontSize:11 }}>👤</span>}
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
              {p.isGuest && <span style={{ fontSize:11 }}>👤</span>}
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
            <button onClick={() => !isFull && setStatus("in")} style={{
              flex:1, padding:"14px 0", borderRadius:6,
              border:`2px solid ${me?.status==="in" ? C.green : isFull ? C.faint : C.border}`,
              background:me?.status==="in" ? C.green+"18" : "transparent",
              color:me?.status==="in" ? C.green : isFull ? C.faint : C.muted,
              fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700,
              cursor:isFull && me?.status!=="in" ? "not-allowed" : "pointer",
              opacity:isFull && me?.status!=="in" ? 0.4 : 1 }}>
              ✅ I'M IN
            </button>
            <button onClick={() => setStatus("out")} style={{
              flex:1, padding:"14px 0", borderRadius:6,
              border:`2px solid ${me?.status==="out" ? C.red : C.border}`,
              background:me?.status==="out" ? C.red+"18" : "transparent",
              color:me?.status==="out" ? C.red : C.muted,
              fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, cursor:"pointer" }}>
              ❌ I'M OUT
            </button>
          </div>
          <button onClick={() => !isFull && setStatus("maybe")} style={{
            width:"100%", padding:"12px 0", borderRadius:6, marginBottom:8,
            border:`2px solid ${me?.status==="maybe" ? C.amber : isFull ? C.faint : C.border}`,
            background:me?.status==="maybe" ? C.amber+"18" : "transparent",
            color:me?.status==="maybe" ? C.amber : isFull ? C.faint : C.muted,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700,
            cursor:isFull && me?.status!=="maybe" ? "not-allowed" : "pointer",
            opacity:isFull && me?.status!=="maybe" ? 0.4 : 1 }}>
            ❓ MAYBE — I'll try
          </button>
          {isFull && me?.status !== "in" && (
            <div style={{ padding:"8px 12px", borderRadius:6, marginBottom:8, textAlign:"center",
              background:C.amber+"12", border:`1px solid ${C.amber}30`,
              fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, color:C.amber }}>
              🔒 Squad is full — join the reserve list
            </div>
          )}
          <button onClick={() => setStatus("reserve")} style={{
            width:"100%", padding:"12px 0", borderRadius:6, marginBottom:10,
            border:`2px solid ${me?.status==="reserve" ? C.purple : C.border}`,
            background:me?.status==="reserve" ? C.purple+"18" : "transparent",
            color:me?.status==="reserve" ? C.purple : C.muted,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700, cursor:"pointer" }}>
            🟣 RESERVE — add me to the list
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
              {me.status==="in"      ? `Locked in 👊 See you ${schedule.dayOfWeek}`
               : me.status==="maybe"   ? "Got it — we'll keep a spot open 🤞"
               : me.status==="reserve" ? "You're on the reserve list — we'll let you know if a spot opens 🟣"
               : "No worries, we'll find cover 👍"}
            </div>
          )}

          {/* Push subscription prompt — show once after first status set */}
          {me?.status && me.status !== "none" && canPush && notifState === "idle" && (
            <div style={{ marginTop:10, padding:"10px 12px", borderRadius:6,
              background:C.blue+"0c", border:`1px solid ${C.blue}25`,
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <span style={{ fontFamily:"Inter,sans-serif", fontSize:12,
                fontWeight:500, color:C.blue }}>
                🔔 Get notified for game updates
              </span>
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <button onClick={handleSubscribe} style={{ padding:"5px 11px", borderRadius:4,
                  border:`1px solid ${C.blue}`, background:C.blue+"18", color:C.blue,
                  fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  {notifState === "asking" ? "..." : "Enable"}
                </button>
                <button onClick={() => {
                  localStorage.setItem(`notif_${myId}`, "dismissed");
                  setNotifState("dismissed");
                }} style={{ padding:"5px 11px", borderRadius:4,
                  border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                  fontFamily:"Inter,sans-serif", fontSize:11, cursor:"pointer" }}>
                  Not now
                </button>
              </div>
            </div>
          )}
          {notifState === "subscribed" && (
            <div style={{ marginTop:8, fontFamily:"Inter,sans-serif", fontSize:12,
              color:C.green, textAlign:"center" }}>
              ✅ Notifications on
            </div>
          )}
        </Card>
      )}

      {/* Plus One section */}
      {schedule.gameIsLive && (
        <div style={{ marginBottom:20 }}>
          {myGuest ? (
            <div style={{ padding:"12px 14px", borderRadius:8,
              background:C.muted+"0c", border:`1px solid ${C.border}` }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:600, color:C.text }}>
                    👤 {myGuest.name} <span style={{ color:C.muted, fontWeight:400 }}>— your plus one</span>
                  </div>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginTop:2 }}>
                    {myGuest.selfPaid ? "Paying cash" : "You're covering payment"}
                  </div>
                </div>
                {canRemoveGuest && (
                  <button onClick={removeMyGuest} disabled={removingGuest}
                    style={{ padding:"5px 11px", borderRadius:4,
                      border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                      fontFamily:"Inter,sans-serif", fontSize:11, cursor:"pointer" }}>
                    {removingGuest ? "..." : "Remove"}
                  </button>
                )}
              </div>
            </div>
          ) : showPlusOneForm ? (
            <div style={{ padding:"14px 16px", borderRadius:8,
              background:C.surface, border:`1px solid ${C.border}` }}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700,
                color:C.text, marginBottom:12 }}>➕ Add a plus one</div>

              <input value={guestName} onChange={e => handleGuestNameChange(e.target.value)}
                placeholder="Guest's name..."
                style={{ width:"100%", padding:"11px 13px", borderRadius:6,
                  marginBottom: pickerPlayer ? 8 : 12,
                  border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
                  fontFamily:"Inter,sans-serif", fontSize:14, outline:"none",
                  boxSizing:"border-box" }}/>
              {pickerPlayer && (
                <div style={{ padding:"10px 12px", borderRadius:6, marginBottom:12,
                  background:C.amber+"0c", border:`1px solid ${C.amber}40`,
                  display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                  <span style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.amber }}>
                    Is this {pickerPlayer.name} (already on the team)?
                  </span>
                  <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                    <button onClick={confirmExistingPlayer} style={{ padding:"5px 11px", borderRadius:4,
                      border:`1px solid ${C.green}`, background:C.green+"18", color:C.green,
                      fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                      Yes
                    </button>
                    <button onClick={() => setPickerPlayer(null)} style={{ padding:"5px 11px",
                      borderRadius:4, border:`1px solid ${C.border}`, background:"transparent",
                      color:C.muted, fontFamily:"Inter,sans-serif", fontSize:11, cursor:"pointer" }}>
                      No
                    </button>
                  </div>
                </div>
              )}

              {/* Payment toggle */}
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                {[
                  { label:`${me?.name} pays`, value:false },
                  { label:"They pay", value:true },
                ].map(opt => (
                  <button key={String(opt.value)} onClick={() => setGuestSelfPaid(opt.value)} style={{
                    flex:1, padding:"9px 0", borderRadius:5,
                    border:`1.5px solid ${guestSelfPaid===opt.value ? C.amber : C.border}`,
                    background:guestSelfPaid===opt.value ? C.amber+"18" : "transparent",
                    color:guestSelfPaid===opt.value ? C.amber : C.muted,
                    fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                    {opt.label}
                  </button>
                ))}
              </div>

              <div style={{ display:"flex", gap:8 }}>
                <Btn label={addingGuest ? "Adding..." : "Add Plus One"} color={C.green} fill
                  onClick={submitGuest} disabled={!guestName.trim() || addingGuest} small block/>
                <Btn label="Cancel" color={C.muted}
                  onClick={() => { setShowPlusOneForm(false); setGuestName(""); setPickerPlayer(null); }}
                  small block/>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowPlusOneForm(true)} style={{
              width:"100%", padding:"11px 14px", borderRadius:6,
              border:`1px solid ${C.border}`, background:C.surface,
              color:C.muted, fontFamily:"Inter,sans-serif", fontSize:13,
              fontWeight:600, cursor:"pointer", textAlign:"left" }}>
              ➕ Add a plus one
            </button>
          )}
        </div>
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
                  {groups[k].map(p => {
                    const hostName = p.isGuest ? squad.find(h => h.id === p.guestOf)?.name : null;
                    return (
                      <div key={p.id} style={{ padding:"5px 12px", borderRadius:4,
                        background:color+"14", border:`1px solid ${color}40`,
                        fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, color,
                        display:"flex", flexDirection:"column", gap:2 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                          {p.name}
                          {p.isGuest && <span style={{ fontSize:11 }}>👤</span>}
                        </div>
                        {p.isGuest && hostName && (
                          <div style={{ fontSize:10, color:color+"99" }}>guest of {hostName}</div>
                        )}
                        {p.note && (
                          <div style={{ fontSize:10, color:C.muted, fontStyle:"italic" }}>
                            "{p.note}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}
          {groups.reserve?.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color:C.purple,
                letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
                🟣 RESERVE ({groups.reserve.length})
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {groups.reserve.map((p, i) => (
                  <div key={p.id} style={{ padding:"5px 12px", borderRadius:4,
                    background:C.purple+"14", border:`1px solid ${C.purple}40`,
                    fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:500, color:C.purple,
                    display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:11, color:C.faint }}>{i+1}.</span>
                    {p.name}{p.id===myId && <Badge text="you" color={C.purple}/>}
                  </div>
                ))}
              </div>
            </div>
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
