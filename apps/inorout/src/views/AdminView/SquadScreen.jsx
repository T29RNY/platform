import { useState } from "react";
import { colors as C, newPlayer } from "@platform/core";
import { resetPlayerToken, deletePlayer as removePlayerFromDb } from "@platform/supabase";
import { BackBtn, Btn, SecTitle, Card, Toggle, Badge, CopyBtn } from "@platform/ui";

export default function SquadScreen({ squad, setSquad, onBack, teamId }) {
  const [name,             setName]             = useState("");
  const [type,             setType]             = useState("regular");
  const [priority,         setPriority]         = useState(false);
  const [deputy,           setDeputy]           = useState(false);
  const [confirmDel,       setConfirmDel]       = useState(null);
  const [resetState,       setResetState]       = useState({});
  const [injuryToast,      setInjuryToast]      = useState(null);
  const [guestPrompt,      setGuestPrompt]      = useState(null); // { guestId, guestName, hostName }

  const resetToken = async (playerId) => {
    setResetState(s => ({ ...s, [playerId]: "loading" }));
    try {
      const newToken = await resetPlayerToken(playerId);
      setSquad(squad.map(p => p.id === playerId ? { ...p, token: newToken } : p));
      setResetState(s => ({ ...s, [playerId]: "done" }));
      setTimeout(() => setResetState(s => ({ ...s, [playerId]: null })), 5000);
    } catch(e) {
      console.error(e);
      setResetState(s => ({ ...s, [playerId]: null }));
    }
  };

  const addPlayer = () => {
    if (!name.trim()) return;
    setSquad([...squad, newPlayer(name, type, { priority, deputy })]);
    setName(""); setPriority(false); setDeputy(false);
  };

  const toggleDisable  = id => setSquad(squad.map(p => p.id===id ? { ...p, disabled:!p.disabled } : p));
  const togglePriority = id => setSquad(squad.map(p => p.id===id ? { ...p, priority:!p.priority } : p));
  const toggleDeputy   = id => setSquad(squad.map(p => p.id===id ? { ...p, deputy:!p.deputy }   : p));
  const deletePlayer   = id => { setSquad(squad.filter(p => p.id!==id)); setConfirmDel(null); };

  const toggleInjured = (playerId) => {
    const player = squad.find(p => p.id === playerId);
    if (!player) return;
    const newInjured = !player.injured;
    const autoOut    = newInjured && ["in", "reserve", "maybe"].includes(player.status);
    setSquad(squad.map(p => p.id === playerId
      ? { ...p, injured: newInjured, status: autoOut ? "out" : p.status }
      : p
    ));
    if (autoOut) {
      setInjuryToast(`${player.name} set to OUT — marked as injured`);
      setTimeout(() => setInjuryToast(null), 4000);
    }
    if (newInjured) {
      const guest = squad.find(g => g.isGuest && g.guestOf === playerId && g.status !== "out");
      if (guest) setGuestPrompt({ guestId: guest.id, guestName: guest.name, hostName: player.name });
    }
  };

  const keepGuest   = () => setGuestPrompt(null);
  const removeGuest = async () => {
    if (!guestPrompt) return;
    try {
      await removePlayerFromDb(guestPrompt.guestId);
      setSquad(squad.filter(p => p.id !== guestPrompt.guestId));
    } catch(e) { console.error(e); }
    setGuestPrompt(null);
  };

  return (
    <div style={{ padding:18 }}>
      <BackBtn onClick={onBack}/>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber, letterSpacing:2, marginBottom:18 }}>
        MANAGE SQUAD
      </div>

      {/* Injury toast */}
      {injuryToast && (
        <div style={{ padding:"10px 14px", borderRadius:6, marginBottom:14,
          background:C.red+"12", border:`1px solid ${C.red}30`,
          fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, color:C.red }}>
          🤕 {injuryToast}
        </div>
      )}

      {/* Guest prompt when host is marked injured */}
      {guestPrompt && (
        <Card color={C.amber} style={{ marginBottom:16 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700,
            color:C.amber, marginBottom:4 }}>
            👤 {guestPrompt.hostName} is now injured
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginBottom:12 }}>
            Keep {guestPrompt.guestName} in the game?
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={keepGuest} style={{ padding:"7px 16px", borderRadius:5,
              border:`1px solid ${C.green}`, background:C.green+"18", color:C.green,
              fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              Yes, keep them
            </button>
            <button onClick={removeGuest} style={{ padding:"7px 16px", borderRadius:5,
              border:`1px solid ${C.red}`, background:C.red+"18", color:C.red,
              fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              Remove {guestPrompt.guestName}
            </button>
          </div>
        </Card>
      )}

      {/* Invite link */}
      {teamId && (
        <div data-gaffer-target="invite-link"
          style={{ background:C.green+"0f", border:`1px solid ${C.green}33`,
          borderRadius:8, padding:14, marginBottom:20 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
            color:C.green, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>
            🔗 Player Invite Link
          </div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted,
            marginBottom:10 }}>
            Share this — players tap it, enter their name, get their personal link instantly.
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ flex:1, fontFamily:"Inter,sans-serif", fontSize:11,
              color:C.text, background:"#0a0a0a", padding:"8px 10px",
              borderRadius:5, border:`1px solid ${C.border}`,
              wordBreak:"break-all" }}>
              in-or-out.com/join/{teamId}
            </div>
            <CopyBtn text={`https://in-or-out.com/join/${teamId}`}/>
          </div>
        </div>
      )}

      <Card>
        <SecTitle color={C.green}>Add Player</SecTitle>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Player name..."
          style={{ width:"100%", padding:"11px 13px", borderRadius:6,
            border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
            fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500,
            outline:"none", boxSizing:"border-box", marginBottom:12 }}/>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
          {["regular","guest"].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              padding:"7px 14px", borderRadius:5,
              border:`1.5px solid ${type===t?C.amber:C.border}`,
              background:type===t?C.amber+"18":"transparent",
              color:type===t?C.amber:C.muted,
              fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700,
              letterSpacing:0.5, textTransform:"uppercase", cursor:"pointer" }}>{t}</button>
          ))}
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, color:C.muted }}>★</span>
            <Toggle on={priority} onChange={() => setPriority(!priority)} color={C.purple}/>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600, color:C.muted }}>Deputy</span>
            <Toggle on={deputy} onChange={() => setDeputy(!deputy)} color={C.blue}/>
          </div>
        </div>
        <Btn label="Add to Squad" color={C.amber} fill onClick={addPlayer} disabled={!name.trim()}/>
      </Card>

      <SecTitle>Squad ({squad.length})</SecTitle>
      {squad.map(p => (
        <div key={p.id} style={{ padding:"13px 0", borderBottom:`1px solid ${C.border}`, opacity:p.disabled?0.4:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6, flexWrap:"wrap" }}>
            <span style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:600, color:C.text, flex:1 }}>
              {p.nickname || p.name}
            </span>
            {p.type==="guest" && <Badge text="guest"   color={C.muted}/>}
            {p.injured        && <Badge text="🤕"      color={C.red}/>}
            {p.priority       && <Badge text="★"       color={C.purple}/>}
            {p.deputy         && <Badge text="deputy"  color={C.blue}/>}
            {p.disabled       && <Badge text="disabled"color={C.red}/>}
          </div>
          {!p.isGuest && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:9 }}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:"#2e2e2e", flex:1 }}>
                🔗 in-or-out.com/p/{p.token || p.id}
              </div>
              <CopyBtn text={`https://in-or-out.com/p/${p.token || p.id}`}/>
            </div>
          )}
          {p.isGuest && (() => {
            const host = squad.find(h => h.id === p.guestOf);
            return host ? (
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginBottom:9 }}>
                👤 plus one — guest of {host.nickname || host.name}
              </div>
            ) : null;
          })()}
          {resetState[p.id] === "done" && (
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.green,
              padding:"6px 10px", borderRadius:5, background:C.green+"14", marginBottom:8 }}>
              ✓ Link reset — old link no longer works
            </div>
          )}
          <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
            <button onClick={() => togglePriority(p.id)} style={{ padding:"5px 11px", borderRadius:4,
              border:`1px solid ${p.priority?C.purple:C.border}`,
              background:p.priority?C.purple+"18":"transparent",
              color:p.priority?C.purple:C.muted,
              fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
              {p.priority?"★ Priority":"☆ Priority"}
            </button>
            <button onClick={() => toggleDeputy(p.id)} style={{ padding:"5px 11px", borderRadius:4,
              border:`1px solid ${p.deputy?C.blue:C.border}`,
              background:p.deputy?C.blue+"18":"transparent",
              color:p.deputy?C.blue:C.muted,
              fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
              {p.deputy?"Deputy ✓":"Deputy"}
            </button>
            <button onClick={() => toggleInjured(p.id)} style={{ padding:"5px 11px", borderRadius:4,
              border:`1px solid ${p.injured?C.red:C.border}`,
              background:p.injured?C.red+"18":"transparent",
              color:p.injured?C.red:C.muted,
              fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
              {p.injured?"🤕 Clear injury":"🤕 Injure"}
            </button>
            <button onClick={() => toggleDisable(p.id)} style={{ padding:"5px 11px", borderRadius:4,
              border:`1px solid ${p.disabled?C.green:C.amber}`,
              background:"transparent", color:p.disabled?C.green:C.amber,
              fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
              {p.disabled?"Enable":"Disable"}
            </button>
            {confirmDel === p.id ? (
              <>
                <button onClick={() => deletePlayer(p.id)} style={{ padding:"5px 11px", borderRadius:4,
                  border:`1px solid ${C.red}`, background:C.red+"18", color:C.red,
                  fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  Confirm Delete
                </button>
                <button onClick={() => setConfirmDel(null)} style={{ padding:"5px 11px", borderRadius:4,
                  border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                  fontFamily:"Inter,sans-serif", fontSize:11, cursor:"pointer" }}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirmDel(p.id)} style={{ padding:"5px 11px", borderRadius:4,
                border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                Delete
              </button>
            )}
            {!p.isGuest && (resetState[p.id] === "loading" ? (
              <button disabled style={{ padding:"5px 11px", borderRadius:4,
                border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                fontFamily:"Inter,sans-serif", fontSize:11, cursor:"not-allowed" }}>
                Resetting...
              </button>
            ) : !resetState[p.id] ? (
              <button onClick={() => setResetState(s => ({ ...s, [p.id]: "confirming" }))}
                style={{ padding:"5px 11px", borderRadius:4,
                  border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                  fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                Reset Link
              </button>
            ) : null)}
          </div>
          {!p.isGuest && resetState[p.id] === "confirming" && (
            <div style={{ marginTop:8, padding:"10px 12px", borderRadius:5,
              border:`1px solid ${C.amber}44`, background:C.amber+"0a" }}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.amber, marginBottom:8 }}>
                ⚠️ Old link stops working immediately. Share the new one with the player.
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => resetToken(p.id)} style={{ padding:"5px 11px", borderRadius:4,
                  border:`1px solid ${C.amber}`, background:C.amber+"18", color:C.amber,
                  fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  Confirm Reset
                </button>
                <button onClick={() => setResetState(s => ({ ...s, [p.id]: null }))}
                  style={{ padding:"5px 11px", borderRadius:4,
                    border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                    fontFamily:"Inter,sans-serif", fontSize:11, cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button onClick={onBack} style={{
        width: "100%", padding: "16px 0", borderRadius: 12, border: "none",
        background: "var(--gold)", color: "#0A0A08",
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.1em",
        cursor: "pointer", marginTop: 24,
      }}>
        DONE
      </button>
    </div>
  );
}
