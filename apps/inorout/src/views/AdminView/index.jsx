import { useState, useEffect, useRef } from "react";
import {
  sendTemplate, notificationTemplates,
  handleMarkPaid,
  getPlayerLeagueTable,
  reopenWeek,
  goLive,
  sortByReservePriority,
  getTeamNextFixtureLineup,
} from "@platform/core";
import {
  deletePlayer,
  clearPlayerInjury,
  upsertSchedule, adminCancelMatch, addPlayerToTeam,
  getRecentNotification,
  adminSetPlayerStatus,
  adminReorderReserves,
} from "@platform/core/storage/supabase.js";
import {
  CaretRight, Megaphone, XCircle, PaperPlaneTilt,
  UsersThree, FlagCheckered, UserList, CalendarBlank,
  Bell, TShirt, Users, Link as LinkIcon, Money, ClipboardText,
} from "@phosphor-icons/react";
import NavBar      from "../../components/ui/NavBar.jsx";
import FirstTimeHint from "../../components/FirstTimeHint.jsx";
import TeamsScreen    from "./TeamsScreen.jsx";
import ScoreScreen    from "./ScoreScreen.jsx";
import BibsScreen     from "./BibsScreen.jsx";
import SquadScreen    from "./SquadScreen.jsx";
import ScheduleScreen   from "./ScheduleScreen.jsx";
import RemindersScreen  from "./RemindersScreen.jsx";
import PaymentsScreen   from "./PaymentsScreen.jsx";
import TeamsheetScreen   from "./TeamsheetScreen.jsx";
import POTMTiebreakModal from "./POTMTiebreakModal.jsx";
import PlayerProfile    from "../PlayerProfile.jsx";
import AnnounceModal    from "./AnnounceModal.jsx";

// ── inject animation ──────────────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("adm-styles")) {
  const el = document.createElement("style");
  el.id = "adm-styles";
  el.textContent = `@keyframes ioo-blink{0%,100%{opacity:1}50%{opacity:0.3}}`;
  document.head.appendChild(el);
}

// ── helpers ───────────────────────────────────────────────────────────────────
function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.14em",
      textTransform:"uppercase", color:"var(--t2)",
      margin:"16px 0 8px", display:"flex", alignItems:"center", gap:8 }}>
      {children}
      <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,0.06)" }}/>
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────
export default function AdminView({
  squad, setSquad, bibHistory, setBibHistory,
  schedule, setSchedule, matchHistory, setMatchHistory,
  settings, setSettings, coverPool, setCoverPool, teamId,
  liveChannelKey = null,
  screen, setScreen, onGoPlayer, onGoStats, onGoHistory, onGoMyIO,
  isDemoMode = false, onResetDemo, isViceCaptain = false, me = null,
  adminToken = null,
}) {
  const [showCancel,       setShowCancel]       = useState(false);
  const [demoResetState,   setDemoResetState]   = useState(null);
  const [cancelReason,     setCancelReason]     = useState("");
  const [cancelLoading,    setCancelLoading]    = useState(false);
  const [gameOpenLoading,  setGameOpenLoading]  = useState(false);
  const cancelWeekRef = useRef(null);
  const [dragId,           setDragId]           = useState(null);
  const [dismissedOrphans, setDismissedOrphans] = useState(new Set());
  const [orphanErrors,     setOrphanErrors]     = useState({});
  const [selectedPlayer,   setSelectedPlayer]   = useState(null);
  const [openSections,     setOpenSections]     = useState(
    { in:true, reserve:true, maybe:true, out:false, injured:false, noResp:false }
  );
  const [showCoverPool,    setShowCoverPool]    = useState(false);
  const [showAnnounce,     setShowAnnounce]     = useState(false);
  const [chaseToast,       setChaseToast]       = useState(false);
  const [chaseRecentMsg,   setChaseRecentMsg]   = useState(null);
  const [tiebreakDismissed, setTiebreakDismissed] = useState(false);

  // (Just-created overlay is now handled at App.jsx level so it shows
  // immediately on /admin/<token>?just_created=1, regardless of which
  // default view the user lands on.)
  // Win-rate data for the Group Balancer prediction. Fetched here (rather
  // than in TeamsScreen) so the admin shell holds it once and survives
  // screen switches. StatsView still owns its own fetch — dedup is a
  // Phase 2 concern.
  const [tableData, setTableData] = useState({ players: [] });

  // Fetch tableData on mount (and when teamId resolves). All-time period
  // matches what generateBalancedTeams expects — predictions are based on
  // career win rates, not period-filtered.
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getPlayerLeagueTable(teamId, 'all');
        if (!cancelled) setTableData(result ?? { players: [] });
      } catch (err) {
        console.error('AdminView tableData fetch error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // League Mode Cycle 5.6 — competitive teams only. Resolves the next league
  // fixture + any submitted line-up so we can show the Teamsheet card + screen.
  // Returns { fixture: null } for casual teams → card stays hidden.
  const [lineupCtx, setLineupCtx] = useState(null);
  const loadLineupCtx = () => {
    if (!adminToken) return;
    getTeamNextFixtureLineup(adminToken)
      .then(data => setLineupCtx(data || null))
      .catch(err => console.error('AdminView lineupCtx fetch error:', err));
  };
  useEffect(() => { loadLineupCtx(); }, [adminToken]);
  const nextFixture = lineupCtx?.fixture || null;

  // ── derived ──────────────────────────────────────────────────────────────
  const inPlayers      = squad.filter(p => p.status==="in"      && !p.disabled && !p.injured);
  const reservePlayers = sortByReservePriority(squad.filter(p => p.status==="reserve" && !p.disabled && !p.injured));
  const maybePlayers   = squad.filter(p => p.status==="maybe"   && !p.disabled && !p.injured);
  const outPlayers     = squad.filter(p => p.status==="out"     && !p.disabled && !p.injured);
  const injuredPlayers = squad.filter(p => p.injured && !p.disabled);
  const noRespPlayers  = squad.filter(p => p.status==="none"    && !p.disabled && !p.injured);
  const paidCount      = inPlayers.filter(p => p.paid || (p.selfPaid && p.paidBy)).length;
  const totalOwed      = squad.filter(p => !p.disabled).reduce((s, p) => s + (p.owes || 0), 0);
  const teamsSet       = inPlayers.filter(p => !p.isGuest).length > 0
                      && inPlayers.filter(p => !p.isGuest).every(p => p.team);
  const pendingResults = matchHistory.filter(m =>
    !m.cancelled && m.winner == null && new Date(m.matchDate) < new Date()
  ).length;
  const pendingTiebreak = !tiebreakDismissed
    ? matchHistory.find(m => m.adminDecisionPending && m.tiedCandidates?.length > 0)
    : null;
  const orphanedGuests = squad.filter(p =>
    p.isGuest && !p.disabled &&
    squad.find(h => h.id === p.guestOf)?.status !== "in" &&
    !dismissedOrphans.has(p.id)
  );
  const selfPaidPending = inPlayers.filter(p => p.selfPaid === true && p.paid !== true);

  const handleDemoReset = async () => {
    setDemoResetState("resetting");
    try { await onResetDemo?.(); } catch(e) { console.error(e); }
    setDemoResetState("done");
    setTimeout(() => setDemoResetState(null), 3000);
  };

  // ── functions (all preserved from original) ───────────────────────────────
  const dismissOrphan = (id) => setDismissedOrphans(prev => new Set([...prev, id]));
  const reserveGuest  = async (id) => {
    const prev = squad;
    setSquad(squad.map(p => p.id===id ? { ...p, status:"reserve" } : p));
    dismissOrphan(id);
    try {
      await adminSetPlayerStatus(adminToken, id, "reserve");
    } catch (e) {
      console.error(e);
      setSquad(prev);
    }
  };
  const removeGuest   = async (id) => {
    setOrphanErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await deletePlayer(adminToken, id);
      setSquad(squad.filter(p => p.id !== id));
      dismissOrphan(id);
    } catch(e) {
      console.error(e);
      const msg = String(e?.message || "").toLowerCase();
      const friendly =
        msg.includes("has_history")          ? "Can't remove — they have match history. Try disabling instead."
      : msg.includes("invalid_admin_token")  ? "Couldn't remove — your admin link may be out of date. Pull to refresh."
      : msg.includes("not_found")            ? "Already removed — refreshing."
      :                                        "Couldn't remove. Tap again or try later.";
      setOrphanErrors(prev => ({ ...prev, [id]: friendly }));
    }
  };

  const moveReserve = async (fromId, toId) => {
    if (fromId === toId) return;
    const currentOrder = reservePlayers.map(p => p.id);
    const from = currentOrder.indexOf(fromId);
    const to   = currentOrder.indexOf(toId);
    if (from === -1 || to === -1) return;
    const reord = [...currentOrder];
    const [moved] = reord.splice(from, 1);
    reord.splice(to, 0, moved);

    const prev = squad;
    const orderMap = new Map(reord.map((id, idx) => [id, idx]));
    setSquad(squad.map(p =>
      orderMap.has(p.id)
        ? { ...p, reservePriorityOrder: orderMap.get(p.id) }
        : p
    ));

    try {
      await adminReorderReserves(adminToken, reord);
    } catch (e) {
      console.error(e);
      setSquad(prev);
    }
  };

  const cancelWeek = async () => {
    try {
      setCancelLoading(true);

      await adminCancelMatch(adminToken, cancelReason);

      // Push notification to IN+MAYBE+RESERVE
      const notifyIds = squad
        .filter(p => ['in', 'maybe', 'reserve'].includes(p.status) && !p.injured && !p.disabled)
        .map(p => p.id);
      if (notifyIds.length) {
        fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'gameCancelled', teamId,
            playerIds: notifyIds,
            payload: {
              title: 'Game Cancelled',
              body: cancelReason
                ? `❌ ${schedule.dayOfWeek}'s game cancelled: ${cancelReason}`
                : `❌ ${schedule.dayOfWeek}'s game is cancelled.`,
              icon: '/icons/icon-192.png',
            },
            gameDate: schedule.gameDateTime?.split('T')[0],
          }),
        }).catch(console.error);
      }

      // Update local state
      setSquad(sq => sq.map(p => ({
        ...p, status: 'none', paid: false,
        selfPaid: false, paidBy: null, paidAt: null,
      })));
      setSchedule(s => ({
        ...s,
        isCancelled: true,
        gameIsLive: false,
        cancelReason,
        lineupLocked: false,
        activeMatchId: null,
        votingOpen: false,
        votingClosesAt: null,
      }));

      setShowCancel(false);
      setCancelReason('');

    } catch (err) {
      console.error('cancelWeek error:', err);
    } finally {
      setCancelLoading(false);
    }
  };

  const openNextWeek = async () => {
    setGameOpenLoading(true);
    try {
      // Cancel-then-relive needs the reopen RPC — admin_upsert_schedule
      // doesn't touch is_cancelled / active_match_id, so a plain
      // upsertSchedule leaves the schedule in a conflicting state.
      // Plain (non-cancelled) game-live flips stay on the cheap path.
      if (schedule.isCancelled) {
        const result = await reopenWeek(adminToken);
        setSchedule(s => ({
          ...s,
          isCancelled: false,
          gameIsLive: true,
          isDraft: false,
          cancelReason: null,
          activeMatchId: result?.match_id ?? s.activeMatchId,
        }));
      } else {
        // First-time / normal go-live. admin_upsert_schedule alone
        // doesn't create a matches row or set active_match_id, which
        // breaks Make Teams / POTM / payments for brand-new squads
        // (mig 077). Route through admin_go_live which owns the full
        // transaction. Idempotent on re-tap.
        const result = await goLive(adminToken);
        setSchedule(s => ({
          ...s,
          gameIsLive:    true,
          isDraft:       false,
          activeMatchId: result?.match_id ?? s.activeMatchId,
        }));
      }
      sendTemplate(notificationTemplates.gameOpen, schedule.dayOfWeek);
      const ids = squad.filter(p => !p.disabled && !p.injured).map(p => p.id);
      fetch("/api/notify", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          type:"gameLive", teamId, playerIds: ids,
          payload: { title:"In or Out ⚽", body:`⚽ ${schedule.dayOfWeek}'s game is open — are you in or out?`, icon:"/icons/icon-192.png" },
          gameDate: schedule.gameDateTime?.split("T")[0],
        }),
      }).catch(console.error);
    } catch(e) {
      console.error('openNextWeek error:', e);
    } finally {
      setGameOpenLoading(false);
    }
  };

  // Toggle row only renders when game is NOT live (see JSX), so this
  // handler only needs the "turn on" path. Cancel This Week handles
  // going offline.
  const toggleGameLive = () => {
    if (!schedule.gameIsLive) openNextWeek();
  };

  const chaseNoResponders = async () => {
    const ids = noRespPlayers.map(p => p.id);
    if (!ids.length) return;
    const gameDate = schedule.gameDateTime?.split("T")[0] || new Date().toISOString().split("T")[0];
    const recentCount = await getRecentNotification(teamId, "chaseNoResp", gameDate, 120);
    if (recentCount > 0) {
      setChaseRecentMsg(`Already chased ${recentCount} time${recentCount > 1 ? "s" : ""} in the last 2 hours`);
      setTimeout(() => setChaseRecentMsg(null), 4000);
      return;
    }
    setChaseRecentMsg(null);
    fetch("/api/notify", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        type:"chaseNoResp", teamId, playerIds: ids,
        payload: { title:"In or Out ⚽", body:`⏰ Are you in or out for ${schedule.dayOfWeek}? Quick reply needed!`, icon:"/icons/icon-192.png" },
        gameDate,
      }),
    }).catch(console.error);
    setChaseToast(true);
    setTimeout(() => setChaseToast(false), 3000);
  };

  const handleClearInjury = async (p) => {
    try {
      await clearPlayerInjury(adminToken, p.id);
      setSquad(squad.map(s => s.id === p.id ? { ...s, injured:false, injuredSince:null } : s));
    } catch(e) { console.error(e); }
  };

  const markPaid = async (id) => {
    await handleMarkPaid(adminToken, id, schedule.activeMatchId || null).catch(console.error);
    setSquad(squad.map(p => p.id===id ? { ...p, paid:true } : p));
  };

  // ── screen routing ────────────────────────────────────────────────────────
  if (screen === "teams")    return <TeamsScreen    teamId={teamId} adminToken={adminToken} squad={squad} schedule={schedule} matchHistory={matchHistory} tableData={tableData} settings={settings} onBack={() => setScreen("main")}/>;
  if (screen === "score")    return <ScoreScreen    squad={squad} setSquad={setSquad} teamId={teamId} adminToken={adminToken} schedule={schedule} matchHistory={matchHistory} setMatchHistory={setMatchHistory} payments={Object.fromEntries(squad.map(p => [p.id, p.paid]))} bibHistory={bibHistory} onBack={() => setScreen("main")}/>;
  if (screen === "bibs")     return <BibsScreen     squad={squad} setSquad={setSquad} bibHistory={bibHistory} setBibHistory={setBibHistory} schedule={schedule} onBack={() => setScreen("main")}/>;
  if (screen === "squad")    return <SquadScreen    squad={squad} setSquad={setSquad} onBack={() => setScreen("main")} teamId={teamId} adminToken={adminToken} isViceCaptain={isViceCaptain} me={me} onPlayerTap={(p) => { setScreen("main"); setSelectedPlayer(p); }} squadSize={schedule?.squadSize || 14}/>;
  if (screen === "schedule") return <ScheduleScreen schedule={schedule} setSchedule={setSchedule} settings={settings} setSettings={setSettings} onBack={() => setScreen("main")} teamId={teamId} adminToken={adminToken} liveChannelKey={liveChannelKey}/>;
  if (screen === "reminders") return <RemindersScreen schedule={schedule} setSchedule={setSchedule} onBack={() => setScreen("main")} teamId={teamId} adminToken={adminToken}/>;
  if (screen === "payments")  return <PaymentsScreen squad={squad} setSquad={setSquad} schedule={schedule} teamId={teamId} adminToken={adminToken} coverPool={coverPool} onBack={() => setScreen("main")}/> ;
  if (screen === "teamsheet") return <TeamsheetScreen fixture={nextFixture} existingLineup={lineupCtx?.lineup || null} squad={squad} adminToken={adminToken} onBack={() => setScreen("main")} onSubmitted={loadLineupCtx}/>;

  if (selectedPlayer) {
    // Re-resolve from squad so admin actions (rename, injury, VC) reflect
    // the latest optimistic updates without a navigation round-trip.
    const fresh = squad.find(s => s.id === selectedPlayer.id) || selectedPlayer;
    return (
      <PlayerProfile
        me={fresh}
        settings={settings}
        onBack={() => setSelectedPlayer(null)}
        isAdminView
        adminToken={adminToken}
        setSquad={setSquad}
        viewer={me}
        isViceCaptain={isViceCaptain}
      />
    );
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  const AV_STYLE = {
    in:      { bg:"var(--green2)",  border:"var(--greenb)",  color:"var(--green)"  },
    reserve: { bg:"var(--purple2)", border:"var(--purpleb)", color:"var(--purple)" },
    maybe:   { bg:"var(--amber2)",  border:"var(--amberb)",  color:"var(--amber)"  },
    out:     { bg:"var(--red2)",    border:"var(--redb)",    color:"var(--red)"    },
    injured: { bg:"var(--red2)",    border:"var(--redb)",    color:"var(--red)"    },
    noResp:  { bg:"rgba(255,255,255,0.05)", border:"var(--border-subtle)", color:"var(--t2)" },
  };

  const renderPlayerRow = (p, sectionKey, idx, isLast) => {
    const av   = AV_STYLE[sectionKey] || AV_STYLE.noResp;
    const host = p.isGuest ? squad.find(h => h.id === p.guestOf) : null;
    const sub  = p.note ? `"${p.note}"` :
      host          ? `+1 of ${host.name}` :
      sectionKey === "in"      ? "Confirmed" :
      sectionKey === "reserve" ? (idx === 0 ? "Next in queue" : "On standby") :
      sectionKey === "injured" && p.injuredSince
        ? `Since ${new Date(p.injuredSince).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}` :
      sectionKey === "noResp"  ? "No reply yet" : "";

    return (
      <div key={p.id}
        style={{ display:"flex", alignItems:"center", padding:"10px 14px",
          borderBottom: isLast ? "none" : "0.5px solid var(--b2)",
          gap:10, cursor: p.isGuest ? "default" : "pointer" }}
        onClick={() => !p.isGuest && setSelectedPlayer(p)}>

        {sectionKey === "reserve" && (
          <span
            draggable
            onDragStart={() => setDragId(p.id)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => { moveReserve(dragId, p.id); setDragId(null); }}
            onClick={e => e.stopPropagation()}
            style={{ color:"var(--t2)", fontSize:16, cursor:"grab",
              flexShrink:0, userSelect:"none" }}>
            ⠿
          </span>
        )}

        {/* Avatar */}
        <div style={{ width:34, height:34, borderRadius:"50%", flexShrink:0,
          background:av.bg, border:`0.5px solid ${av.border}`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:10, fontWeight:600, color:av.color }}>
          {initials(p.name)}
        </div>

        {/* Name + sub */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, color:"var(--t1)", fontWeight:400,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {p.nickname || p.name}
            {sectionKey === "reserve" && (
              <span style={{ fontSize:10, color:"var(--purple)", fontWeight:400 }}> · #{idx+1}</span>
            )}
          </div>
          {sub && (
            <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:1 }}>{sub}</div>
          )}
        </div>

        {/* Right actions */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}
          onClick={e => e.stopPropagation()}>

          {sectionKey === "in" && (
            <>
              {p.paid || p.selfPaid
                ? <span style={{ background:"var(--green2)", border:"0.5px solid var(--greenb)",
                    borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11,
                    color:"var(--green)", whiteSpace:"nowrap" }}>✓ Paid</span>
                : <span style={{ background:"var(--red2)", border:"0.5px solid var(--redb)",
                    borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11,
                    color:"var(--red)", whiteSpace:"nowrap" }}>Unpaid</span>
              }
              {p.owes > 0 && (
                <span style={{ background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                  borderRadius:"var(--r-pill)", padding:"4px 8px", fontSize:11,
                  color:"var(--amber)", whiteSpace:"nowrap" }}>+£{p.owes}</span>
              )}
            </>
          )}

          {sectionKey === "injured" && (
            <button onClick={() => handleClearInjury(p)}
              style={{ background:"var(--red2)", border:"0.5px solid var(--redb)",
                borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11, color:"var(--red)",
                cursor:"pointer", fontFamily:"var(--font-body)", whiteSpace:"nowrap" }}>
              Clear
            </button>
          )}

          {p.token && (
            <div onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/p/${p.token}`).catch(()=>{})}
              style={{ width:28, height:28, background:"var(--s2)",
                border:"0.5px solid var(--border-subtle)", borderRadius:6,
                display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", flexShrink:0 }}>
              <LinkIcon size={14} weight="thin" color="var(--t2)"/>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (key, icon, label, color, players) => {
    const open = openSections[key];
    const inDebtors = key === "in" && players.filter(p => p.owes > 0);

    return (
      <div key={key} style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
        borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>
        <div onClick={() => toggleSection(key)}
          style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"0 14px", minHeight:48, cursor:"pointer",
            borderBottom: open ? "0.5px solid var(--b2)" : "none" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:14 }}>{icon}</span>
            <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em",
              textTransform:"uppercase", color }}>{label}</span>
            <span style={{ fontFamily:"var(--font-display)", fontSize:20,
              lineHeight:1, color:"var(--t1)" }}>{players.length}</span>
          </div>
          <CaretRight size={16} weight="thin" color="var(--t2)"
            style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}/>
        </div>
        {open && players.map((p, i) =>
          renderPlayerRow(p, key, i, i === players.length - 1 && (!inDebtors || !inDebtors.length))
        )}
        {open && key === "in" && inDebtors.length > 0 && (
          <div style={{ padding:"8px 14px", borderTop:"0.5px solid var(--b2)",
            fontSize:11, color:"var(--t2)", fontWeight:300 }}>
            💸 {inDebtors.length} player{inDebtors.length!==1?"s":""} owe a total of £{inDebtors.reduce((s,p)=>s+p.owes,0)}
          </div>
        )}
      </div>
    );
  };

  const tile = ({ icon: Icon, iconColor, bg, border, title, sub, status, badge, onClick: act }) => (
    <div onClick={act} style={{ background:bg, border:`0.5px solid ${border}`,
      borderRadius:"var(--r)", padding:14, display:"flex", flexDirection:"column",
      gap:6, cursor:"pointer", position:"relative", overflow:"hidden",
      WebkitTapHighlightColor:"transparent" }}>
      <Icon size={22} weight="thin" color={iconColor}/>
      <div style={{ fontSize:13, fontWeight:500, color:"var(--t1)" }}>{title}</div>
      <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, lineHeight:1.3 }}>{sub}</div>
      {status && (
        <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.06em",
          textTransform:"uppercase", color: status.ok ? "var(--green)" : "var(--amber)" }}>
          {status.label}
        </div>
      )}
      {badge > 0 && (
        <div style={{ position:"absolute", top:10, right:10, background:"var(--red)",
          borderRadius:10, padding:"2px 7px", fontSize:9, fontWeight:700, color:"var(--white)" }}>
          {badge}
        </div>
      )}
    </div>
  );

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:110 }}>

      {pendingTiebreak && (
        <POTMTiebreakModal
          match={pendingTiebreak}
          squad={squad}
          teamId={teamId}
          adminToken={adminToken}
          onDecide={() => setTiebreakDismissed(true)}
        />
      )}

      {/* ── Hero card ── */}
      <div style={{ position:"sticky", top:0, zIndex:10 }}>
      <div style={{ position:"relative", height:140, overflow:"hidden", background:"var(--bg)" }}>
        {isDemoMode && (
          <div style={{ position:"absolute", top:12, right:12, zIndex:10 }}>
            <button onClick={handleDemoReset} style={{
              background:"rgba(255,255,255,0.12)", backdropFilter:"blur(12px)",
              border:"0.5px solid rgba(255,255,255,0.15)", borderRadius:"var(--r-pill)",
              padding:"5px 12px", fontSize:10, color:"var(--white)", fontFamily:"var(--font-body)",
              cursor:"pointer", letterSpacing:"0.05em", WebkitTapHighlightColor:"transparent",
            }}>
              {demoResetState === "resetting" ? "Resetting..." : demoResetState === "done" ? "Demo Reset ✓" : "🔄 Reset Demo"}
            </button>
          </div>
        )}
        <img src="https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80"
          alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%",
            objectFit:"cover", filter:"brightness(0.35) saturate(0.6)" }}/>
        <div style={{ position:"absolute", inset:0,
          background:"linear-gradient(180deg,rgba(10,10,8,0.2) 0%,rgba(10,10,8,0.82) 100%)" }}/>
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"12px 16px",
          display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
          {/* Left */}
          <div>
            {settings?.groupName && (
              <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.14em",
                textTransform:"uppercase", color:"var(--gold)", marginBottom:2 }}>
                {settings.groupName}
              </div>
            )}
            <div style={{ fontFamily:"var(--font-display)", fontSize:34, lineHeight:0.95,
              letterSpacing:"0.02em", fontStyle:"italic", color:"var(--t1)" }}>
              ADMIN <span style={{ color:"var(--green)" }}>PANEL</span>
            </div>
          </div>
          {/* Right — glass chips */}
          <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
            {[
              { num: inPlayers.length, label:"In this week", color:"var(--green)", glow:true },
              { num: paidCount,        label:"Paid",         color:"var(--green)", glow:true },
              { num: `£${totalOwed}`,  label:"Outstanding",  color:"var(--red)",   glow:false },
            ].map(({ num, label, color, glow }) => (
              <div key={label} style={{ background:"rgba(255,255,255,0.1)",
                backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
                border:"0.5px solid rgba(255,255,255,0.18)", borderRadius:"var(--rs)",
                width:80, height:56, flexShrink:0,
                display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                <div style={{ fontFamily:"var(--font-display)", fontSize:26, lineHeight:1, color,
                  textShadow: glow ? "0 0 10px rgba(61,220,106,0.4)" : "none" }}>
                  {num}
                </div>
                <div style={{ fontSize:9, fontWeight:300, letterSpacing:"0.08em",
                  textTransform:"uppercase", color:"rgba(242,240,234,0.6)", marginTop:1 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding:"10px 16px 0" }}>

        {/* Alert banners */}
        {orphanedGuests.map(guest => {
          const host = squad.find(h => h.id === guest.guestOf);
          return (
            <div key={guest.id} style={{ background:"var(--amber2)", border:"0.5px solid var(--amberb)",
              borderRadius:"var(--r)", padding:"12px 14px", marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:500, color:"var(--amber)", marginBottom:4 }}>
                👤 {guest.name}'s host dropped out
              </div>
              <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:10 }}>
                {host?.name || "Their host"} is now out. What should happen to {guest.name}?
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {[
                  { label:"Keep IN",        action:() => dismissOrphan(guest.id),  color:"var(--green)",  bg:"var(--green2)",  border:"var(--greenb)" },
                  { label:"Move to reserve",action:() => reserveGuest(guest.id),  color:"var(--purple)", bg:"var(--purple2)", border:"var(--purpleb)" },
                  { label:`Remove ${guest.name}`,action:() => removeGuest(guest.id), color:"var(--red)",   bg:"var(--red2)",    border:"var(--redb)" },
                ].map(({ label, action, color, bg, border }) => (
                  <button key={label} onClick={action} style={{ padding:"6px 12px",
                    borderRadius:"var(--r-pill)", border:`0.5px solid ${border}`,
                    background:bg, color, fontFamily:"var(--font-body)",
                    fontSize:12, fontWeight:500, cursor:"pointer" }}>
                    {label}
                  </button>
                ))}
              </div>
              {orphanErrors[guest.id] && (
                <div style={{ marginTop:8, fontSize:11, color:"var(--red)", fontWeight:400 }}>
                  {orphanErrors[guest.id]}
                </div>
              )}
            </div>
          );
        })}

        {selfPaidPending.length > 0 && (
          <>
            <style>{`@keyframes ioo-gold-pulse{0%{box-shadow:0 0 0px var(--goldb)}50%{box-shadow:0 0 16px var(--goldb)}100%{box-shadow:0 0 0px var(--goldb)}}`}</style>
            <div style={{
              background:"var(--gold2)", border:"0.5px solid var(--goldb)",
              borderLeft:"3px solid var(--gold)",
              borderRadius:"var(--r)", padding:"12px 14px", marginBottom:8,
              animation:"ioo-gold-pulse 2s ease-in-out infinite",
            }}>
              <div style={{ fontFamily:"var(--font-display)", fontSize:15,
                letterSpacing:"0.08em", color:"var(--gold)", marginBottom:8 }}>
                💰 PAYMENT CONFIRMATIONS · {selfPaidPending.length}
              </div>
              {selfPaidPending.map((p, i) => (
                <div key={p.id} style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  gap:8, paddingTop: i === 0 ? 0 : 8,
                  borderTop: i === 0 ? "none" : "0.5px solid rgba(232,160,32,0.2)",
                }}>
                  <div style={{ fontSize:13, color:"var(--t1)", fontWeight:400, flex:1, minWidth:0 }}>
                    {p.paidBy === 'host'
                      ? `Host paid for ${p.nickname || p.name}`
                      : (
                          <>
                            {p.nickname || p.name} · £{schedule.pricePerPlayer || 0} cash
                            {p.owes > 0 && <span style={{ color:"var(--red)" }}> + £{p.owes} debt</span>}
                          </>
                        )
                    }
                  </div>
                  <button onClick={() => markPaid(p.id)} style={{
                    padding:"5px 14px", borderRadius:"var(--r-pill)", border:"none",
                    background:"var(--gold)", color:"var(--black)",
                    fontFamily:"var(--font-display)", fontSize:13,
                    letterSpacing:"0.06em", cursor:"pointer", flexShrink:0,
                  }}>CONFIRM ✓</button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Game live state.
            When NOT live: full toggle row with clear "Make this week's
            game live" label.
            When live: status badge only — no toggle. Going offline is
            via Cancel This Week below. */}
        {schedule.gameIsLive ? (
          <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--r)", padding:"14px 16px",
            display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", flexShrink:0,
              background:"var(--green)",
              boxShadow:"0 0 8px rgba(61,220,106,0.6)",
              animation:"ioo-blink 2s infinite" }}/>
            <div style={{
              fontFamily:"'Bebas Neue', sans-serif", fontSize:15,
              color:"var(--t1)", letterSpacing:"0.08em",
            }}>
              LIVE
            </div>
          </div>
        ) : (
          <FirstTimeHint
            storageKey="ioo_game_live_hint_dismissed"
            placement="bottom"
            title="MAKE YOUR GAME LIVE"
            body="Flip this on so players can confirm In or Out. After the first game, future weeks open automatically."
          >
            <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
              borderRadius:"var(--r)", padding:"14px 16px",
              display:"flex", alignItems:"center", justifyContent:"space-between",
              marginBottom:10,
              opacity: gameOpenLoading ? 0.6 : 1,
              pointerEvents: gameOpenLoading ? "none" : "auto" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", flexShrink:0,
                  background:"var(--t2)" }}/>
                <div style={{ fontSize:15, fontWeight:400, color:"var(--t1)" }}>
                  Make this week's game live
                </div>
              </div>
              <div onClick={toggleGameLive} style={{ width:44, height:26, borderRadius:13,
                background:"var(--s3)", position:"relative", flexShrink:0,
                cursor:"pointer", transition:"all 0.2s" }}>
                <div style={{ width:20, height:20, background:"var(--white)", borderRadius:"50%",
                  position:"absolute", top:3, left:3, transition:"all 0.2s",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.3)" }}/>
              </div>
            </div>
          </FirstTimeHint>
        )}

        {/* This Week tiles — Make Teams + Input Result.
            Moved up from below the roster (was hidden way down) so the
            screen reads top-to-bottom as a workflow: live status →
            tonight's work → live actions → roster admin. */}
        <SectionLabel>This Week</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          {tile({
            icon:UsersThree, iconColor:"#60A0FF",
            bg:"linear-gradient(135deg,rgba(96,160,255,0.14) 0%,rgba(96,160,255,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(96,160,255,0.25)",
            title:"Make Teams", sub:"Split squad into A and B",
            status:{ ok:teamsSet, label: teamsSet ? "Teams confirmed ✓" : "Not confirmed" },
            badge:0, onClick:() => setScreen("teams"),
          })}
          {tile({
            icon:FlagCheckered, iconColor:"var(--green)",
            bg:"linear-gradient(135deg,rgba(61,220,106,0.14) 0%,rgba(61,220,106,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(61,220,106,0.25)",
            title:"Input Result", sub:"Score, scorers, POTM, bibs",
            badge:pendingResults, onClick:() => setScreen("score"),
          })}
        </div>

        {/* Actions section */}
        <SectionLabel>Actions</SectionLabel>
        {chaseToast && (
          <div style={{ background:"var(--green2)", border:"0.5px solid var(--greenb)",
            borderRadius:"var(--rs)", padding:"8px 14px", marginBottom:8,
            fontSize:12, color:"var(--green)" }}>
            ✓ Chase sent to {noRespPlayers.length} player{noRespPlayers.length!==1?"s":""}
          </div>
        )}
        {chaseRecentMsg && (
          <div style={{ padding:"6px 14px", marginBottom:8,
            fontSize:12, color:"var(--amber)", fontWeight:300 }}>
            {chaseRecentMsg}
          </div>
        )}
        <div ref={cancelWeekRef} style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
          borderRadius:"var(--r)", overflow:"hidden", marginBottom:10 }}>
          {[
            {
              key:"chase", iconEl:<Megaphone size={18} weight="thin" color="var(--amber)"/>,
              iconBg:"var(--amber2)", iconBorder:"var(--amberb)",
              title:"Chase No-Responses",
              sub:`Nudge the ${noRespPlayers.length} player${noRespPlayers.length!==1?"s":""} who haven't replied`,
              badge: noRespPlayers.length, action: chaseNoResponders,
            },
            {
              key:"cancel", iconEl:<XCircle size={18} weight="thin" color="var(--red)"/>,
              iconBg:"var(--red2)", iconBorder:"var(--redb)",
              title:"Cancel This Week",
              sub:"Notify all confirmed players",
              badge:0, action:() => setShowCancel(true),
            },
            {
              key:"announce", iconEl:<PaperPlaneTilt size={18} weight="thin" color="var(--purple)"/>,
              iconBg:"var(--purple2)", iconBorder:"var(--purpleb)",
              title:"Announce to Squad",
              sub:"Choose who receives your message",
              badge:0, action:() => setShowAnnounce(true),
            },
          ].map(({ key, iconEl, iconBg, iconBorder, title, sub, badge, action }, i) => (
            <div key={key} onClick={action}
              style={{ display:"flex", alignItems:"center", padding:"12px 14px",
                borderBottom: i < 2 ? "0.5px solid var(--b2)" : "none",
                cursor:"pointer", gap:12,
                WebkitTapHighlightColor:"transparent" }}>
              <div style={{ width:36, height:36, borderRadius:"var(--rs)", flexShrink:0,
                background:iconBg, border:`0.5px solid ${iconBorder}`,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                {iconEl}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:"var(--t1)" }}>{title}</div>
                <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:2 }}>{sub}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                {badge > 0 && (
                  <div style={{ background:"var(--amber)", borderRadius:10, padding:"2px 8px",
                    fontSize:10, fontWeight:600, color:"var(--black)" }}>{badge}</div>
                )}
                <CaretRight size={16} weight="thin" color="var(--t2)"
                  style={{ transform: key==="cancel" && showCancel ? "rotate(90deg)" : "none",
                    transition:"transform 0.2s" }}/>
              </div>
            </div>
          ))}
        </div>

        {/* Cancel modal */}
        {showCancel && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
            backdropFilter:"blur(8px)", zIndex:300,
            display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"var(--s2)", border:"0.5px solid var(--redb)",
              borderRadius:16, width:"100%", maxWidth:380, padding:24 }}>
              <div style={{ fontFamily:"'Bebas Neue', sans-serif", fontSize:28,
                color:"var(--red)", marginBottom:8, letterSpacing:"0.04em" }}>
                CANCEL THIS WEEK?
              </div>
              <div style={{ fontFamily:"var(--font-body)", fontWeight:300, fontSize:13,
                color:"var(--t2)", marginBottom:20 }}>
                This will clear all responses and refund any payments made this week
              </div>
              <input
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason e.g. Venue flooded (optional)"
                onFocus={e => { e.target.style.border = "0.5px solid var(--t2)"; }}
                onBlur={e  => { e.target.style.border = "0.5px solid var(--s3)";  }}
                style={{ width:"100%", background:"var(--s3)", color:"var(--t1)",
                  border:"0.5px solid var(--s3)", borderRadius:10, padding:"10px 14px",
                  fontFamily:"var(--font-body)", fontWeight:300, fontSize:13,
                  outline:"none", boxSizing:"border-box", marginBottom:16 }}/>
              <button
                onClick={cancelWeek}
                disabled={cancelLoading}
                style={{ width:"100%", background:"var(--red)", color:"var(--white)",
                  fontFamily:"'Bebas Neue', sans-serif", fontSize:18, letterSpacing:"0.08em",
                  border:"none", borderRadius:24, padding:12, marginBottom:8,
                  cursor: cancelLoading ? "default" : "pointer",
                  opacity: cancelLoading ? 0.6 : 1 }}>
                {cancelLoading ? "CANCELLING…" : "CANCEL THIS WEEK"}
              </button>
              <button
                onClick={() => { setShowCancel(false); setCancelReason(""); }}
                disabled={cancelLoading}
                style={{ width:"100%", background:"var(--s3)", color:"var(--t2)",
                  fontFamily:"'Bebas Neue', sans-serif", fontSize:18, letterSpacing:"0.08em",
                  border:"none", borderRadius:24, padding:12,
                  cursor: cancelLoading ? "default" : "pointer",
                  opacity: cancelLoading ? 0.6 : 1 }}>
                Keep it on
              </button>
            </div>
          </div>
        )}

        {/* Live Board */}
        <SectionLabel>Live Board</SectionLabel>
        {renderSection("in",      "✅", "In",          "var(--green)",  inPlayers)}
        {renderSection("reserve", "🟣", "Reserve",     "var(--purple)", reservePlayers)}
        {renderSection("maybe",   "❓", "Maybe",       "var(--amber)",  maybePlayers)}
        {renderSection("out",     "❌", "Out",          "var(--red)",    outPlayers)}
        {renderSection("injured", "🤕", "Injured",     "var(--red)",    injuredPlayers)}
        {renderSection("noResp",  "⏳", "No Response", "var(--t2)",     noRespPlayers)}

        {/* Manage tiles */}
        <SectionLabel>Manage</SectionLabel>
        {nextFixture && (
          <div style={{ marginBottom:8 }}>
            {tile({
              icon: ClipboardText, iconColor:"var(--purple)",
              bg:"linear-gradient(135deg, var(--purple2), transparent)",
              border:"var(--purpleb)",
              title:"Teamsheet",
              sub:`${nextFixture.is_home ? "vs" : "@"} ${nextFixture.opponent_name || "TBC"}${lineupCtx?.lineup ? " · submitted" : ""}`,
              badge:0, onClick:() => setScreen("teamsheet"),
            })}
          </div>
        )}
        <div style={{ marginBottom:8 }}>
          {tile({
            icon: Money, iconColor:"var(--green)",
            bg:"linear-gradient(135deg, var(--green2), transparent)",
            border:"var(--greenb)",
            title:"Payments",
            sub:`£${totalOwed} outstanding`,
            badge:0, onClick:() => setScreen("payments"),
          })}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          {tile({
            icon:UserList, iconColor:"var(--gold)",
            bg:"linear-gradient(135deg,rgba(232,160,32,0.14) 0%,rgba(232,160,32,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(232,160,32,0.25)",
            title:"Squad",
            sub:`${squad.filter(p=>!p.disabled&&!p.isGuest).length} players · ${squad.filter(p=>p.isGuest&&!p.disabled).length} guests`,
            badge:0, onClick:() => setScreen("squad"),
          })}
          {tile({
            icon:CalendarBlank, iconColor:"var(--purple)",
            bg:"linear-gradient(135deg,rgba(176,96,240,0.14) 0%,rgba(176,96,240,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(176,96,240,0.25)",
            title:"Match Settings",
            sub:[schedule.dayOfWeek, schedule.venue, schedule.pricePerPlayer != null ? `£${schedule.pricePerPlayer}` : null].filter(Boolean).join(" · ") || "Not configured",
            badge:0, onClick:() => setScreen("schedule"),
          })}
          {tile({
            icon:Bell, iconColor:"var(--amber)",
            bg:"linear-gradient(135deg,rgba(255,176,32,0.14) 0%,rgba(255,176,32,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(255,176,32,0.25)",
            title:"Reminders", sub:"Quiet hours · triggers",
            badge:0, onClick:() => setScreen("reminders"),
          })}
          {tile({
            icon:TShirt, iconColor:"var(--gold)",
            bg:"linear-gradient(135deg,rgba(232,160,32,0.14) 0%,rgba(232,160,32,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(232,160,32,0.25)",
            title:"Bibs",
            sub: bibHistory[0]?.returned === false
              ? `${bibHistory[0].name} has them`
              : "Not assigned",
            badge:0, onClick:() => setScreen("bibs"),
          })}
        </div>

        {/* Cover Pool */}
        <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
          borderRadius:"var(--r)", overflow:"hidden", marginBottom:10 }}>
          <div onClick={() => setShowCoverPool(o => !o)}
            style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"0 14px", minHeight:48, cursor:"pointer",
              borderBottom: showCoverPool && coverPool.length ? "0.5px solid var(--b2)" : "none" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8,
              fontSize:11, fontWeight:600, letterSpacing:"0.08em",
              textTransform:"uppercase", color:"var(--t2)" }}>
              <Users size={16} weight="thin"/>
              Cover Pool · {coverPool.length} player{coverPool.length!==1?"s":""}
            </div>
            <CaretRight size={14} weight="thin" color="var(--t2)"
              style={{ transform: showCoverPool ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}/>
          </div>
          {showCoverPool && coverPool.map(cp => (
            <div key={cp.id} style={{ display:"flex", alignItems:"center", padding:"9px 14px",
              borderTop:"0.5px solid var(--b2)", gap:10 }}>
              <div style={{ width:30, height:30, borderRadius:"50%", background:"var(--s3)",
                border:"0.5px solid var(--border-subtle)", display:"flex", alignItems:"center",
                justifyContent:"center", fontSize:9, fontWeight:600, color:"var(--t2)",
                flexShrink:0 }}>
                {initials(cp.name)}
              </div>
              <div style={{ flex:1, fontSize:12, color:"var(--t2)" }}>{cp.name}</div>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginRight:8 }}>
                {cp.played} game{cp.played!==1?"s":""}
              </div>
              <button onClick={async () => {
                try {
                  const guest = await addPlayerToTeam(adminToken, cp.name, 'regular', false);
                  setSquad([...squad, guest]);
                } catch(e) { console.error(e); }
              }} style={{ background:"var(--s2)", border:"0.5px solid var(--border-subtle)",
                borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11,
                color:"var(--t2)", cursor:"pointer", fontFamily:"var(--font-body)" }}>
                + Add
              </button>
            </div>
          ))}
        </div>

      </div>

      {/* Announce modal */}
      {showAnnounce && (
        <AnnounceModal
          squad={squad} settings={settings} teamId={teamId} schedule={schedule}
          onClose={() => setShowAnnounce(false)}
        />
      )}

      {/* NavBar */}
      <NavBar
        activeTab="admin"
        onTabChange={(id) => {
          if (id === "my-view") onGoPlayer?.();
          else if (id === "stats") onGoStats?.();
          else if (id === "history") onGoHistory?.();
          else if (id === "my-io") onGoMyIO?.();
        }}
        onAdminClick={() => {}}
      />
    </div>
  );
}
