import React from "react";
import { motion } from "framer-motion";

// League management — the leagues, seasons and competitions this venue runs.
// Read-only overview today (all data is in venue state); season creation
// routes through the existing Season Wizard via onNewSeason.
export default function LeagueView({ state, onNewSeason }) {
  const leagues = state.leagues ?? [];
  const seasons = state.seasons ?? [];
  const competitions = state.competitions ?? [];

  const seasonsByLeague = (leagueId) => seasons.filter((s) => s.league_id === leagueId);
  const compsBySeason = (seasonId) => competitions.filter((c) => c.season_id === seasonId);

  return (
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">Leagues</h2>
          <p className="mgmt-sub">{leagues.length} league{leagues.length === 1 ? "" : "s"} · {seasons.length} season{seasons.length === 1 ? "" : "s"}</p>
        </div>
        <button className="btn-accent" onClick={onNewSeason}>+ Set up new season</button>
      </div>

      {leagues.length === 0 ? (
        <div className="panel mgmt-empty">
          <p className="muted">No leagues configured yet.</p>
        </div>
      ) : (
        <motion.div className="league-stack"
          variants={{ show: { transition: { staggerChildren: 0.06 } } }}
          initial="hidden" animate="show">
          {leagues.map((lg) => {
            const lgSeasons = seasonsByLeague(lg.id);
            return (
              <motion.section key={lg.id} className="panel league-card"
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
                <div className="league-card-head">
                  <div>
                    <h3 className="league-name">{lg.name}</h3>
                    <div className="league-tags">
                      {lg.short_name && <span className="lg-tag">{lg.short_name}</span>}
                      {lg.format && <span className="lg-tag">{String(lg.format).replace(/_/g, " ")}</span>}
                      {lg.day_of_week != null && <span className="lg-tag">{dayName(lg.day_of_week)}s</span>}
                      {lg.default_kickoff_time && <span className="lg-tag">{stripSeconds(lg.default_kickoff_time)}</span>}
                      <span className={"lg-tag lg-vis-" + (lg.standings_visibility || "public")}>
                        {(lg.standings_visibility || "public")} table
                      </span>
                    </div>
                  </div>
                  {lg.league_code && <span className="league-code">{lg.league_code}</span>}
                </div>

                {lgSeasons.length === 0 ? (
                  <p className="muted league-empty">No seasons yet — set one up to generate fixtures.</p>
                ) : (
                  <div className="season-list">
                    {lgSeasons.map((s) => (
                      <div key={s.id} className="season-row">
                        <div className="season-id">
                          <span className="season-name">{s.name}</span>
                          <span className="season-dates">{fmtDate(s.start_date)} – {fmtDate(s.end_date)} · {s.num_weeks}w</span>
                        </div>
                        <div className="season-comps">
                          {compsBySeason(s.id).map((c) => (
                            <span key={c.id} className={"comp-chip comp-" + (c.type || "league")}>{c.name}</span>
                          ))}
                          <span className={"season-status status-" + (s.status || "draft")}>{s.status || "draft"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.section>
            );
          })}
        </motion.div>
      )}
    </main>
  );
}

function dayName(n) {
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][n] || "";
}
function stripSeconds(t) {
  const m = String(t || "").match(/^(\d{2}:\d{2})/);
  return m ? m[1] : t;
}
function fmtDate(iso) {
  if (!iso) return "TBC";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  catch { return iso; }
}
