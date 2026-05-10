import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/supabase";
import {
  getPlayers, upsertPlayers,
  getMatches, insertMatch,
  getBibHistory, insertBib,
  getSchedule, upsertSchedule,
  getSettings, upsertSettings,
  getTeamByAdminToken, getTeamByPlayerToken,
  getPlayerByToken,
} from "@platform/supabase";
import { SEED_COVER } from "./seeds.js";

// Cover pool is team-specific — Finbar's keeps seed data, new teams start empty
// TODO backlog: move cover pool to Supabase cover_pool table per team
const getCoverPool = (tId) => tId === "team_finbars" ? SEED_COVER : [];
import Header       from "./views/Header.jsx";
import PlayerView   from "./views/PlayerView.jsx";
import StatsView    from "./views/StatsView.jsx";
import HistoryView  from "./views/HistoryView.jsx";
import AdminView    from "./views/AdminView/index.jsx";
import InstallBanner from "./views/InstallBanner.jsx";
import Onboarding   from "./onboarding/index.jsx";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&display=swap";

const DEFAULT_SCHEDULE = {
  dayOfWeek:"Tuesday", kickoff:"19:00", venue:"", opensDay:"Wednesday",
  opensTime:"10:00", priorityLeadMins:60, pricePerPlayer:6,
  gameIsLive:false, squadSize:14, gameDateTime:null,
  isDraft:true, isCancelled:false, cancelReason:"",
};
const DEFAULT_SETTINGS = { groupName:"My Team" };

// ─── Routing ──────────────────────────────────────────────────────────────────
function getRoute() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0]==="p"      && parts[1]) return { type:"player", token:parts[1] };
  if (parts[0]==="admin"  && parts[1]) return { type:"admin",  token:parts[1] };
  if (parts[0]==="create")             return { type:"create" };
  if (window.location.hostname==="localhost") return { type:"admin", token:"local" };
  return { type:"landing" };
}

export default function App() {
  const route = getRoute();
  const [view,         setView]        = useState("player");
  const [loading,      setLoading]     = useState(true);
  const [error,        setError]       = useState(null);
  const [teamId,       setTeamId]      = useState(null);
  const [squad,        setSquadRaw]    = useState([]);
  const [bibHistory,   setBibHistRaw]  = useState([]);
  const [schedule,     setScheduleRaw] = useState(DEFAULT_SCHEDULE);
  const [matchHistory, setMatchHistRaw]= useState([]);
  const [settings,     setSettingsRaw] = useState(DEFAULT_SETTINGS);
  const [myPlayer,     setMyPlayer]    = useState(null);
  const [isAdmin,      setIsAdmin]     = useState(false);

  useEffect(() => {
    if (route.type === "landing" || route.type === "create") {
      setLoading(false); return;
    }

    async function load() {
      try {
        let resolvedTeamId = null;

        // ── Resolve team from URL token ──────────────────────────────────────
        if (route.type === "admin") {
          if (route.token === "local") {
            // Dev: use first team
            const { data } = await supabase.from("teams").select("id").limit(1).single();
            resolvedTeamId = data?.id;
            setIsAdmin(true);
          } else {
            const team = await getTeamByAdminToken(route.token);
            if (!team) { setError("Invalid admin link."); setLoading(false); return; }
            resolvedTeamId = team.id;
            setIsAdmin(true);
          }
        }

        if (route.type === "player") {
          const player = await getPlayerByToken(route.token);
          if (!player) { setLoading(false); return; } // handled by invalid token screen
          setMyPlayer(player);
          const team = await getTeamByPlayerToken(route.token);
          if (!team) { setError("Could not find your team."); setLoading(false); return; }
          resolvedTeamId = team.id;
        }

        if (!resolvedTeamId) { setLoading(false); return; }
        setTeamId(resolvedTeamId);

        // ── Load team data ───────────────────────────────────────────────────
        const [players, matches, bibs, sched, setts] = await Promise.all([
          getPlayers(resolvedTeamId),
          getMatches(resolvedTeamId),
          getBibHistory(resolvedTeamId),
          getSchedule(resolvedTeamId),
          getSettings(resolvedTeamId),
        ]);

        setSquadRaw(players);
        setMatchHistRaw(matches);
        setBibHistRaw(bibs);
        setScheduleRaw(sched || DEFAULT_SCHEDULE);
        setSettingsRaw(setts || DEFAULT_SETTINGS);
        setLoading(false);
      } catch (err) {
        console.error("Load error:", err);
        setError(err.message);
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Setters — all pass teamId ─────────────────────────────────────────────
  const setSquad = async (updater) => {
    const next = typeof updater==="function" ? updater(squad) : updater;
    setSquadRaw(next);
    try { await upsertPlayers(next, teamId); } catch(e) { console.error(e); }
  };

  const setBibHistory = async (updater) => {
    const next = typeof updater==="function" ? updater(bibHistory) : updater;
    if (next.length > bibHistory.length) {
      try { await insertBib(next[0], teamId); } catch(e) { console.error(e); }
    }
    setBibHistRaw(next);
  };

  const setSchedule = async (updater) => {
    const next = typeof updater==="function" ? updater(schedule) : updater;
    setScheduleRaw(next);
    try { await upsertSchedule(next, teamId); } catch(e) { console.error(e); }
  };

  const setMatchHistory = async (updater) => {
    const next = typeof updater==="function" ? updater(matchHistory) : updater;
    if (next.length > matchHistory.length) {
      try { await insertMatch(next[0], teamId); } catch(e) { console.error(e); }
    }
    setMatchHistRaw(next);
  };

  const setSettings = async (updater) => {
    const next = typeof updater==="function" ? updater(settings) : updater;
    setSettingsRaw(next);
    try { await upsertSettings(next, teamId); } catch(e) { console.error(e); }
  };

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet"; el.href = FONT_LINK;
    document.head.appendChild(el);
  }, []);

  // ── Routes ────────────────────────────────────────────────────────────────
  if (route.type === "create") return <Onboarding/>;

  if (route.type === "landing") return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:52,
        color:C.amber, letterSpacing:4, marginBottom:8, textAlign:"center" }}>
        IN OR OUT
      </div>
      <div style={{ fontSize:14, color:C.muted, textAlign:"center",
        marginBottom:40, lineHeight:1.6, maxWidth:300 }}>
        The fastest way to organise your weekly football game.<br/>
        No apps. No accounts. Just tap and go.
      </div>
      <a href="/create" style={{ display:"block", width:"100%", maxWidth:320 }}>
        <button style={{ width:"100%", padding:"16px 0", borderRadius:8,
          border:"none", background:C.amber, color:"#000",
          fontFamily:"Inter,sans-serif", fontSize:16, fontWeight:800,
          cursor:"pointer", letterSpacing:0.5 }}>
          Create Your Team →
        </button>
      </a>
      <div style={{ marginTop:16, fontFamily:"Inter,sans-serif",
        fontSize:12, color:C.muted, textAlign:"center" }}>
        Already have a link? Use the link your organiser sent you.
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:48 }}>⚽</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, color:C.muted }}>
        Loading...
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:16, padding:20 }}>
      <div style={{ fontSize:40 }}>⚠️</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
        color:C.red, textAlign:"center" }}>
        {error}<br/>
        <span style={{ color:C.muted, fontSize:12 }}>Check your link and try again.</span>
      </div>
    </div>
  );

  if (route.type==="player" && !myPlayer) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>🔗</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
        color:C.muted, textAlign:"center" }}>
        This link doesn't match any player.<br/>
        Check the link your organiser sent you.
      </div>
    </div>
  );

  const myId        = myPlayer?.id || (isAdmin ? squad[0]?.id : null);
  const sharedProps = { squad, setSquad, schedule, setSchedule, settings, setSettings };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <InstallBanner/>
      <Header
        view={view} setView={setView}
        squad={squad} schedule={schedule} settings={settings}
        isAdmin={isAdmin} playerName={myPlayer?.name}
      />
      {view==="player"  && <PlayerView  {...sharedProps} myId={myId}/>}
      {view==="stats"   && <StatsView   squad={squad} bibHistory={bibHistory} matchHistory={matchHistory}/>}
      {view==="history" && <HistoryView matchHistory={matchHistory} settings={settings}/>}
      {view==="admin"   && isAdmin && (
        <AdminView
          {...sharedProps}
          bibHistory={bibHistory}     setBibHistory={setBibHistory}
          matchHistory={matchHistory} setMatchHistory={setMatchHistory}
          coverPool={getCoverPool(teamId)} teamId={teamId}
        />
      )}
    </div>
  );
}
