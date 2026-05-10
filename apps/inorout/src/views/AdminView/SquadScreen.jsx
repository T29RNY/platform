import { useState } from "react";
import { colors as C, newPlayer } from "@platform/core";
import { resetPlayerToken } from "@platform/supabase";
import { BackBtn, Btn, SecTitle, Card, Toggle, Badge, CopyBtn } from "@platform/ui";

export default function SquadScreen({ squad, setSquad, onBack, teamId }) {
  const [name,       setName]       = useState("");
  const [type,       setType]       = useState("regular");
  const [priority,   setPriority]   = useState(false);
  const [deputy,     setDeputy]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [resetState, setResetState] = useState({}); // { [playerId]: 'confirming'|'loading'|'done' }

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

  return (
    <div style={{ padding:18 }}>
      <BackBtn onClick={onBack}/>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber, letterSpacing:2, marginBottom:18 }}>
        MANAGE SQUAD
      </div>

      {/* Invite link */}
      {teamId && (
        <div style={{ background:C.green+"0f", border:`1px solid ${C.green}33`,
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
              {p.name}
            </span>
            {p.type==="guest" && <Badge text="guest"   color={C.muted}/>}
            {p.priority       && <Badge text="★"       color={C.purple}/>}
            {p.deputy         && <Badge text="deputy"  color={C.blue}/>}
            {p.disabled       && <Badge text="disabled"color={C.red}/>}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:9 }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:"#2e2e2e", flex:1 }}>
              🔗 in-or-out.com/p/{p.token || p.id}
            </div>
            <CopyBtn text={`https://in-or-out.com/p/${p.token || p.id}`}/>
          </div>
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
            {resetState[p.id] === "loading" ? (
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
            ) : null}
          </div>
          {resetState[p.id] === "confirming" && (
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
    </div>
  );
}
