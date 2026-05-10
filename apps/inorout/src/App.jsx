import { useState, useEffect } from "react";
import { usePersistedState, colors as C } from "@platform/core";
import {
  SEED_SQUAD, SEED_MATCH_HISTORY, SEED_BIB_HISTORY,
  SEED_SCHEDULE, SEED_SETTINGS, SEED_COVER,
} from "./seeds.js";
import Header     from "./views/Header.jsx";
import PlayerView from "./views/PlayerView.jsx";
import StatsView  from "./views/StatsView.jsx";
import HistoryView from "./views/HistoryView.jsx";
import AdminView  from "./views/AdminView/index.jsx";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&display=swap";

// Admin detection — localhost always, or ?admin=true in URL
const IS_ADMIN = typeof window !== "undefined" &&
  (window.location.search.includes("admin=true") ||
   window.location.hostname === "localhost");

export default function App() {
  const [view, setView] = useState("player");
  const myId = "p1"; // TODO: derive from URL token when Supabase is connected

  const [squad,        setSquad]        = usePersistedState("squad",        SEED_SQUAD);
  const [bibHistory,   setBibHistory]   = usePersistedState("bibHistory",   SEED_BIB_HISTORY);
  const [schedule,     setSchedule]     = usePersistedState("schedule",     SEED_SCHEDULE);
  const [matchHistory, setMatchHistory] = usePersistedState("matchHistory", SEED_MATCH_HISTORY);
  const [settings,     setSettings]     = usePersistedState("settings",     SEED_SETTINGS);

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = FONT_LINK;
    document.head.appendChild(el);
  }, []);

  const sharedProps = { squad, setSquad, schedule, setSchedule, settings, setSettings };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <Header
        view={view} setView={setView}
        squad={squad} schedule={schedule} settings={settings}
        isAdmin={IS_ADMIN}
      />
      {view === "player"  && <PlayerView  {...sharedProps} myId={myId}/>}
      {view === "stats"   && <StatsView   squad={squad} bibHistory={bibHistory} matchHistory={matchHistory}/>}
      {view === "history" && <HistoryView matchHistory={matchHistory} settings={settings}/>}
      {view === "admin"   && IS_ADMIN && (
        <AdminView
          {...sharedProps}
          bibHistory={bibHistory}   setBibHistory={setBibHistory}
          matchHistory={matchHistory} setMatchHistory={setMatchHistory}
          coverPool={SEED_COVER}
        />
      )}
    </div>
  );
}
