import React, { useState } from "react";
import ResultModal from "./ResultModal.jsx";
import FixtureManageModal from "./FixtureManageModal.jsx";

const MANAGEABLE = new Set(["scheduled", "allocated", "postponed"]);

// League fixture card — three bands (kickoff/status · matchup · meta). Team
// names resolve through the `teams` map (league_list_teams). On a completed
// fixture the league admin can correct the result (leagueToken + onDone).
export default function FixtureCard({ fx, teams = {}, compact, leagueToken, onDone }) {
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const home = teams[fx.home_team_id]?.name || fx.home_team_id;
  const away = fx.away_team_id ? (teams[fx.away_team_id]?.name || fx.away_team_id) : "(bye)";
  const homeCol = teams[fx.home_team_id]?.primary_colour || "var(--accent)";
  const awayCol = teams[fx.away_team_id]?.primary_colour || "var(--ink-faint)";
  const dateStr = fx.scheduled_date ? formatDate(fx.scheduled_date) : "—";
  const timeStr = fx.kickoff_time ? formatTime(fx.kickoff_time) : "TBC";
  const cls = "fx" + (compact ? " fx-compact" : "") + " fx-status-" + (fx.status || "scheduled");

  return (
    <div className={cls}>
      <div className="fx-top">
        <span className="fx-kick">
          <span className="fx-time">{timeStr}</span>
          <span className="fx-date">{dateStr}</span>
        </span>
        <span className="fx-status-pill">{labelStatus(fx)}</span>
      </div>
      <div className="fx-teams">
        <span className="fx-team fx-home">
          <span className="fx-tick" style={{ background: homeCol }} />
          <span className="fx-team-name">{home}</span>
        </span>
        {renderScore(fx)}
        <span className="fx-team fx-away">
          <span className="fx-team-name">{away}</span>
          <span className="fx-tick" style={{ background: awayCol }} />
        </span>
      </div>
      {(fx.round_name || (leagueToken && (fx.status === "completed" || MANAGEABLE.has(fx.status)))) && (
        <div className="fx-foot">
          <div className="fx-tags">{fx.round_name && <span className="fx-ref">{fx.round_name}</span>}</div>
          {leagueToken && (
            <div className="row-actions">
              {fx.status === "completed" && <button onClick={() => setEditing(true)}>Edit result</button>}
              {MANAGEABLE.has(fx.status) && <button onClick={() => setManaging(true)}>Manage</button>}
            </div>
          )}
        </div>
      )}

      {editing && (
        <ResultModal leagueToken={leagueToken} fixture={fx} homeName={home} awayName={away}
          onClose={() => setEditing(false)} onDone={onDone} />
      )}
      {managing && (
        <FixtureManageModal leagueToken={leagueToken} fixture={fx} homeName={home} awayName={away}
          onClose={() => setManaging(false)} onDone={onDone} />
      )}
    </div>
  );
}

function renderScore(fx) {
  if (fx.status === "completed" && fx.home_score != null && fx.away_score != null) {
    return <div className="fx-score">{fx.home_score}<span className="fx-score-sep">–</span>{fx.away_score}</div>;
  }
  if (fx.status === "walkover" && fx.walkover_winner_id) {
    return <div className="fx-score fx-score-walkover">{fx.walkover_winner_id === fx.home_team_id ? "3–0" : "0–3"}</div>;
  }
  return <div className="fx-score-vs">vs</div>;
}

function labelStatus(fx) {
  switch (fx.status) {
    case "scheduled":   return "Scheduled";
    case "allocated":   return "Allocated";
    case "in_progress": return "Live";
    case "completed":   return "Result";
    case "postponed":   return "Postponed";
    case "void":        return "Void";
    case "walkover":    return "Walkover";
    case "forfeit":     return "Forfeit";
    default:            return fx.status;
  }
}
function formatDate(iso) {
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}
function formatTime(t) {
  const m = String(t || "").match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : String(t || "");
}
