import React from "react";
import Crest from "./Crest.jsx";
import { displayMinute } from "../lib/format.js";

const ICO = { goal: "g", own_goal: "g", yellow_card: "y", red_card: "r", substitution: "s" };

function rankMeta(comp, teamId, side) {
  const rows = comp?.standings_live || [];
  const idx = rows.findIndex((r) => r.team_id === teamId);
  if (idx < 0) return side;
  const n = idx + 1;
  const suf = ["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || "th";
  return `${side} · ${n}${suf} in table`;
}

// Compressed scoreboard for a non-featured live fixture (HANDOVER §6.3).
export default function MiniTile({ fixture: f, comp, serverOffset }) {
  if (!f) {
    return (
      <article className="mini empty">
        <span className="lbl">No other live games</span>
      </article>
    );
  }
  const h = f.home_score ?? 0, a = f.away_score ?? 0;
  const feed = (f.recent_events || []).filter((e) => e.type !== "period_change").slice(0, 3);
  return (
    <article className="mini">
      <div className="mini__head">
        <div className="mini__title">
          <span className="pill">{f.competition_name}</span> {f.pitch_name || ""}
        </div>
        <div className="mini__live"><span className="dot" /> LIVE {displayMinute(f, serverOffset)}</div>
      </div>
      <div className="mini__body">
        <div className={`mini-row${h > a ? " lead" : ""}`}>
          <Crest mini name={f.home_team_name} primary={f.home_primary_colour} secondary={f.home_secondary_colour} />
          <div>
            <div className="mini-row__name">{f.home_team_name}</div>
            <div className="mini-row__meta">{rankMeta(comp, f.home_team_id, "Home")}</div>
          </div>
          <div className="mini-row__score">{h}</div>
        </div>
        <div className={`mini-row${a > h ? " lead" : ""}`}>
          <Crest mini name={f.away_team_name} primary={f.away_primary_colour} secondary={f.away_secondary_colour} />
          <div>
            <div className="mini-row__name">{f.away_team_name}</div>
            <div className="mini-row__meta">{rankMeta(comp, f.away_team_id, "Away")}</div>
          </div>
          <div className="mini-row__score">{a}</div>
        </div>
      </div>
      <div className="mini__feed">
        <span className="lbl">Recent</span>
        {feed.map((ev, i) => (
          <span className="mini-evt" key={`${ev.type}-${ev.minute}-${i}`}>
            <span className="min">{ev.minute != null ? `${ev.minute}'` : ""}</span>
            <span className={`ico ${ICO[ev.type] || "s"}`} />
            <span className="nm">{ev.player_name || ev.type}</span>
          </span>
        ))}
      </div>
    </article>
  );
}
