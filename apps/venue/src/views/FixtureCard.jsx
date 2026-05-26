import React from "react";
import FixtureActions from "./FixtureActions.jsx";

export default function FixtureCard({ fx, state, venueToken, onDone, prominent, compact, withActions }) {
  const teams = state.teams || {};
  const home = teams[fx.home_team_id]?.name || fx.home_team_id;
  const away = fx.away_team_id ? (teams[fx.away_team_id]?.name || fx.away_team_id) : "(bye)";
  const pitch = lookupPitch(state, fx.playing_area_id);
  const ref = lookupRef(state, fx.official_id);
  const dateStr = fx.scheduled_date ? formatDate(fx.scheduled_date) : "—";
  const timeStr = fx.kickoff_time ? formatTime(fx.kickoff_time) : "";

  const cls =
    "fx" +
    (prominent ? " fx-prominent" : "") +
    (compact ? " fx-compact" : "") +
    " fx-status-" + (fx.status || "scheduled");

  return (
    <div className={cls}>
      <div className="fx-when">
        <div className="fx-date">{dateStr}</div>
        {timeStr && <div className="fx-time">{timeStr}</div>}
      </div>
      <div className="fx-teams">
        <div className="fx-team fx-home">{home}</div>
        {renderScore(fx)}
        <div className="fx-team fx-away">{away}</div>
      </div>
      <div className="fx-meta">
        <span className="fx-status-pill">{labelStatus(fx)}</span>
        {pitch && <span className="fx-pitch">{pitch.name}</span>}
        {ref && <span className="fx-ref">{ref.name}</span>}
        {withActions && (
          <FixtureActions venueToken={venueToken} fixture={fx} state={state} onDone={onDone} />
        )}
      </div>
    </div>
  );
}

function renderScore(fx) {
  if (fx.status === "completed" && fx.home_score != null && fx.away_score != null) {
    return <div className="fx-score">{fx.home_score} – {fx.away_score}</div>;
  }
  if (fx.status === "walkover" && fx.walkover_winner_id) {
    const wantHome = fx.walkover_winner_id === fx.home_team_id;
    return <div className="fx-score fx-score-walkover">{wantHome ? "3 – 0" : "0 – 3"}</div>;
  }
  if (fx.status === "forfeit" && fx.forfeit_winner_id) {
    const wantHome = fx.forfeit_winner_id === fx.home_team_id;
    return <div className="fx-score fx-score-forfeit">{wantHome ? "3 – 0" : "0 – 3"}</div>;
  }
  return <div className="fx-score-vs">vs</div>;
}

function labelStatus(fx) {
  switch (fx.status) {
    case "scheduled":   return "Needs pitch";
    case "allocated":   return fx.official_id ? "All set" : "Needs ref";
    case "in_progress": return "Live";
    case "completed":   return "Result";
    case "postponed":   return "Postponed";
    case "void":        return "Void";
    case "walkover":    return "Walkover";
    case "forfeit":     return "Forfeit";
    default:            return fx.status;
  }
}

function lookupPitch(state, id) {
  if (!id) return null;
  return (state.pitches || []).find((p) => p.id === id) || null;
}
function lookupRef(state, id) {
  if (!id) return null;
  return (state.refs || []).find((r) => r.id === id) || null;
}
function formatDate(iso) {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch { return iso; }
}
function formatTime(t) {
  if (!t) return "";
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : String(t);
}
