import { useState } from "react";
import { Check, X, Question, ArrowDown, UserPlus } from "@phosphor-icons/react";
import { adminSetPlayerStatus, addGuestPlayer, setGuestPayment } from "@platform/core/storage/supabase.js";
import StatusButton from "../components/ui/StatusButton.jsx";

// Admin quick-action sheet — opened from the My View board when an admin taps
// another player's avatar. Set their availability + manage their guests (add
// as many as needed, and set who pays for each). Heavier admin tooling
// (rename, link reset, remove) stays in the full Admin-side PlayerProfile.
//
// Status writes go through admin_set_player_status (soft everywhere as of
// mig 381 — the player can always override their own status afterwards). After
// a successful write we push the affected player a notification naming the
// admin ("Sam marked you in 👊").
//
// Guests: addGuestPlayer creates the guest; setGuestPayment records who pays
// ('host' = the tapped player, 'self' = the guest) AND registers the fee in
// the payment ledger. Multiple guests per host are allowed — the sheet stays
// open after each add so several can be added in a row.
export default function AdminPlayerActionSheet({
  player, squad, setSquad, adminToken, teamId, schedule, settings, adminName, onClose,
}) {
  const [saving,      setSaving]      = useState(false);
  const [addingGuest, setAddingGuest] = useState(false);
  const [guestName,   setGuestName]   = useState("");
  const [guestPayBy,  setGuestPayBy]  = useState("host"); // who pays for the NEW guest
  const [err,         setErr]         = useState(null);

  const hostName = player?.nickname || player?.name || "Host";
  const gameDate = schedule?.gameDateTime?.split("T")[0];

  // This player's current (active) guests.
  const guests = squad.filter(g => g.isGuest && g.guestOf === player?.id && !g.disabled);

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

  // Set/toggle who pays for an EXISTING guest.
  const setPayer = async (g, paidBy) => {
    if (g.selfPaid && g.paidBy === paidBy) return;
    setErr(null);
    const prev = squad;
    setSquad(squad.map(p => p.id === g.id ? { ...p, selfPaid: true, paidBy } : p));
    try {
      await setGuestPayment(player.token, g.id, paidBy);
    } catch (e) {
      console.error("set guest payment failed:", e);
      setSquad(prev);
      setErr("Couldn't update who's paying — try again.");
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
      let added = guest;
      try {
        // Record who pays + register the fee. Non-fatal if it fails — the guest
        // is still added; who-pays can be set from the list below.
        await setGuestPayment(player.token, guest.id, guestPayBy);
        added = { ...guest, selfPaid: true, paidBy: guestPayBy };
      } catch (e) {
        console.error("set guest payment failed:", e);
      }
      setSquad([...squad, added]);
      setGuestName("");
      // Keep the sheet open — admins often add several guests in a row.
    } catch (e) {
      console.error("admin add guest failed:", e);
      setErr(e?.message === "squad_full"
        ? "Squad's full — no spots left."
        : "Couldn't add guest — try again.");
    } finally {
      setAddingGuest(false);
    }
  };

  const STATUSES = [
    { v:"in",      label:"In",      icon:<Check    size={18} weight="thin" /> },
    { v:"out",     label:"Out",     icon:<X        size={18} weight="thin" /> },
    { v:"maybe",   label:"Maybe",   icon:<Question size={18} weight="thin" /> },
    { v:"reserve", label:"Reserve", icon:<ArrowDown size={18} weight="thin" /> },
  ];

  // Compact who-pays pill pair. `value` is 'host' | 'self'.
  const payToggle = (current, onPick, disabled = false) => (
    <div style={{ display:"flex", gap:6 }}>
      {[{ v:"host", label:`${hostName} pays` }, { v:"self", label:"Guest pays" }].map(({ v, label }) => {
        const on = current === v;
        return (
          <button key={v} onClick={() => !disabled && onPick(v)} disabled={disabled}
            style={{ flex:1, padding:"7px 0", borderRadius:"var(--rs)",
              border:`0.5px solid ${on ? "var(--amberb)" : "var(--border-subtle)"}`,
              background: on ? "var(--amber2)" : "transparent",
              color: on ? "var(--amber)" : "var(--t2)",
              fontFamily:"var(--font-body)", fontSize:11, fontWeight: on ? 600 : 400,
              cursor: disabled ? "not-allowed" : "pointer", whiteSpace:"nowrap",
              WebkitTapHighlightColor:"transparent" }}>
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200 }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)" }}/>
      <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430, maxHeight:"88dvh", overflowY:"auto",
        background:"var(--s1)", borderRadius:"var(--r) var(--r) 0 0", padding:"20px 16px 44px",
        border:"0.5px solid var(--border-subtle)" }}>

        <div style={{ fontFamily:"var(--font-display)", fontSize:26, letterSpacing:"0.04em",
          marginBottom:4, color:"var(--t1)" }}>{hostName}</div>
        <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:16 }}>
          Set their availability — they can still change it themselves.
        </div>

        {/* Status buttons — same control the player sees for themselves */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8,
          marginBottom:18, ...(saving && { opacity:0.5, pointerEvents:"none" }) }}>
          {STATUSES.map(({ v, label, icon }) => (
            <StatusButton key={v} status={v} label={label} icon={icon}
              active={player?.status === v}
              onClick={() => setStatus(v)} />
          ))}
        </div>

        {/* Guests for this player */}
        <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.14em",
          textTransform:"uppercase", color:"var(--t2)", margin:"0 2px 10px" }}>
          Guests {guests.length > 0 && `· ${guests.length}`}
        </div>

        {guests.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
            {guests.map(g => (
              <div key={g.id} style={{ padding:"10px 12px", borderRadius:"var(--rs)",
                background:"var(--s2)", border:"0.5px solid var(--border-subtle)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontSize:13, color:"var(--t1)", fontWeight:600 }}>{g.name}</span>
                  {g.pendingApproval && (
                    <span style={{ fontSize:10, color:"var(--amber)", fontWeight:300 }}>Pending</span>
                  )}
                </div>
                {payToggle(g.selfPaid ? g.paidBy : null, (v) => setPayer(g, v))}
              </div>
            ))}
          </div>
        )}

        {/* Add a guest for them */}
        <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:10 }}>
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
        {/* Who pays for the new guest */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:11, color:"var(--t2)", fontWeight:300, whiteSpace:"nowrap" }}>Who pays?</span>
          {payToggle(guestPayBy, setGuestPayBy, addingGuest)}
        </div>

        {err && (
          <div style={{ fontSize:12, color:"var(--red)", fontWeight:300, marginTop:10 }}>{err}</div>
        )}
      </div>
    </div>
  );
}
