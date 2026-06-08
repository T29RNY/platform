import React from "react";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

// League overview — the leagues, seasons and competitions this venue runs.
// Read-only; season creation routes through the Season Wizard via onNewSeason.
export default function LeagueView({ state, onNewSeason }) {
  const leagues = state.leagues ?? [];
  const seasons = state.seasons ?? [];
  const competitions = state.competitions ?? [];

  const seasonsByLeague = (leagueId) => seasons.filter((s) => s.league_id === leagueId);
  const compsBySeason = (seasonId) => competitions.filter((c) => c.season_id === seasonId);

  return (
    <div>
      <SectionHead label="Leagues" count={`${leagues.length} league${leagues.length === 1 ? "" : "s"} · ${seasons.length} season${seasons.length === 1 ? "" : "s"}`}>
        <button className="btn btn-sm btn-primary" onClick={onNewSeason}>
          <Icon name="plus" size={14} /> Set up new season
        </button>
      </SectionHead>

      {leagues.length === 0 ? (
        <EmptyState title="No leagues configured yet" body="Set up a season to generate fixtures." />
      ) : (
        leagues.map((lg) => {
          const lgSeasons = seasonsByLeague(lg.id);
          return (
            <div key={lg.id} className="league-card">
              <div className="lh">
                <h3>{lg.name}</h3>
                <span className="lmeta" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {lg.short_name && <span className="pill pill-muted">{lg.short_name}</span>}
                  {lg.format && <span className="pill pill-muted">{String(lg.format).replace(/_/g, " ")}</span>}
                  {lg.day_of_week != null && <span className="pill pill-muted">{dayName(lg.day_of_week)}s</span>}
                  {lg.default_kickoff_time && <span className="pill pill-muted">{stripSeconds(lg.default_kickoff_time)}</span>}
                  <span className="pill pill-muted">{(lg.standings_visibility || "public")} table</span>
                </span>
                {lg.league_code && <span className="lcode">{lg.league_code}</span>}
              </div>

              {lgSeasons.length === 0 ? (
                <div className="season-row"><span className="text-mute">No seasons yet — set one up to generate fixtures.</span></div>
              ) : (
                lgSeasons.map((s) => (
                  <div key={s.id} className="season-row">
                    <div>
                      <div className="sname">{s.name}</div>
                      <div className="sdate">{fmtDate(s.start_date)} – {fmtDate(s.end_date)} · {s.num_weeks}w</div>
                      <div className="comps">
                        {compsBySeason(s.id).map((c) => (
                          <span key={c.id} className={"pill " + (c.type === "cup" ? "pill-accent" : "pill-info")}>{c.name}</span>
                        ))}
                      </div>
                    </div>
                    <span className="pill pill-muted" style={{ textTransform: "capitalize", alignSelf: "start" }}>{s.status || "draft"}</span>
                  </div>
                ))
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function dayName(n) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][n] || "";
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
