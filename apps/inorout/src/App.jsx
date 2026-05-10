import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";
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
import Header      from "./views/Header.jsx";
import PlayerView  from "./views/PlayerView.jsx";
import StatsView   from "./views/StatsView.jsx";
import HistoryView from "./views/HistoryView.jsx";
import AdminView   from "./views/AdminView/index.jsx";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&display=swap";

const IS_ADMIN = typeof window !== "undefined" &&
  (window.location.search.includes("admin=true") ||
   window.location.hostname === "localhost");

function getMyId() {
  const parts = window.location.pathname.split("/");
  const idx   = parts.indexOf("p");
  return idx !== -1 && parts[idx + 1] ? parts[idx + 1] : "p1";
}

export default function App() {
  const [view,         setView]        = useState("player");
  const [loading,      setLoading]     = useState(true);
  const [error,        setError]       = useState(null);
  const [squad,        setSquadRaw]    = useState([]);
  const [bibHistory,   setBibHistRaw]  = useState([]);
  const [schedule,     setScheduleRaw] = useState(SEED_SCHEDULE);
  const [matchHistory, setMatchHistRaw]= useState([]);
  const [settings,     setSettingsRaw] = useState(SEED_SETTINGS);
  const myId = getMyId();

  useEffect(() => {
    async function load() {
      try {
        const [players, matches, bibs, sched, setts] = await Promise.all([
          getPlayers(), getMatches(), getBibHistory(), getSchedule(), getSettings(),
        ]);

        if (players.length === 0) {
          await upsertPlayers(SEED_SQUAD);
          setSquadRaw(SEED_SQUAD);
        } else {
          setSquadRaw(players);
        }

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

        setLoading(false);
      } catch (err) {
        console.error("Supabase error:", err);
        setError(err.message);
        setLoading(false);
      }
    }
    load();
  }, []);

  const setSquad = async (updater) => {
    const next = typeof updater === "function" ? updater(squad) : updater;
    setSquadRaw(next);
    try { await upsertPlayers(next); } catch (e) { console.error(e); }
  };

  const setBibHistory = async (updater) => {
    const next = typeof updater === "function" ? updater(bibHistory) : updater;
    if (next.length > bibHistory.length) {
      try { await insertBib(next[0]); } catch (e) { console.error(e); }
    }
    setBibHistRaw(next);
  };

  const setSchedule = async (updater) => {
    const next = typeof updater === "function" ? updater(schedule) : updater;
    setScheduleRaw(next);
    try { await upsertSchedule(next); } catch (e) { console.error(e); }
  };

  const setMatchHistory = async (updater) => {
    const next = typeof updater === "function" ? updater(matchHistory) : updater;
    if (next.length > matchHistory.length) {
      try { await insertMatch(next[0]); } catch (e) { console.error(e); }
    }
    setMatchHistRaw(next);
  };

  const setSettings = async (updater) => {
    const next = typeof updater === "function" ? updater(settings) : updater;
    setSettingsRaw(next);
    try { await upsertSettings(next); } catch (e) { console.error(e); }
  };

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet"; el.href = FONT_LINK;
    document.head.appendChild(el);
  }, []);

  if (loading) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:48 }}>⚽</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, color:C.muted }}>Loading...</div>
    </div>
  );

  if (error) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, padding:20 }}>
      <div style={{ fontSize:40 }}>⚠️</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, color:C.red, textAlign:"center" }}>
        Could not connect.<br/>
        <span style={{ color:C.muted, fontSize:12 }}>{error}</span>
      </div>
    </div>
  );

  const sharedProps = { squad, setSquad, schedule, setSchedule, settings, setSettings };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <Header
        view={view} setView={setView}
        squad={squad} schedule={schedule} settings={settings}
        isAdmin={IS_ADMIN}
      />
      {view==="player"  && <PlayerView  {...sharedProps} myId={myId}/>}
      {view==="stats"   && <StatsView   squad={squad} bibHistory={bibHistory} matchHistory={matchHistory}/>}
      {view==="history" && <HistoryView matchHistory={matchHistory} settings={settings}/>}
      {view==="admin"   && IS_ADMIN && (
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
