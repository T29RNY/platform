import { useState } from "react";
import { Check, X, Question, ArrowDown, UserPlus } from "@phosphor-icons/react";
import { adminSetPlayerStatus, addGuestPlayer } from "@platform/core/storage/supabase.js";
import StatusButton from "../components/ui/StatusButton.jsx";

// Admin quick-action sheet — opened from the My View board when an admin taps
// another player's avatar. Deliberately tiny: set their availability + add a
// guest for them. Heavier admin tooling (rename, link reset, remove) stays in
// the full Admin-side PlayerProfile.
//
// Status writes go through admin_set_player_status (soft everywhere as of
// mig 380 — the player can always override their own status afterwards). After
// a successful write we push the affected player a notification naming the
// admin ("Sam marked you in 👊").
export default function AdminPlayerActionSheet({
  player, squad, setSquad, adminToken, teamId, schedule, settings, adminName, onClose,
}) {
  const [saving,      setSaving]      = useState(false);
  const [addingGuest, setAddingGuest] = useState(false);
  const [guestName,   setGuestName]   = useState("");
  const [err,         setErr]         = useState(null);

  const name     = player?.nickname || player?.name || "player";
  const gameDate = schedule?.gameDateTime?.split("T")[0];

  const pushBody = (s) => {
    const verb =
      s === "in"      ? "marked you in 👊"   :
      s === "out"     ? "marked you out"     :
      s === "maybe"   ? "set you to maybe"   :
      s === "reserve" ? "moved you to the reserves" :
                        "updated your status";
    return `${adminName || "Your admin"} ${verb}`;
  };

  const setStatus = async (s) => {
    if (saving || player?.status === s) { if (player?.status === s) onClose(); return; }
    setSaving(true);
    setErr(null);
    const prev = squad;
    setSquad(squad.map(p => p.id === player.id ? { ...p, status: s, adminLockedIn: false } : p));
    try {
      await adminSetPlayerStatus(adminToken, player.id, s);
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "adminSetStatus",
          teamId,
          playerIds: [player.id],
          payload: {
            title: settings?.groupName || "In or Out ⚽",
            body:  pushBody(s),
            icon:  "/icons/icon-192.png",
          },
          gameDate,
        }),
      }).catch(() => {});
      onClose();
    } catch (e) {
      console.error("admin set status failed:", e);
      setSquad(prev);
      setErr(e?.message === "squad_full"
        ? "Squad's full — free a spot first."
        : "Couldn't update — try again.");
      setSaving(false);
    }
  };

  const addGuest = async () => {
    if (!guestName.trim() || addingGuest) return;
    if (!player?.token) { setErr("This player has no link yet — can't add a guest for them."); return; }
    setAddingGuest(true);
    setErr(null);
    try {
      // Host = the tapped player; adminToken present → guest is approved straight in.
      const guest = await addGuestPlayer(player.token, guestName.trim(), adminToken);
      setSquad([...squad, guest]);
      setGuestName("");
      onClose();
    } catch (e) {
      console.error("admin add guest failed:", e);
      setErr(e?.message === "squad_full"
        ? "Squad's full — no spots left."
        : "Couldn't add guest — try again.");
      setAddingGuest(false);
    }
  };

  const STATUSES = [
    { v:"in",      label:"In",      icon:<Check    size={18} weight="thin" /> },
    { v:"out",     label:"Out",     icon:<X        size={18} weight="thin" /> },
    { v:"maybe",   label:"Maybe",   icon:<Question size={18} weight="thin" /> },
    { v:"reserve", label:"Reserve", icon:<ArrowDown size={18} weight="thin" /> },
  ];

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200 }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)" }}/>
      <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430, background:"var(--s1)",
        borderRadius:"var(--r) var(--r) 0 0", padding:"20px 16px 44px",
        border:"0.5px solid var(--border-subtle)" }}>

        <div style={{ fontFamily:"var(--font-display)", fontSize:26, letterSpacing:"0.04em",
          marginBottom:4, color:"var(--t1)" }}>{name}</div>
        <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:16 }}>
          Set their availability — they can still change it themselves.
        </div>

        {/* Status buttons — same control the player sees for themselves */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8,
          marginBottom:16, ...(saving && { opacity:0.5, pointerEvents:"none" }) }}>
          {STATUSES.map(({ v, label, icon }) => (
            <StatusButton key={v} status={v} label={label} icon={icon}
              active={player?.status === v}
              onClick={() => setStatus(v)} />
          ))}
        </div>

        {/* Add a guest for them */}
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <input value={guestName}
            onChange={e => { setGuestName(e.target.value); setErr(null); }}
            onKeyDown={e => e.key === "Enter" && addGuest()}
            placeholder="Add a guest for them…"
            style={{ flex:1, background:"var(--s2)", border:"0.5px solid var(--border-subtle)",
              borderRadius:"var(--rs)", padding:"10px 12px", fontSize:13, color:"var(--t1)",
              fontFamily:"var(--font-body)", outline:"none", boxSizing:"border-box" }}/>
          <button onClick={addGuest} disabled={!guestName.trim() || addingGuest}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 14px",
              borderRadius:"var(--rs)", border:"none",
              background: guestName.trim() && !addingGuest ? "var(--gold)" : "var(--s3)",
              color: guestName.trim() && !addingGuest ? "var(--black)" : "var(--t2)",
              fontFamily:"var(--font-body)", fontSize:13, fontWeight:600,
              cursor: guestName.trim() && !addingGuest ? "pointer" : "not-allowed",
              whiteSpace:"nowrap" }}>
            <UserPlus size={16} weight="thin" />
            {addingGuest ? "…" : "Add"}
          </button>
        </div>

        {err && (
          <div style={{ fontSize:12, color:"var(--red)", fontWeight:300, marginTop:10 }}>{err}</div>
        )}
      </div>
    </div>
  );
}
