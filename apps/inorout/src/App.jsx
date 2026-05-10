import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/supabase";
import {
  getPlayers, upsertPlayers,
  getMatches, insertMatch,
  getBibHistory, insertBib,
  getSchedule, upsertSchedule,
  getSettings, upsertSettings,
} from "@platform/supabase";
import {
  SEED_SQUAD, SEED_MATCH_HISTORY, SEED_BIB_HISTORY,
  SEED_SCHEDULE, SEED_SETTINGS, SEED_COVER,
} from "./seeds.js";
import Header       from "./views/Header.jsx";
import PlayerView   from "./views/PlayerView.jsx";
import StatsView    from "./views/StatsView.jsx";
import HistoryView  from "./views/HistoryView.jsx";
import AdminView    from "./views/AdminView/index.jsx";
import InstallBanner from "./views/InstallBanner.jsx";
import Onboarding   from "./onboarding/index.jsx";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&display=swap";

// ─── Routing ──────────────────────────────────────────────────────────────────
function getRoute() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0]==="p"     && parts[1]) return { type:"player", token:parts[1] };
  if (parts[0]==="admin" && parts[1]) return { type:"admin",  token:parts[1] };
  if (parts[0]==="create")            return { type:"create" };
  if (window.location.hostname==="localhost") return { type:"admin", token:"local" };
  return { type:"landing" };
}

export default function App() {
  const route = getRoute();
  const [view,         setView]        = useState("player");
  const [loading,      setLoading]     = useState(true);
  const [error,        setError]       = useState(null);
  const [squad,        setSquadRaw]    = useState([]);
  const [bibHistory,   setBibHistRaw]  = useState([]);
  const [schedule,     setScheduleRaw] = useState(SEED_SCHEDULE);
  const [matchHistory, setMatchHistRaw]= useState([]);
  const [settings,     setSettingsRaw] = useState(SEED_SETTINGS);
  const [myPlayer,     setMyPlayer]    = useState(null);
  const [isAdmin,      setIsAdmin]     = useState(false);

  useEffect(() => {
    // Landing and create don't need data
    if (route.type === "landing" || route.type === "create") {
      setLoading(false); return;
    }

    async function load() {
      try {
        const [players, matches, bibs, sched, setts] = await Promise.all([
          getPlayers(), getMatches(), getBibHistory(), getSchedule(), getSettings(),
        ]);

        // Seed if empty
        const finalPlayers = players.length > 0 ? players : SEED_SQUAD;
        if (players.length === 0) await upsertPlayers(SEED_SQUAD);
        setSquadRaw(finalPlayers);

        if (matches.length === 0) {
          for (const m of SEED_MATCH_HISTORY) await insertMatch(m);
          setMatchHistRaw(SEED_MATCH_HISTORY);
        } else {
          setMatchHistRaw(matches);
        }

        if (bibs.length === 0) {
          for (const b of SEED_BIB_HISTORY) await insertBib(b);
          setBibHistRaw(SEED_BIB_HISTORY);
        } else {
          setBibHistRaw(bibs);
        }

        if (!sched) {
          await upsertSchedule(SEED_SCHEDULE);
          setScheduleRaw(SEED_SCHEDULE);
        } else {
          setScheduleRaw(sched);
        }

        if (!setts) {
          await upsertSettings(SEED_SETTINGS);
          setSettingsRaw(SEED_SETTINGS);
        } else {
          setSettingsRaw(setts);
        }

        // Resolve identity
        if (route.type === "player") {
          const found = finalPlayers.find(p => p.token === route.token);
          setMyPlayer(found || null);
        }

        if (route.type === "admin") {
          const { data } = await supabase
            .from("teams")
            .select("id")
            .eq("admin_token", route.token)
            .single();
          setIsAdmin(!!data || route.token === "local");
        }

        setLoading(false);
      } catch (err) {
        console.error("Load error:", err);
        setError(err.message);
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Setters ──────────────────────────────────────────────────────────────────
  const setSquad = async (updater) => {
    const next = typeof updater==="function" ? updater(squad) : updater;
    setSquadRaw(next);
    try { await upsertPlayers(next); } catch(e) { console.error(e); }
  };
  const setBibHistory = async (updater) => {
    const next = typeof updater==="function" ? updater(bibHistory) : updater;
    if (next.length > bibHistory.length) {
      try { await insertBib(next[0]); } catch(e) { console.error(e); }
    }
    setBibHistRaw(next);
  };
  const setSchedule = async (updater) => {
    const next = typeof updater==="function" ? updater(schedule) : updater;
    setScheduleRaw(next);
    try { await upsertSchedule(next); } catch(e) { console.error(e); }
  };
  const setMatchHistory = async (updater) => {
    const next = typeof updater==="function" ? updater(matchHistory) : updater;
    if (next.length > matchHistory.length) {
      try { await insertMatch(next[0]); } catch(e) { console.error(e); }
    }
    setMatchHistRaw(next);
  };
  const setSettings = async (updater) => {
    const next = typeof updater==="function" ? updater(settings) : updater;
    setSettingsRaw(next);
    try { await upsertSettings(next); } catch(e) { console.error(e); }
  };

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet"; el.href = FONT_LINK;
    document.head.appendChild(el);
  }, []);

  // ── Create / Onboarding ───────────────────────────────────────────────────
  if (route.type === "create") return <Onboarding/>;

  // ── Landing ───────────────────────────────────────────────────────────────
  if (route.type === "landing") return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:52,
        color:C.amber, letterSpacing:4, marginBottom:8, textAlign:"center" }}>
        IN OR OUT
      </div>
      <div style={{ fontSize:14, color:C.muted, textAlign:"center", marginBottom:40, lineHeight:1.6 }}>
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

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:48 }}>⚽</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, color:C.muted }}>Loading...</div>
    </div>
  );

  if (error) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:16, padding:20 }}>
      <div style={{ fontSize:40 }}>⚠️</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
        color:C.red, textAlign:"center" }}>
        Could not connect.<br/>
        <span style={{ color:C.muted, fontSize:12 }}>{error}</span>
      </div>
    </div>
  );

  // ── Invalid player token ──────────────────────────────────────────────────
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

  // ── Invalid admin token ───────────────────────────────────────────────────
  if (route.type==="admin" && !isAdmin) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>🔒</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
        color:C.muted, textAlign:"center" }}>
        Invalid admin link.
      </div>
    </div>
  );

  const myId       = myPlayer?.id || (isAdmin ? squad[0]?.id : null);
  const sharedProps = { squad, setSquad, schedule, setSchedule, settings, setSettings };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <InstallBanner/>
      <Header
        view={view} setView={setView}
        squad={squad} schedule={schedule} settings={settings}
        isAdmin={isAdmin}
        playerName={myPlayer?.name}
      />
      {view==="player"  && <PlayerView  {...sharedProps} myId={myId}/>}
      {view==="stats"   && <StatsView   squad={squad} bibHistory={bibHistory} matchHistory={matchHistory}/>}
      {view==="history" && <HistoryView matchHistory={matchHistory} settings={settings}/>}
      {view==="admin"   && isAdmin && (
        <AdminView
          {...sharedProps}
          bibHistory={bibHistory}     setBibHistory={setBibHistory}
          matchHistory={matchHistory} setMatchHistory={setMatchHistory}
          coverPool={SEED_COVER}
        />
      )}
    </div>
  );
}
