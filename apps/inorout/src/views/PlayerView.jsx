import { useState, useRef, useEffect } from "react";
import { colors as C, groupByStatus, isLateDropout, sendTemplate, notificationTemplates,
  getPaymentState, getGuestPaymentState,
  handleCashPayment, handleClearDebt, handleGuestCashPayment,
  resolveMotm } from "@platform/core";
import { savePushSubscription, addGuestPlayer, setPlayerStatus, setPlayerInjured, deletePlayer,
  getPlayerMatchForm, getLastMatchMeta,
  getPOTMEligiblePlayers, getPOTMVotes, setPlayerNickname,
  resolveBibHolder, getLedgerForPlayer, getOutstandingBalance } from "@platform/supabase";
import POTMVotingModal from "./POTMVotingModal.jsx";
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
import MyIOView    from "./MyIOView.jsx";

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
  startTab = null,
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
  const [activeTab,   setActiveTab]   = useState(startTab || "my-view");
  const [showNoResp,  setShowNoResp]  = useState(false);
  const [cashPending,       setCashPending]       = useState(false);
  const [guestCashPending,  setGuestCashPending]  = useState(false);
  const [clearDebtExpanded, setClearDebtExpanded] = useState(false);
  const [hideConfirmation,  setHideConfirmation]  = useState(false);
  const confirmationTimer = useRef(null);
  const [playerForm,      setPlayerForm]      = useState({});
  const [lastMatchMeta,   setLastMatchMeta]   = useState(null);
  const [showPOTMModal,   setShowPOTMModal]   = useState(false);
  const [potmEligible,    setPotmEligible]    = useState([]);
  const [potmHasVoted,    setPotmHasVoted]    = useState(false);
  const [potmExistingVote,setPotmExistingVote]= useState(null);
  const [potmBanner,      setPotmBanner]      = useState(null); // { winnerName, isWinner }
  const prevVotingOpen = useRef(false);

  const [payError,        setPayError]        = useState(null);
  const [ledgerBalance,   setLedgerBalance]   = useState(null);
  const [payHistOpen,     setPayHistOpen]     = useState(false);
  const [payHistory,      setPayHistory]      = useState(null);
  const [payHistLoading,  setPayHistLoading]  = useState(false);

  // Inline nickname edit (My View header)
  const [editingMyNick, setEditingMyNick] = useState(false);
  const [myNick,        setMyNick]        = useState("");
  const [myNickError,   setMyNickError]   = useState(null);
  const [myNickSaving,  setMyNickSaving]  = useState(false);

  const saveMyNick = async () => {
    setMyNickSaving(true); setMyNickError(null);
    try {
      await setPlayerNickname(myId, teamId, myNick);
      const trimmed = myNick.trim() || null;
      setSquad(sq => sq.map(p => p.id === myId ? { ...p, nickname: trimmed } : p));
      setEditingMyNick(false);
    } catch(e) {
      setMyNickError(e?.code === "nickname_taken" ? "Already taken on this squad" : "Failed to save");
    } finally {
      setMyNickSaving(false);
    }
  };

  // ── existing derived ── (unchanged)
  const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const canPush      = "PushManager" in window && "serviceWorker" in navigator && (!isIOS || isStandalone);

  const myGuest       = squad.find(p => p.isGuest && p.guestOf === myId);
  const canRemoveGuest = !schedule.isDraft;

  const inPlayers        = squad.filter(p => p.status === "in" && !p.disabled && !p.injured);
  const nonGuestInPlayers = inPlayers.filter(p => !p.isGuest);
  const teamsSet         = nonGuestInPlayers.length > 0 && nonGuestInPlayers.every(p => p.team);

  useEffect(() => {
    if (!teamId) return;
    getLastMatchMeta(teamId).then(meta => setLastMatchMeta(meta)).catch(() => {});
  }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!teamsSet || !teamId) return;
    const ids = squad.filter(p => p.status === "in" && !p.disabled && !p.isGuest).map(p => p.id);
    if (!ids.length) return;
    getPlayerMatchForm(teamId, ids).then(form => setPlayerForm(form || {})).catch(() => {});
  }, [teamsSet, teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!myId || !teamId) return;
    getOutstandingBalance(myId, teamId).then(setLedgerBalance).catch(() => {});
  }, [myId, teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // POTM voting — open modal when voting becomes active for this player
  useEffect(() => {
    const activeMatch = matchHistory?.[0];
    const wasOpen = prevVotingOpen.current;
    const nowOpen = schedule?.votingOpen;

    // Voting just opened → check eligibility
    if (nowOpen && !wasOpen && activeMatch && me && !me.isGuest) {
      prevVotingOpen.current = true;
      const matchId = schedule.activeMatchId || activeMatch.id;
      Promise.all([
        getPOTMEligiblePlayers(matchId, teamId),
        getPOTMVotes(matchId),
      ]).then(([eligible, votes]) => {
        const myVote = votes.find(v => v.voter_id === myId);
        setPotmEligible(eligible);
        setPotmHasVoted(!!myVote);
        setPotmExistingVote(myVote?.nominee_id || null);
        const amEligible = eligible.some(p => p.id === myId);
        if (amEligible) setShowPOTMModal(true);
      }).catch(() => {});
    }

    // Voting just closed + result is in → show banner
    if (!nowOpen && wasOpen && activeMatch?.motm) {
      prevVotingOpen.current = false;
      const winnerName = resolveMotm(activeMatch.motm, squad) || "Unknown";
      const isWinner = !!(me && activeMatch.motm === me.id);
      setPotmBanner({ winnerName, isWinner });
      setTimeout(() => setPotmBanner(null), 5000);
    } else if (!nowOpen) {
      prevVotingOpen.current = false;
    }
  }, [schedule?.votingOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const isFull   = inPlayers.length >= (schedule.squadSize || 14);
  const gameDay  = schedule?.gameDateTime
    ? new Date(schedule.gameDateTime).toLocaleDateString('en-GB', { weekday:'long' })
    : schedule?.dayOfWeek || 'Tuesday';
  const groups   = groupByStatus(squad);
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
      await savePushSubscription(me?.token, sub.toJSON());
      localStorage.setItem(`notif_${myId}`, "subscribed");
      setNotifState("subscribed");
    } catch(e) {
      console.error("Push subscribe failed:", e);
      setNotifState("idle");
    }
  };

  const setStatus = (s) => {
    setCashPending(false);
    setGuestCashPending(false);
    setClearDebtExpanded(false);
    clearTimeout(confirmationTimer.current);
    setHideConfirmation(false);
    confirmationTimer.current = setTimeout(() => setHideConfirmation(true), 5000);
    const late = isLateDropout(me?.status, s, schedule.gameDateTime);
    if (late) sendTemplate(notificationTemplates.lateDropout, me?.name);
    setSquad(squad.map(p => p.id === myId
      ? { ...p, status: s, note, lateDropouts: (p.lateDropouts || 0) + (late ? 1 : 0) }
      : p
    ));
    if (me?.token) setPlayerStatus(me.token, s).catch(console.error);

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
      const guest = await addGuestPlayer(me?.token, guestName.trim());
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
    if (pickerPlayer.token) setPlayerStatus(pickerPlayer.token, "in").catch(console.error);
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
    if (me?.token) setPlayerInjured(me.token, newInjured).catch(console.error);
  };


  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)", fontFamily:"var(--font-body)" }}>

      {/* POTM voting modal */}
      {showPOTMModal && (
        <POTMVotingModal
          matchId={schedule.activeMatchId || matchHistory?.[0]?.id}
          teamId={teamId}
          voterId={myId}
          voterName={me?.name}
          eligiblePlayers={potmEligible}
          hasVoted={potmHasVoted}
          existingVote={potmExistingVote}
          votingOpen={!!schedule.votingOpen}
          votingClosesAt={schedule.votingClosesAt}
          motm={matchHistory?.[0]?.motm}
          onClose={() => setShowPOTMModal(false)}
        />
      )}

      {/* POTM result banner */}
      {potmBanner && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 90,
          background: "var(--gold)", padding: "14px 20px",
          textAlign: "center", fontFamily: "var(--font-body)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--bg)" }}>
            {potmBanner.isWinner
              ? "🏆 You've been voted POTM tonight. Get in."
              : `🏆 ${potmBanner.winnerName} wins POTM tonight!`}
          </span>
        </div>
      )}

      {/* 1 ── PAGE HEADER (sticky) — my-view only; stats/history render their own headers */}
      {activeTab === "my-view" && (
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
      )}

      {/* 3 ── MY VIEW */}
      {activeTab === "my-view" && (
        <div style={{ padding:"0 16px 110px" }}>

          {/* a — Hero card */}
          <HeroCard dayOfWeek={schedule.dayOfWeek} pricePerPlayer={schedule.pricePerPlayer} squad={squad} />


          {/* b — Response card */}
          <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>

            <>
              <style>{`@keyframes ioo-name-glow{0%{text-shadow:-20px 0 8px transparent}40%{text-shadow:0px 0 12px rgba(232,160,32,0.6)}80%{text-shadow:20px 0 8px transparent}100%{text-shadow:none}}`}</style>

              {/* Header: subtitle row | name row | payment row */}
              {(() => {
                const price          = schedule.pricePerPlayer || 0;
                const owes           = me?.owes || 0;
                const effectiveDebt  = (ledgerBalance !== null && ledgerBalance > 0) ? ledgerBalance : owes;
                const paymentState = getPaymentState(me, cashPending);
                const paymentMode  = 'both';
                const status       = me?.status;
                const isNonPlay    = status === 'out' || status === 'maybe' || status === 'reserve';

                let amountText, amountColor = "var(--t2)";
                if (paymentState === 'paid') {
                  amountText = "Nothing owed 👊"; amountColor = "var(--green)";
                } else if (effectiveDebt > 0) {
                  amountText = status === 'in'
                    ? `£${effectiveDebt} + £${price} = £${effectiveDebt + price}`
                    : `£${effectiveDebt} outstanding`;
                } else if (status === 'in') {
                  amountText = price > 0 ? `£${price} this week` : "Nothing owed 👊";
                  if (!price) amountColor = "var(--green)";
                } else {
                  amountText = "Nothing owed 👊"; amountColor = "var(--green)";
                }

                const tileStyle = (extra) => ({
                  flex:1, minHeight:28, borderRadius:"var(--r-button)",
                  fontSize:11, fontWeight:600, fontFamily:"var(--font-body)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"all 0.15s", cursor:"pointer", border:"none",
                  padding:"0 10px", whiteSpace:"nowrap",
                  ...extra,
                });

                const btns = [];

                if (me?.selfPaid === true && me?.paid !== true && !cashPending) {
                  btns.push(
                    <span key="awaiting" style={{
                      flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                      color:"var(--amber)", borderRadius:"var(--r-button)",
                      padding:"0 10px", fontSize:12, fontWeight:400,
                      minHeight:28, fontFamily:"var(--font-body)",
                    }}>Awaiting confirmation</span>
                  );
                } else if (me?.paid === true) {
                  btns.push(
                    <span key="confirmed" style={{
                      flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      background:"var(--green2)", border:"0.5px solid var(--greenb)",
                      color:"var(--green)", borderRadius:"var(--r-button)",
                      padding:"0 10px", fontSize:12, fontWeight:400,
                      minHeight:28, fontFamily:"var(--font-body)",
                    }}>✓ Paid</span>
                  );
                } else if (paymentState === 'debt') {
                  if (!clearDebtExpanded) {
                    btns.push(
                      <button key="clear" onClick={() => setClearDebtExpanded(true)}
                        style={tileStyle({ background:"transparent", border:"0.5px solid var(--gold)", color:"var(--gold)" })}>
                        Clear Debt — £{owes + (status === 'in' ? price : 0)}
                      </button>
                    );
                  } else if (!cashPending) {
                    if (paymentMode !== 'cash_only') btns.push(
                      <button key="stripe" disabled
                        style={tileStyle({ background:"transparent", border:"1px solid rgba(255,255,255,0.25)", color:"var(--t2)", opacity:0.4, cursor:"not-allowed" })}>
                        Transfer £{owes + (status === 'in' ? price : 0)}
                      </button>
                    );
                    if (paymentMode !== 'stripe_only') btns.push(
                      <button key="cash" onClick={() => setCashPending(true)}
                        style={tileStyle({ background:"var(--gold)", color:"#000" })}>
                        Paid Cash
                      </button>
                    );
                  } else {
                    btns.push(
                      <div key="confirm-debt" style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"stretch", gap:4 }}>
                        <button onClick={async () => {
                          setPayError(null);
                          try {
                            await handleClearDebt(me.id, teamId, owes + price);
                            await handleCashPayment(me.token);
                            setSquad(squad.map(p => p.id === myId ? { ...p, owes:0, selfPaid:true } : p));
                            setCashPending(false);
                            setClearDebtExpanded(false);
                          } catch {
                            setPayError("Something went wrong — try again");
                          }
                        }} style={tileStyle({ background:"transparent", border:"0.5px solid var(--amber)", color:"var(--amber)" })}>
                          Confirm — You've Paid?
                        </button>
                        {payError && <div style={{ fontSize:10, color:"var(--red)", textAlign:"center", fontWeight:300 }}>{payError}</div>}
                      </div>
                    );
                  }
                } else if (status === 'in') {
                  if (paymentState === 'unpaid') {
                    if (paymentMode !== 'cash_only') btns.push(
                      <button key="stripe" disabled
                        style={tileStyle({ background:"transparent", border:"1px solid rgba(255,255,255,0.25)", color:"var(--t2)", opacity:0.4, cursor:"not-allowed" })}>
                        Transfer £{price}
                      </button>
                    );
                    if (paymentMode !== 'stripe_only') btns.push(
                      <button key="cash" onClick={() => setCashPending(true)}
                        style={tileStyle({ background:"var(--gold)", color:"#000" })}>
                        Paid Cash
                      </button>
                    );
                  } else if (paymentState === 'cash_pending') {
                    btns.push(
                      <div key="confirm-in" style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"stretch", gap:4 }}>
                        <button onClick={async () => {
                          setPayError(null);
                          try {
                            await handleCashPayment(me.token);
                            setSquad(squad.map(p => p.id === myId ? { ...p, selfPaid:true } : p));
                            setCashPending(false);
                          } catch {
                            setPayError("Something went wrong — try again");
                          }
                        }} style={tileStyle({ background:"transparent", border:"0.5px solid var(--amber)", color:"var(--amber)" })}>
                          Confirm — You've Paid?
                        </button>
                        {payError && <div style={{ fontSize:10, color:"var(--red)", textAlign:"center", fontWeight:300 }}>{payError}</div>}
                      </div>
                    );
                  }
                }
                // isNonPlay + unpaid + no debt → "Nothing owed 👊", no buttons

                return (
                  <div style={{ padding:"12px 16px 10px", borderBottom:"1px solid var(--b2)" }}>

                    {/* Row 1: subtitle | amount */}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                      <div style={{ fontSize:10, fontWeight:300, letterSpacing:"0.1em",
                        textTransform:"uppercase", color:"var(--t2)" }}>
                        {schedule.gameIsLive ? `Are you in this ${gameDay}?` : "This week's game isn't live yet"}
                      </div>
                      <div style={{ fontSize:12, fontWeight:300, fontFamily:"var(--font-body)", color:amountColor }}>
                        {amountText}
                      </div>
                    </div>

                    {/* Row 2: name + pencil / edit form */}
                    {editingMyNick ? (
                      <div style={{ marginTop:2 }}>
                        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                          <input
                            value={myNick}
                            onChange={e => { setMyNick(e.target.value); setMyNickError(null); }}
                            onKeyDown={e => { if (e.key === "Enter") saveMyNick(); if (e.key === "Escape") setEditingMyNick(false); }}
                            placeholder="Add nickname"
                            autoFocus
                            style={{
                              flex:1, background:"var(--s2)",
                              border:`0.5px solid ${myNickError ? "var(--red)" : "var(--goldb)"}`,
                              borderRadius:6, padding:"5px 8px", fontSize:14, color:"var(--t1)",
                              fontFamily:"var(--font-body)", outline:"none", minWidth:0,
                            }}
                          />
                          <button onClick={saveMyNick} disabled={myNickSaving} style={{
                            background:"var(--gold)", color:"var(--bg)", border:"none",
                            borderRadius:6, padding:"5px 10px", fontSize:11, fontWeight:600,
                            cursor: myNickSaving ? "not-allowed" : "pointer",
                            opacity: myNickSaving ? 0.6 : 1, fontFamily:"var(--font-body)",
                          }}>
                            {myNickSaving ? "…" : "Save"}
                          </button>
                          <button onClick={() => { setEditingMyNick(false); setMyNickError(null); }} style={{
                            background:"transparent", border:"0.5px solid var(--border-subtle)",
                            borderRadius:6, padding:"5px 8px", fontSize:11, color:"var(--t2)",
                            cursor:"pointer", fontFamily:"var(--font-body)",
                          }}>✕</button>
                        </div>
                        {myNickError && (
                          <div style={{ fontSize:11, color:"var(--red)", marginTop:4, fontWeight:300 }}>{myNickError}</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ fontFamily:"var(--font-display)", fontSize:30,
                          lineHeight:1, color:"var(--t1)", letterSpacing:"0.04em",
                          animation:"ioo-name-glow 1.2s ease-in-out 2", animationFillMode:"forwards" }}>
                          {me?.nickname || me?.name}
                        </div>
                        <PencilSimple
                          size={14} weight="thin" color="var(--t2)"
                          style={{ cursor:"pointer", flexShrink:0, marginTop:4 }}
                          onClick={() => { setMyNick(me?.nickname || ""); setMyNickError(null); setEditingMyNick(true); }}
                        />
                      </div>
                    )}

                    {/* Bibs badge */}
                    {me?.id === lastMatchMeta?.bibHolder && (
                      <span style={{
                        display:"inline-block", marginTop:6,
                        background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                        color:"var(--amber)",
                        fontFamily:"var(--font-display)", fontSize:11, letterSpacing:"0.08em",
                        borderRadius:6, padding:"3px 8px",
                      }}>
                        YOU'VE GOT THE BIBS 👕
                      </span>
                    )}

                    {/* Row 3: payment buttons full width, side by side */}
                    {btns.length > 0 && (
                      <div style={{ display:"flex", gap:8, marginTop:8 }}>
                        {btns}
                      </div>
                    )}

                  </div>
                );
              })()}

              {/* Locked row — gameIsLive only */}
              {schedule.gameIsLive && me?.status === "in" && (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  padding:"8px 16px", fontSize:12, color:"var(--green)",
                  fontWeight:400, borderBottom:"1px solid var(--b2)", textAlign:"center" }}>
                  🔒 Locked in. See you {gameDay}.
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

              {/* Cancelled banner */}
              {schedule.isCancelled && (
                <div style={{ margin:"10px 12px 0", background:"var(--red2)",
                  border:"0.5px solid var(--redb)", color:"var(--red)",
                  fontFamily:"var(--font-body)", fontWeight:400, fontSize:13,
                  padding:"8px 16px", borderRadius:8, textAlign:"center" }}>
                  ❌ This week's match is cancelled
                </div>
              )}

              {/* Status buttons 4-grid — gameIsLive or cancelled */}
              {(schedule.gameIsLive || schedule.isCancelled) && (
                <>
                <div data-gaffer-target="status-buttons"
                  style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
                    gap:8, padding:"10px 12px",
                    ...(schedule.isCancelled && { opacity:0.4, pointerEvents:"none" }) }}>
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
                </>
              )}

              {/* Note row — gameIsLive only */}
              {schedule.gameIsLive && (
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
              )}

              {/* Status confirmation message — gameIsLive only, auto-hides after 5s; not shown for "in" (🔒 row covers it) */}
              {schedule.gameIsLive && me?.status && me.status !== "none" && me.status !== "in" && !hideConfirmation && (
                <div style={{ padding:"9px 16px", borderTop:"1px solid var(--b2)",
                  fontSize:12, fontWeight:400, color:"var(--t2)", fontStyle:"italic" }}>
                  {me.status === "maybe"
                    ? "🤞 Got it — we'll keep a spot open"
                    : me.status === "reserve"
                      ? "🟣 On the reserve list — we'll let you know if a spot opens"
                      : "👍 No worries, we'll find cover"}
                </div>
              )}

              {/* Push subscription prompt — gameIsLive only */}
              {schedule.gameIsLive && me?.status && me.status !== "none" && canPush && notifState === "idle" && (
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
              {/* Guest payment row — inside card, gold-tinted bg */}
              {myGuest && (() => {
                const gps      = getGuestPaymentState(myGuest, guestCashPending);
                const price    = schedule.pricePerPlayer || 0;
                const payMode  = 'both';
                const guestName = myGuest.name.charAt(0).toUpperCase() + myGuest.name.slice(1);
                const ts = (extra) => ({
                  height:32, borderRadius:"var(--r-pill)",
                  fontSize:11, fontWeight:600, fontFamily:"var(--font-body)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"all 0.15s", cursor:"pointer", border:"none",
                  padding:"0 12px", whiteSpace:"nowrap",
                  ...extra,
                });

                let right;
                if (gps === 'paid_stripe') {
                  right = <span style={{ fontSize:11, color:"var(--green)", fontWeight:400 }}>✓ Stripe</span>;
                } else if (gps === 'paid_cash') {
                  const label = myGuest.paidBy === 'host'  ? "✓ You paid — cash"
                              : myGuest.paidBy === 'admin' ? "✓ Admin confirmed"
                              : `✓ ${guestName} paid — cash`;
                  right = <span style={{ fontSize:11, color:"var(--green)", fontWeight:400 }}>{label}</span>;
                } else if (gps === 'cash_pending') {
                  right = (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                      <button onClick={async () => {
                        setPayError(null);
                        try {
                          await handleGuestCashPayment(me?.token, myGuest.id, 'host');
                          setSquad(sq => sq.map(p => p.id === myGuest.id ? { ...p, selfPaid:true, paidBy:'host' } : p));
                          setGuestCashPending(false);
                        } catch {
                          setPayError("Something went wrong — try again");
                        }
                      }} style={ts({ background:"transparent", border:"0.5px solid var(--amber)", color:"var(--amber)" })}>
                        Confirm — You've Paid?
                      </button>
                      {payError && <div style={{ fontSize:10, color:"var(--red)", textAlign:"right", fontWeight:300 }}>{payError}</div>}
                    </div>
                  );
                } else if (myGuest.selfPaid) {
                  right = <span style={{ fontSize:11, color:"var(--t2)", fontWeight:300 }}>Paying cash</span>;
                } else {
                  right = (
                    <div style={{ display:"flex", flexDirection:"row", gap:6, alignItems:"center" }}>
                      {payMode !== 'cash_only' && (
                        <button disabled style={ts({ background:"transparent", border:"1px solid rgba(255,255,255,0.25)", color:"var(--t2)", opacity:0.4, cursor:"not-allowed" })}>
                          Transfer £{price}
                        </button>
                      )}
                      {payMode !== 'stripe_only' && (
                        <button onClick={() => setGuestCashPending(true)} style={ts({ background:"var(--gold)", color:"#000" })}>
                          Paid Cash
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div style={{
                    padding:"10px 16px",
                    borderTop:"0.5px solid var(--b2)",
                    background:"rgba(232,160,32,0.04)",
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                  }}>
                    <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>👤 {guestName}</div>
                    {right}
                  </div>
                );
              })()}
            </>
          </div>

          {/* c — Quick actions row */}
          {!schedule.isCancelled && <div style={{ display:"flex", gap:8, marginBottom:8 }}>

            {/* Plus One — always visible */}
            {schedule.gameIsLive && (
              myGuest ? (
                /* Guest card */
                <div style={{ flex:1, padding:"11px 12px", background:"var(--s1)",
                  border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                  display:"flex", flexDirection:"column", gap:6 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <UserPlus size={20} weight="thin" color="var(--t1)" style={{ flexShrink:0 }} />
                      <div>
                        <div style={{ fontSize:13, fontWeight:500, color:"var(--t1)" }}>{myGuest.name}</div>
                        <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300 }}>your +1</div>
                      </div>
                    </div>
                    {canRemoveGuest && (
                      <button onClick={removeMyGuest} disabled={removingGuest} style={{
                        padding:"5px 10px", borderRadius:6,
                        border:"0.5px solid var(--border-subtle)", background:"var(--s3)",
                        color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:11,
                        cursor:"pointer", flexShrink:0 }}>
                        {removingGuest ? "..." : "Remove"}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300 }}>
                    {myGuest.selfPaid ? "Paying cash" : "You're covering payment"}
                  </div>
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

            {/* Injured tile */}
            {me?.injured ? (
              <button onClick={toggleInjury} style={{
                flex:1, padding:"11px 12px",
                background:"var(--red2)", border:"0.5px solid var(--redb)",
                borderRadius:"var(--rs)", boxShadow:"0 0 10px rgba(255,64,64,0.15)",
                display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              }}>
                <Bandaids size={20} weight="thin" color="var(--red)" style={{ flexShrink:0 }} />
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontSize:13, fontWeight:600, color:"var(--red)" }}>Injured</div>
                  <div style={{ fontSize:11, color:"var(--t2)", marginTop:1, fontWeight:300 }}>Tap to clear</div>
                </div>
              </button>
            ) : (
              <button onClick={toggleInjury} style={{
                flex:1, padding:"11px 12px", background:"var(--s1)",
                border:"0.5px solid var(--border-subtle)",
                borderRadius:"var(--rs)",
                display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              }}>
                <Bandaids size={20} weight="thin" color="var(--t1)" style={{ flexShrink:0 }} />
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontSize:13, fontWeight:400, color:"var(--t1)" }}>Injured?</div>
                  <div style={{ fontSize:11, color:"var(--t2)", marginTop:1, fontWeight:300 }}>Mark yourself out</div>
                </div>
              </button>
            )}
          </div>}

          {/* Plus One form (expanded) */}
          {!schedule.isCancelled && showPlusOneForm && (
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

              {/* TEAMS TILE (when confirmed) or IN TILE */}
              {teamsSet ? (
                <div style={{
                  borderRadius:"var(--rs)", overflow:"hidden",
                  border:"0.5px solid rgba(61,220,106,0.35)",
                  background:"linear-gradient(135deg,rgba(61,220,106,0.22) 0%,rgba(61,220,106,0.06) 45%,rgba(10,10,8,0.6) 100%)",
                  boxShadow:"0 0 18px rgba(61,220,106,0.1),inset 0 0 30px rgba(61,220,106,0.05)",
                }}>
                  {/* Header row */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", borderBottom:"0.5px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ padding:"8px 14px", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#60A0FF", display:"flex", alignItems:"center", gap:6, borderRight:"0.5px solid rgba(255,255,255,0.06)" }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:"#60A0FF", boxShadow:"0 0 6px rgba(96,160,255,0.5)", flexShrink:0 }} />
                      Team A · {teamAPlayers.length}
                    </div>
                    <div style={{ padding:"8px 14px", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#FF6060", display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:"#FF6060", boxShadow:"0 0 6px rgba(255,96,96,0.5)", flexShrink:0 }} />
                      Team B · {teamBPlayers.length}
                    </div>
                  </div>
                  {/* Body — two columns */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr" }}>
                    {[
                      ["A", teamAPlayers, "#60A0FF", "rgba(96,160,255,0.15)", "rgba(96,160,255,0.4)"],
                      ["B", teamBPlayers, "#FF6060", "rgba(255,96,96,0.15)",  "rgba(255,96,96,0.4)"],
                    ].map(([team, players, color, avBg, avBorder], colIdx) => (
                      <div key={team} style={{ borderRight: colIdx === 0 ? "0.5px solid rgba(255,255,255,0.06)" : "none", paddingTop:8, paddingBottom:8 }}>
                        {players.map(p => {
                          const isMe    = p.id === myId;
                          const form    = playerForm[p.id] || [];
                          const host    = p.isGuest ? squad.find(h => h.id === p.guestOf) : null;
                          const isMotm  = !!lastMatchMeta?.motm && lastMatchMeta.motm === p.id;
                          const hasBibs = lastMatchMeta?.bibHolder === p.id;
                          const parts   = ((p.nickname || p.name) || "").trim().split(/\s+/);
                          const ini     = parts.length >= 2
                            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                            : ((p.nickname || p.name) || "?").slice(0, 2).toUpperCase();
                          return (
                            <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 14px", background: isMe ? "rgba(232,160,32,0.06)" : "transparent" }}>
                              <div style={{
                                position:"relative",
                                width:28, height:28, borderRadius:"50%",
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize:9, fontWeight:600, flexShrink:0,
                                background: isMe ? "var(--gold2)" : avBg,
                                border:     `0.5px solid ${isMe ? "var(--goldb)" : avBorder}`,
                                color:      isMe ? "var(--gold)" : color,
                                boxShadow:  isMe ? "0 0 8px rgba(232,160,32,0.2)" : "none",
                              }}>
                                {ini}
                                {hasBibs && (
                                  <div style={{
                                    position:"absolute", bottom:0, right:0,
                                    width:10, height:10, borderRadius:"50%",
                                    background:"var(--amber)",
                                  }}/>
                                )}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                                  <span style={{ fontSize:12, color:"var(--t1)", fontWeight:400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flexShrink:1 }}>
                                    {p.nickname || p.name}{isMotm ? " 🏆" : ""}
                                  </span>
                                  {form.length > 0 && (
                                    <div style={{ display:"flex", gap:3, flexShrink:0 }}>
                                      {form.map((r, i) => (
                                        <span key={i} style={{ width:7, height:7, borderRadius:"50%", display:"inline-block",
                                          background: r === "w" ? "var(--green)" : r === "l" ? "var(--red)" : "var(--amber)" }} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {hasBibs && <div style={{ fontSize:9, color:"var(--amber)", fontWeight:300, marginTop:1 }}>{resolveBibHolder(lastMatchMeta?.bibHolder, squad)} has bibs 👕</div>}
                                {host   && <div style={{ fontSize:9, color:"var(--gold)",  fontWeight:300, marginTop:1 }}>+1 {host.nickname || host.name}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Tile colour="green" icon="✅" label="In" count={inPlayers.length}>
                  {inPlayers.map(p => (
                    <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="green" hasGuest={p.isGuest === true} isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} />
                  ))}
                </Tile>
              )}

              {/* RESERVE */}
              {reservePlayers.length > 0 && (
                <div data-gaffer-target="reserve-list">
                  <Tile colour="purple" icon="🟣" label="Reserve" count={reservePlayers.length}>
                    {reservePlayers.map((p, i) => (
                      <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="purple" reserveIndex={i + 1} isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} />
                    ))}
                  </Tile>
                </div>
              )}

              {/* MAYBE */}
              {maybePlayers.length > 0 && (
                <Tile colour="amber" icon="❓" label="Maybe" count={maybePlayers.length}>
                  {maybePlayers.map(p => (
                    <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="amber" isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} />
                  ))}
                </Tile>
              )}

              {/* OUT */}
              {outPlayers.length > 0 && (
                <Tile colour="red" icon="❌" label="Out" count={outPlayers.length}>
                  {outPlayers.map(p => (
                    <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="red" isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} />
                  ))}
                </Tile>
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
                      <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="green" isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>

          {/* Payment history accordion — own card only */}
          {(me?.payCount > 0 || me?.owes > 0) && (() => {
            const TYPE_LABEL = {
              game_fee: 'Game fee', guest_fee: 'Guest fee',
              debt_payment: 'Debt payment', waiver: 'Waived', refund: 'Refund',
              cancelled: 'Match cancelled',
            };
            const STATUS_STYLE = {
              paid:      { bg:"var(--green2)",  border:"var(--greenb)",  color:"var(--green)"  },
              unpaid:    { bg:"var(--amber2)",  border:"var(--amberb)",  color:"var(--amber)"  },
              waived:    { bg:"var(--purple2)", border:"var(--purpleb)", color:"var(--purple)" },
              refunded:  { bg:"rgba(96,160,255,0.12)", border:"rgba(96,160,255,0.3)", color:"#60A0FF" },
              disputed:  { bg:"var(--red2)",   border:"var(--redb)",    color:"var(--red)"    },
              cancelled: { bg:"var(--s3)",     border:"0.5px solid var(--t2)",        color:"var(--t2)"  },
            };
            const fmtDate = iso => iso
              ? new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
              : '—';
            const handleToggle = async () => {
              if (!payHistOpen && payHistory === null) {
                setPayHistLoading(true);
                try {
                  const rows = await getLedgerForPlayer(myId, teamId, 20);
                  setPayHistory(rows);
                } catch { setPayHistory([]); }
                finally { setPayHistLoading(false); }
              }
              setPayHistOpen(o => !o);
            };
            return (
              <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
                borderRadius:"var(--r)", overflow:"hidden", marginBottom:8, marginTop:8 }}>
                <button onClick={handleToggle} style={{
                  width:"100%", padding:"10px 16px",
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  background:"none", border:"none", cursor:"pointer",
                  fontFamily:"var(--font-body)", fontSize:11, fontWeight:600,
                  color:"var(--t2)", letterSpacing:"0.06em", textTransform:"uppercase",
                }}>
                  Payment History
                  <span style={{ fontSize:10, color:"var(--t2)", opacity:0.6 }}>{payHistOpen ? "▲" : "▼"}</span>
                </button>
                {payHistOpen && (
                  <div style={{ paddingBottom:8, borderTop:"0.5px solid var(--b2)" }}>
                    {payHistLoading ? (
                      <div style={{ padding:"8px 16px", fontSize:11, color:"var(--t2)", fontWeight:300 }}>Loading…</div>
                    ) : !payHistory?.length ? (
                      <div style={{ padding:"8px 16px", fontSize:11, color:"var(--t2)", fontWeight:300 }}>No payment history yet</div>
                    ) : payHistory.map((entry, i) => {
                      const ss = STATUS_STYLE[entry.status] || STATUS_STYLE.unpaid;
                      return (
                        <div key={entry.id || i} style={{
                          padding:"7px 16px", display:"flex", alignItems:"center",
                          justifyContent:"space-between", gap:8,
                          borderTop: i === 0 ? "none" : "0.5px solid var(--b2)",
                        }}>
                          <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
                            <div style={{ fontSize:12, color:"var(--t1)", fontWeight:400 }}>
                              {TYPE_LABEL[entry.type] || entry.type}
                            </div>
                            <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300 }}>
                              {fmtDate(entry.createdAt)}
                              {entry.method && <span style={{ opacity:0.6 }}> · {entry.method}</span>}
                            </div>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                            <span style={{
                              fontSize:10, fontWeight:600, padding:"2px 7px",
                              borderRadius:"var(--r-pill)", border:`0.5px solid ${ss.border}`,
                              background:ss.bg, color:ss.color, letterSpacing:"0.04em",
                            }}>
                              {entry.status.toUpperCase()}
                            </span>
                            <span style={{ fontSize:12, fontWeight:600, color:"var(--t1)", minWidth:30, textAlign:"right" }}>
                              £{Number(entry.amount || 0).toFixed(0)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      )}

      {/* STATS tab */}
      {activeTab === "stats" && (
        <StatsView teamId={teamId} squad={squad} bibHistory={bibHistory} matchHistory={matchHistory} settings={settings} schedule={schedule} myId={myId} />
      )}

      {/* HISTORY tab */}
      {activeTab === "history" && (
        <HistoryView matchHistory={matchHistory} players={squad} settings={settings} schedule={schedule} />
      )}

      {/* MY IO tab */}
      {activeTab === "my-io" && (
        <MyIOView player={me} teamId={teamId} teamName={settings?.groupName} />
      )}

      {/* 4 ── NAVBAR */}
      <NavBar activeTab={activeTab} onTabChange={setActiveTab} onAdminClick={isAdmin ? onGoAdmin : undefined} />
    </div>
  );
}
