import React, { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import FixtureCard from "./FixtureCard.jsx";
import LeagueTable from "./LeagueTable.jsx";
import TeamsView from "./TeamsView.jsx";

const gridVariants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } };
const panelVariants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

export default function Dashboard({ state, teams, leagueToken, onRefresh, refreshing }) {
  const [view, setView] = useState("ops"); // ops | table | teams
  const league = state.league ?? {};
  const venue = state.venue ?? {};
  const fixtures = state.fixtures ?? {};
  const thisWeek = fixtures.this_week ?? [];
  const upcoming = fixtures.upcoming ?? [];
  const recent = fixtures.recent ?? [];
  const seasons = state.seasons ?? [];
  const competitions = state.competitions ?? [];
  const teamCount = Object.keys(teams || {}).length;

  const liveCount = thisWeek.filter((f) => f.status === "in_progress").length;
  const onAir = liveCount > 0;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const clockTime = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const clockSec = String(now.getSeconds()).padStart(2, "0");
  const clockDate = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const tickerItems = useMemo(() => {
    const items = [];
    if (venue.name) items.push({ k: "venue", label: venue.name });
    competitions.forEach((c) => items.push({ k: `c-${c.id}`, label: c.name }));
    items.push({ k: "teams", label: `${teamCount} teams` });
    items.push({ k: "seasons", label: `${seasons.length} season${seasons.length === 1 ? "" : "s"}` });
    items.push({ k: "week", label: `${thisWeek.length} fixtures this week` });
    return items;
  }, [venue.name, competitions, teamCount, seasons.length, thisWeek.length]);

  const leagueName = league.name || "League";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-eyebrow">
            <span className={`brand-status ${onAir ? "is-on-air" : ""}`}>
              <span className="brand-status-dot" />
              {onAir ? "On Air" : "Standby"}
            </span>
            <span className="brand-eyebrow-sep">·</span>
            <span>League Control</span>
          </span>
          <h1 className="brand-line1" aria-label={leagueName}>
            {leagueName.split("").map((ch, i) => (
              <span key={i} className="brand-letter" style={{ animationDelay: `${80 + i * 28}ms` }}>
                {ch === " " ? " " : ch}
              </span>
            ))}
          </h1>
          <span className="brand-line2">
            {venue.name || "Independent league"}
            {league.league_code ? ` · ${league.league_code}` : ""}
          </span>
        </div>

        <div className="topbar-mid" />

        <div className="topbar-right">
          <div className="clock" aria-label={`Current time ${clockTime}`}>
            <div className="clock-time"><span>{clockTime}</span><span className="clock-sec">{clockSec}</span></div>
            <div className="clock-date">{clockDate}</div>
          </div>
          <div className="user">
            <button onClick={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
      </header>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...tickerItems, ...tickerItems].map((it, i) => (
            <span key={`${it.k}-${i}`}><b>◆</b>{it.label}</span>
          ))}
        </div>
      </div>

      <nav className="viewnav" aria-label="Dashboard sections">
        {[
          { id: "ops", label: "Operations" },
          { id: "table", label: "Table" },
          { id: "teams", label: "Teams" },
        ].map((t) => (
          <button key={t.id} className={"viewnav-tab" + (view === t.id ? " is-active" : "")} onClick={() => setView(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {view === "table" ? (
        <LeagueTable state={state} leagueToken={leagueToken} />
      ) : view === "teams" ? (
        <TeamsView teams={teams} />
      ) : (
        <motion.main className="content lg-grid" variants={gridVariants} initial="hidden" animate="show">
          <motion.section className="panel lg-thisweek" variants={panelVariants}>
            <h2>This Week {thisWeek.length > 0 && <span className="panel-count">{thisWeek.length}</span>}</h2>
            {thisWeek.length === 0 ? (
              <p className="muted">No fixtures scheduled this week.</p>
            ) : (
              <div className="fixture-list">
                {thisWeek.map((f) => <FixtureCard key={f.id} fx={f} teams={teams} leagueToken={leagueToken} onDone={onRefresh} />)}
              </div>
            )}
          </motion.section>

          <motion.section className="panel lg-recent" variants={panelVariants}>
            <h2>Recent Results {recent.length > 0 && <span className="panel-count">{recent.length}</span>}</h2>
            {recent.length === 0 ? (
              <p className="muted">No completed fixtures yet.</p>
            ) : (
              <div className="fixture-list">
                {recent.slice(0, 12).map((f) => <FixtureCard key={f.id} fx={f} teams={teams} compact leagueToken={leagueToken} onDone={onRefresh} />)}
              </div>
            )}
          </motion.section>

          <motion.section className="panel lg-upcoming" variants={panelVariants}>
            <h2>Upcoming {upcoming.length > 0 && <span className="panel-count">{upcoming.length}</span>}</h2>
            {upcoming.length === 0 ? (
              <p className="muted">No fixtures further out.</p>
            ) : (
              <div className="fixture-list">
                {upcoming.slice(0, 12).map((f) => <FixtureCard key={f.id} fx={f} teams={teams} compact />)}
              </div>
            )}
          </motion.section>
        </motion.main>
      )}
    </div>
  );
}
