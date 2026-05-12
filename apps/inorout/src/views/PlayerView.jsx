import { useState } from "react";
import { colors as C, groupByStatus, isLateDropout, sendTemplate, notificationTemplates,
  getPaymentState, getPaymentMode, handleCashPayment, handleClearDebt } from "@platform/core";
import { savePushSubscription, addGuestPlayer, deletePlayer } from "@platform/supabase";
import {
  Check, X, Question, ArrowDown,
  PencilSimple, UserPlus, Bandaids, Bell, Hourglass,
} from "@phosphor-icons/react";
import PageHeader  from "../components/ui/PageHeader.jsx";
import HeroCard    from "../components/ui/HeroCard.jsx";
import StatusButton from "../components/ui/StatusButton.jsx";
import Tile        from "../components/ui/Tile.jsx";
import Avatar      from "../components/ui/Avatar.jsx";
import NavBar      from "../components/ui/NavBar.jsx";
import StatsView   from "./StatsView.jsx";
import HistoryView from "./HistoryView.jsx";

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── StatusBadge (inline, player view only) ────────────────────────────────────

const BADGE = {
  in:      { label:"✓ In",      bg:"var(--green2)",  border:"var(--greenb)",  color:"var(--green)",  shadow:"0 0 10px rgba(61,220,106,0.15)"   },
  out:     { label:"✕ Out",     bg:"var(--red2)",    border:"var(--redb)",    color:"var(--red)",    shadow:"0 0 10px rgba(255,64,64,0.15)"    },
  maybe:   { label:"? Maybe",   bg:"var(--amber2)",  border:"var(--amberb)",  color:"var(--amber)",  shadow:"0 0 10px rgba(255,176,32,0.15)"   },
  reserve: { label:"↓ Reserve", bg:"var(--purple2)", border:"var(--purpleb)", color:"var(--purple)", shadow:"0 0 10px rgba(176,96,240,0.15)"   },
};

function StatusBadge({ status }) {
  const c = BADGE[status];
  if (!c) return null;
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:5,
      borderRadius:"var(--r-pill)", padding:"5px 12px",
      fontSize:12, fontWeight:400,
      background:c.bg, border:`0.5px solid ${c.border}`,
      color:c.color, boxShadow:c.shadow,
    }}>
      {c.label}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function PlayerView({
  squad, setSquad, myId, teamId, schedule, settings,
  setSchedule, setSettings, onMidFlowChange,
  bibHistory = [], matchHistory = [],
  isAdmin = false, onGoAdmin,
}) {
  const me = squad.find(p => p.id === myId);

  // ── existing state ── (unchanged)
  const [note,          setNote]         = useState(me?.note || "");
  const [showNote,      setShowNote]     = useState(false);
  const [notifState,    setNotifState]   = useState(
    () => (typeof localStorage !== "undefined" && localStorage.getItem(`notif_${myId}`)) || "idle"
  );
  const [showPlusOneForm, setShowPlusOneForm] = useState(false);
  const [guestName,       setGuestName]       = useState("");
  const [guestSelfPaid,   setGuestSelfPaid]   = useState(false);
  const [addingGuest,     setAddingGuest]     = useState(false);
  const [pickerPlayer,    setPickerPlayer]    = useState(null);
  const [removingGuest,   setRemovingGuest]   = useState(false);

  // ── new UI state ──
  const [activeTab,   setActiveTab]   = useState("my-view");
  const [showNoResp,  setShowNoResp]  = useState(false);
  const [payState,    setPayState]    = useState("idle"); // "idle" | "confirming"

  // ── existing derived ── (unchanged)
  const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const canPush      = "PushManager" in window && "serviceWorker" in navigator && (!isIOS || isStandalone);

  const myGuest       = squad.find(p => p.isGuest && p.guestOf === myId);
  const canRemoveGuest = !schedule.isDraft;

  const inPlayers    = squad.filter(p => p.status === "in" && !p.disabled && !p.injured);
  const teamsSet     = inPlayers.length > 0 && inPlayers.every(p => p.team);
  const isFull       = inPlayers.length >= (schedule.squadSize || 14);
  const groups       = groupByStatus(squad);
  const teamAPlayers = [...inPlayers.filter(p => p.team === "A")].sort((a, b) => a.name.localeCompare(b.name));
  const teamBPlayers = [...inPlayers.filter(p => p.team === "B")].sort((a, b) => a.name.localeCompare(b.name));

  // ── tile arrays ──
  const maybePlayers   = (groups.maybe   || []).filter(p => !p.disabled);
  const outPlayers     = (groups.out     || []).filter(p => !p.disabled);
  const reservePlayers = (groups.reserve || []).filter(p => !p.disabled);
  const noRespPlayers  = (groups.none    || []).filter(p => !p.disabled);

  // ── existing handlers ── (all unchanged)

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
      ? { ...p, status: s, note, lateDropouts: (p.lateDropouts || 0) + (late ? 1 : 0) }
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
        const toNotify = squad.filter(p => p.id !== myId && p.status !== "in" && !p.disabled && !p.injured);
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
      onMidFlowChange?.(false);
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

  const toggleInjury = () => {
    const newInjured = !me?.injured;
    const needsStatusReset = newInjured && ["in", "reserve", "maybe"].includes(me?.status);
    setSquad(squad.map(p => p.id === myId
      ? { ...p, injured: newInjured, status: needsStatusReset ? "out" : p.status }
      : p
    ));
  };

  // ── cancelled early return ────────────────────────────────────────────────

  if (schedule.isCancelled) return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>❌</div>
        <div style={{ fontFamily:"var(--font-display)", fontSize:28, color:"var(--red)", letterSpacing:2 }}>
          This week cancelled
        </div>
        {schedule.cancelReason && (
          <div style={{ fontSize:13, color:"var(--t2)", marginTop:8 }}>{schedule.cancelReason}</div>
        )}
      </div>
    </div>
  );

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)", fontFamily:"var(--font-body)" }}>

      {/* 1 ── PAGE HEADER (sticky) */}
      <div style={{ position:"sticky", top:0, zIndex:50, background:"var(--bg)" }}>
        <PageHeader
          teamName={settings?.groupName}
          dayOfWeek={schedule.dayOfWeek}
          venue={schedule.venue}
          kickoff={schedule.kickoff}
          inCount={inPlayers.length}
          squadSize={schedule.squadSize || 14}
          gameIsLive={schedule.gameIsLive}
        />
      </div>

      {/* 3 ── MY VIEW */}
      {activeTab === "my-view" && (
        <div style={{ padding:"0 16px 110px" }}>

          {/* a — Hero card */}
          <HeroCard dayOfWeek={schedule.dayOfWeek} pricePerPlayer={schedule.pricePerPlayer} />

          {/* Teams confirmed */}
          {teamsSet && (
            <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
              borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>
              <div style={{ padding:"12px 16px", fontSize:10, fontWeight:400,
                letterSpacing:"0.14em", textTransform:"uppercase", color:"var(--gold)" }}>
                🏟 Teams confirmed
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0 }}>
                {[["A", teamAPlayers, C.teamA], ["B", teamBPlayers, C.teamB]].map(([t, players, color]) => (
                  <div key={t} style={{ padding:"0 16px 14px" }}>
                    <div style={{ fontSize:11, fontWeight:700, color, letterSpacing:1,
                      textTransform:"uppercase", marginBottom:8, paddingBottom:6,
                      borderBottom:`1px solid ${color}44` }}>
                      Team {t}
                    </div>
                    {players.map((p, i) => (
                      <div key={p.id} style={{ fontSize:13, fontWeight:500,
                        color: p.id === myId ? color : "var(--t1)",
                        padding:"4px 0", borderBottom:"1px solid var(--b2)",
                        display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontSize:11, color:"var(--t2)", minWidth:16 }}>{i + 1}</span>
                        {p.name}
                        {p.id === myId && <span style={{ fontSize:10, color, background:color+"22", border:`1px solid ${color}44`, borderRadius:4, padding:"1px 5px" }}>you</span>}
                        {p.isGuest && <span style={{ fontSize:11 }}>👤</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* b — Response card */}
          <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>

            {!schedule.gameIsLive ? (
              /* Not open yet */
              <div style={{ padding:"24px 16px", textAlign:"center" }}>
                <div style={{ fontSize:28, marginBottom:8 }}>⏸</div>
                <div style={{ fontSize:14, fontWeight:600, color:"var(--t2)" }}>
                  Game not open yet
                </div>
                <div style={{ fontSize:12, color:"var(--t2)", opacity:0.6, marginTop:4 }}>
                  Opens {schedule.opensDay} at {schedule.opensTime}
                </div>
              </div>
            ) : (
              <>
                {/* Top row: name + payment area */}
                <div style={{ padding:"12px 16px 10px", display:"flex",
                  alignItems:"center", justifyContent:"space-between",
                  borderBottom:"1px solid var(--b2)" }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:300, letterSpacing:"0.1em",
                      textTransform:"uppercase", color:"var(--t2)", marginBottom:3 }}>
                      Are you in this {schedule.dayOfWeek}?
                    </div>
                    <div style={{ fontFamily:"var(--font-display)", fontSize:30,
                      lineHeight:1, color:"var(--t1)", letterSpacing:"0.04em" }}>
                      {me?.name}
                    </div>
                  </div>

                  {/* Payment actions — driven by getPaymentState + getPaymentMode */}
                  {(() => {
                    // Status gate — spec: show nothing when out/maybe/reserve
                    if (me?.status !== "in") return null;

                    const cashPending  = payState === "confirming";
                    const paymentState = getPaymentState(me, cashPending);
                    const paymentMode  = getPaymentMode(schedule);

                    console.log('[ioo] payment debug', {
                      paid: me?.paid,
                      selfPaid: me?.self_paid,  // snake_case: undefined if dbToPlayer mapped it correctly
                      owes: me?.owes,
                      cashPending,
                      paymentState: getPaymentState(me, cashPending),
                    });

                    if (paymentState === 'paid') return (
                      <button disabled style={{
                        padding:"6px 12px", borderRadius:8,
                        border:"0.5px solid var(--greenb)", background:"var(--green2)",
                        color:"var(--green)", fontFamily:"var(--font-body)",
                        fontSize:11, fontWeight:500, cursor:"default",
                      }}>✓ All paid up</button>
                    );

                    if (paymentState === 'debt') return (
                      <button onClick={async () => {
                        await handleClearDebt(me.id, teamId);
                        setSquad(squad.map(p => p.id === myId ? { ...p, owes: 0 } : p));
                      }} style={{
                        padding:"6px 12px", borderRadius:8,
                        border:"0.5px solid var(--gold)", background:"transparent",
                        color:"var(--gold)", fontFamily:"var(--font-body)",
                        fontSize:11, fontWeight:500, cursor:"pointer",
                      }}>Clear Debt</button>
                    );

                    if (paymentState === 'cash_pending') return (
                      <button onClick={async () => {
                        await handleCashPayment(me.id, teamId);
                        setSquad(squad.map(p => p.id === myId ? { ...p, selfPaid: true } : p));
                      }} style={{
                        padding:"6px 12px", borderRadius:8,
                        border:"0.5px solid var(--amber)", background:"transparent",
                        color:"var(--amber)", fontFamily:"var(--font-body)",
                        fontSize:11, fontWeight:500, cursor:"pointer",
                      }}>Confirm — Paid Cash</button>
                    );

                    // unpaid + in — show payment buttons
                    return (
                      <div style={{ display:"flex", flexDirection:"column", gap:5, alignItems:"flex-end" }}>
                        {(paymentMode === 'both' || paymentMode === 'stripe_only') && (
                          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
                            <button disabled style={{
                              padding:"6px 12px", borderRadius:8,
                              border:"0.5px solid var(--border-subtle)", background:"transparent",
                              color:"var(--t2)", fontFamily:"var(--font-body)",
                              fontSize:11, fontWeight:500, opacity:0.5, cursor:"not-allowed",
                            }}>Pay Now</button>
                            <span style={{ fontSize:9, color:"var(--t2)", fontWeight:300 }}>
                              Stripe — coming soon
                            </span>
                          </div>
                        )}
                        {(paymentMode === 'both' || paymentMode === 'cash_only') && (
                          <button onClick={() => setPayState("confirming")} style={{
                            padding:"6px 12px", borderRadius:8,
                            border:"none", background:"var(--gold)",
                            color:"#000", fontFamily:"var(--font-body)",
                            fontSize:11, fontWeight:600, cursor:"pointer",
                          }}>Will Pay Cash</button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Locked row */}
                {me?.status === "in" && (
                  <div style={{ display:"flex", alignItems:"center", gap:6,
                    padding:"8px 16px", fontSize:12, color:"var(--green)",
                    fontWeight:400, borderBottom:"1px solid var(--b2)" }}>
                    🔒 Locked in. See you {schedule.dayOfWeek}.
                  </div>
                )}

                {/* Injured notice */}
                {me?.injured && (
                  <div style={{ padding:"10px 16px", fontSize:13, color:"var(--red)",
                    background:"var(--red2)", borderBottom:"1px solid var(--b2)" }}>
                    🤕 You're marked as injured — respond when you're back
                  </div>
                )}

                {/* Squad full notice */}
                {!me?.injured && isFull && me?.status !== "in" && (
                  <div style={{ padding:"8px 16px", fontSize:12, fontWeight:600,
                    color:"var(--amber)", background:"var(--amber2)",
                    borderBottom:"1px solid var(--b2)" }}>
                    🔒 Squad is full — join the reserve list
                  </div>
                )}

                {/* Status buttons 4-grid */}
                <div data-gaffer-target="status-buttons"
                  style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
                    gap:8, padding:"10px 12px" }}>
                  <StatusButton
                    status="in" label="In"
                    icon={<Check size={18} weight="thin" />}
                    active={me?.status === "in"}
                    onClick={() => !me?.injured && !isFull && setStatus("in")}
                    disabled={me?.injured || (isFull && me?.status !== "in")}
                  />
                  <StatusButton
                    status="out" label="Out"
                    icon={<X size={18} weight="thin" />}
                    active={me?.status === "out"}
                    onClick={() => !me?.injured && setStatus("out")}
                    disabled={!!me?.injured}
                  />
                  <StatusButton
                    status="maybe" label="Maybe"
                    icon={<Question size={18} weight="thin" />}
                    active={me?.status === "maybe"}
                    onClick={() => !me?.injured && !isFull && setStatus("maybe")}
                    disabled={me?.injured || (isFull && me?.status !== "maybe")}
                  />
                  <StatusButton
                    status="reserve" label="Reserve"
                    icon={<ArrowDown size={18} weight="thin" />}
                    active={me?.status === "reserve"}
                    onClick={() => !me?.injured && setStatus("reserve")}
                    disabled={!!me?.injured}
                  />
                </div>

                {/* Note row */}
                <div style={{ borderTop:"1px solid var(--b2)" }}>
                  {showNote ? (
                    <div style={{ padding:"10px 16px" }}>
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Might be 5 mins late…"
                        rows={2}
                        style={{ width:"100%", padding:"9px 12px", borderRadius:8,
                          border:"0.5px solid var(--border-subtle)", background:"var(--s3)",
                          color:"var(--t1)", fontFamily:"var(--font-body)", fontSize:13,
                          outline:"none", boxSizing:"border-box", resize:"none",
                          marginBottom:8 }}
                      />
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={saveNote} style={{
                          flex:1, padding:"9px 0", borderRadius:8, border:"none",
                          background:"var(--gold)", color:"#000",
                          fontFamily:"var(--font-body)", fontSize:13, fontWeight:500, cursor:"pointer" }}>
                          Save Note
                        </button>
                        <button onClick={() => setShowNote(false)} style={{
                          flex:1, padding:"9px 0", borderRadius:8,
                          border:"0.5px solid var(--border-subtle)", background:"transparent",
                          color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:13, cursor:"pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => setShowNote(true)} style={{
                      padding:"9px 16px", display:"flex", alignItems:"center",
                      justifyContent:"space-between", cursor:"pointer" }}>
                      <span style={{ display:"flex", alignItems:"center", gap:6,
                        fontSize:12, color:"var(--t2)", fontWeight:400 }}>
                        <PencilSimple size={14} weight="thin" />
                        Add a note
                      </span>
                      <span style={{ fontSize:12, color:"var(--t2)", fontStyle:"italic", fontWeight:300 }}>
                        {me?.note || "e.g. \"Might be 5 mins late\""}
                      </span>
                    </div>
                  )}
                </div>

                {/* Status confirmation message */}
                {me?.status && me.status !== "none" && (
                  <div style={{ padding:"9px 16px", borderTop:"1px solid var(--b2)",
                    fontSize:12, fontWeight:400, color:"var(--t2)", fontStyle:"italic" }}>
                    {me.status === "in"
                      ? `👊 Locked in — see you ${schedule.dayOfWeek}`
                      : me.status === "maybe"
                        ? "🤞 Got it — we'll keep a spot open"
                        : me.status === "reserve"
                          ? "🟣 On the reserve list — we'll let you know if a spot opens"
                          : "👍 No worries, we'll find cover"}
                  </div>
                )}

                {/* Push subscription prompt */}
                {me?.status && me.status !== "none" && canPush && notifState === "idle" && (
                  <div style={{ margin:"0 12px 12px", padding:"10px 14px", borderRadius:"var(--rs)",
                    background:"var(--s2)", border:"0.5px solid var(--border-subtle)",
                    display:"flex", alignItems:"center", gap:10 }}>
                    <Bell size={20} weight="thin" color="var(--t1)" style={{ flexShrink:0 }} />
                    <div style={{ flex:1, fontSize:12, color:"var(--t2)", fontWeight:300, lineHeight:1.4 }}>
                      Get notified when a spot opens or squad fills up
                    </div>
                    <button onClick={handleSubscribe} style={{
                      background:"var(--gold)", color:"#000", border:"none", borderRadius:7,
                      padding:"7px 12px", fontSize:12, fontWeight:500,
                      fontFamily:"var(--font-body)", cursor:"pointer", flexShrink:0 }}>
                      {notifState === "asking" ? "..." : "Enable"}
                    </button>
                    <button onClick={() => {
                      localStorage.setItem(`notif_${myId}`, "dismissed");
                      setNotifState("dismissed");
                    }} style={{ fontSize:12, color:"var(--t2)", background:"none", border:"none",
                      fontFamily:"var(--font-body)", cursor:"pointer", padding:"7px 4px",
                      flexShrink:0, fontWeight:300 }}>
                      Not now
                    </button>
                  </div>
                )}
                {notifState === "subscribed" && (
                  <div style={{ padding:"8px 16px 12px", fontSize:12, color:"var(--green)", textAlign:"center" }}>
                    ✅ Notifications on
                  </div>
                )}
              </>
            )}
          </div>

          {/* c — Quick actions row */}
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>

            {/* Plus One */}
            {schedule.gameIsLive && (
              myGuest ? (
                /* Guest card */
                <div style={{ flex:1, padding:"11px 12px", background:"var(--s1)",
                  border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                  display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:"var(--t1)" }}>
                      👤 {myGuest.name}
                      <span style={{ color:"var(--t2)", fontWeight:400 }}> — your +1</span>
                    </div>
                    <div style={{ fontSize:11, color:"var(--t2)", marginTop:2, fontWeight:300 }}>
                      {myGuest.selfPaid ? "Paying cash" : "You're covering payment"}
                    </div>
                  </div>
                  {canRemoveGuest && (
                    <button onClick={removeMyGuest} disabled={removingGuest} style={{
                      padding:"5px 11px", borderRadius:4,
                      border:"0.5px solid var(--border-subtle)", background:"transparent",
                      color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:11, cursor:"pointer" }}>
                      {removingGuest ? "..." : "Remove"}
                    </button>
                  )}
                </div>
              ) : !showPlusOneForm ? (
                <button
                  data-gaffer-target="add-plus-one"
                  onClick={() => { setShowPlusOneForm(true); onMidFlowChange?.(true); }}
                  style={{ flex:1, padding:"11px 12px", background:"var(--s1)",
                    border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                    display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                  <UserPlus size={20} weight="thin" color="var(--t1)" style={{ flexShrink:0 }} />
                  <div style={{ textAlign:"left" }}>
                    <div style={{ fontSize:13, fontWeight:400, color:"var(--t1)" }}>Plus One</div>
                    <div style={{ fontSize:11, color:"var(--t2)", marginTop:1, fontWeight:300 }}>Bring a guest</div>
                  </div>
                </button>
              ) : null
            )}

            {/* Injured toggle */}
            <button onClick={toggleInjury} style={{
              flex: schedule.gameIsLive && !myGuest && !showPlusOneForm ? undefined : 1,
              padding:"11px 12px", background:"var(--s1)",
              border: me?.injured ? "0.5px solid var(--redb)" : "0.5px solid var(--border-subtle)",
              borderRadius:"var(--rs)",
              display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              background: me?.injured ? "var(--red2)" : "var(--s1)",
            }}>
              <Bandaids size={20} weight="thin" color={me?.injured ? "var(--red)" : "var(--t1)"} style={{ flexShrink:0 }} />
              <div style={{ textAlign:"left" }}>
                <div style={{ fontSize:13, fontWeight:400, color: me?.injured ? "var(--red)" : "var(--t1)" }}>
                  {me?.injured ? "Injured" : "Injured"}
                </div>
                <div style={{ fontSize:11, color:"var(--t2)", marginTop:1, fontWeight:300 }}>
                  {me?.injured ? "Tap to clear" : "Mark yourself out"}
                </div>
              </div>
            </button>
          </div>

          {/* Plus One form (expanded) */}
          {showPlusOneForm && (
            <div style={{ padding:"14px 16px", borderRadius:"var(--r)",
              background:"var(--s1)", border:"0.5px solid var(--border-subtle)", marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--t1)", marginBottom:12 }}>
                ➕ Add a plus one
              </div>
              <input
                value={guestName}
                onChange={e => handleGuestNameChange(e.target.value)}
                placeholder="Guest's name..."
                style={{ width:"100%", padding:"11px 13px", borderRadius:8,
                  marginBottom: pickerPlayer ? 8 : 12,
                  border:"0.5px solid var(--border-subtle)", background:"var(--s3)",
                  color:"var(--t1)", fontFamily:"var(--font-body)", fontSize:14,
                  outline:"none", boxSizing:"border-box" }}
              />
              {pickerPlayer && (
                <div style={{ padding:"10px 12px", borderRadius:8, marginBottom:12,
                  background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                  display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                  <span style={{ fontSize:12, color:"var(--amber)" }}>
                    Is this {pickerPlayer.name} (already on the team)?
                  </span>
                  <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                    <button onClick={confirmExistingPlayer} style={{
                      padding:"5px 11px", borderRadius:4,
                      border:"0.5px solid var(--greenb)", background:"var(--green2)",
                      color:"var(--green)", fontFamily:"var(--font-body)",
                      fontSize:11, fontWeight:700, cursor:"pointer" }}>
                      Yes
                    </button>
                    <button onClick={() => setPickerPlayer(null)} style={{
                      padding:"5px 11px", borderRadius:4,
                      border:"0.5px solid var(--border-subtle)", background:"transparent",
                      color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:11, cursor:"pointer" }}>
                      No
                    </button>
                  </div>
                </div>
              )}
              {/* Payment toggle */}
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                {[{ label:`${me?.name} pays`, value: false }, { label:"They pay", value: true }].map(opt => (
                  <button key={String(opt.value)} onClick={() => setGuestSelfPaid(opt.value)} style={{
                    flex:1, padding:"9px 0", borderRadius:8,
                    border: guestSelfPaid === opt.value ? "0.5px solid var(--amberb)" : "0.5px solid var(--border-subtle)",
                    background: guestSelfPaid === opt.value ? "var(--amber2)" : "transparent",
                    color: guestSelfPaid === opt.value ? "var(--amber)" : "var(--t2)",
                    fontFamily:"var(--font-body)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={submitGuest} disabled={!guestName.trim() || addingGuest} style={{
                  flex:1, padding:"10px 0", borderRadius:8, border:"none",
                  background: guestName.trim() ? "var(--green)" : "var(--s3)",
                  color: guestName.trim() ? "#000" : "var(--t2)",
                  fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
                  cursor: guestName.trim() && !addingGuest ? "pointer" : "not-allowed" }}>
                  {addingGuest ? "Adding..." : "Add Plus One"}
                </button>
                <button onClick={() => {
                  setShowPlusOneForm(false); setGuestName(""); setPickerPlayer(null);
                  onMidFlowChange?.(false);
                }} style={{
                  flex:1, padding:"10px 0", borderRadius:8,
                  border:"0.5px solid var(--border-subtle)", background:"transparent",
                  color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:13, cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* e — Live board */}
          {!teamsSet && (
            <>
              <div style={{ display:"flex", alignItems:"center", marginBottom:7, marginTop:12 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, fontSize:10, fontWeight:400,
                  letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)" }}>
                  <span style={{ width:6, height:6, background:"var(--green)", borderRadius:"50%",
                    animation:"ioo-blink 2s infinite", boxShadow:"0 0 8px var(--green)",
                    display:"inline-block", flexShrink:0 }} />
                  Live Board
                </div>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:8 }}>

                {/* IN */}
                <Tile colour="green" icon="✅" label="In" count={inPlayers.length}>
                  {inPlayers.map(p => (
                    <Avatar
                      key={p.id}
                      player={p}
                      isMe={p.id === myId}
                      tileColour="green"
                      hasGuest={squad.some(g => g.isGuest && g.guestOf === p.id)}
                    />
                  ))}
                </Tile>

                {/* MAYBE */}
                {maybePlayers.length > 0 && (
                  <Tile colour="amber" icon="❓" label="Maybe" count={maybePlayers.length}>
                    {maybePlayers.map(p => (
                      <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="amber" />
                    ))}
                  </Tile>
                )}

                {/* OUT */}
                {outPlayers.length > 0 && (
                  <Tile colour="red" icon="❌" label="Out" count={outPlayers.length}>
                    {outPlayers.map(p => (
                      <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="red" />
                    ))}
                  </Tile>
                )}

                {/* RESERVE */}
                {reservePlayers.length > 0 && (
                  <div data-gaffer-target="reserve-list">
                    <Tile colour="purple" icon="🟣" label="Reserve" count={reservePlayers.length}>
                      {reservePlayers.map((p, i) => (
                        <Avatar
                          key={p.id} player={p}
                          isMe={p.id === myId} tileColour="purple"
                          reserveIndex={i + 1}
                        />
                      ))}
                    </Tile>
                  </div>
                )}
              </div>

              {/* No response row */}
              {noRespPlayers.length > 0 && (
                <>
                  <div
                    onClick={() => setShowNoResp(s => !s)}
                    style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
                      borderRadius:"var(--rs)", padding:"10px 14px",
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                      marginBottom:8, cursor:"pointer" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8,
                      fontSize:12, color:"var(--t2)", fontWeight:400 }}>
                      <Hourglass size={16} weight="thin" />
                      No response · {noRespPlayers.length}
                    </div>
                    <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300 }}>
                      {showNoResp ? "Tap to hide ↑" : "Tap to view ↓"}
                    </div>
                  </div>
                  {showNoResp && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"5px 9px",
                      padding:"0 4px", marginBottom:8 }}>
                      {noRespPlayers.map(p => (
                        <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="green" />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

        </div>
      )}

      {/* STATS tab */}
      {activeTab === "stats" && (
        <StatsView squad={squad} bibHistory={bibHistory} matchHistory={matchHistory} />
      )}

      {/* HISTORY tab */}
      {activeTab === "history" && (
        <HistoryView matchHistory={matchHistory} settings={settings} />
      )}

      {/* 4 ── NAVBAR */}
      <NavBar activeTab={activeTab} onTabChange={setActiveTab} onAdminClick={isAdmin ? onGoAdmin : undefined} />
    </div>
  );
}
