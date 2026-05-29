import React from "react";
import { teamColour, timeShort } from "../lib/format.js";

// Shown in the hero slot when no games are live (the "smart" idle state).
export default function UpcomingRecentZone({ upcoming = [], recent = [], customMessage }) {
  const hasAny = upcoming.length > 0 || recent.length > 0;
  return (
    <div className="zone" style={{ flex: 1 }}>
      <div className="zone-head">
        <span className="zone-title">Tonight at the Venue</span>
        <span className="zone-tag">{recent.length} played · {upcoming.length} to come</span>
      </div>
      <div className="zone-body" style={{ display: "grid", gridTemplateColumns: recent.length && upcoming.length ? "1fr 1fr" : "1fr", gap: "1.4rem", overflow: "hidden" }}>
        {!hasAny && (
          <div className="empty">
            <div>
              <div className="big">{customMessage || "No fixtures scheduled today"}</div>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div style={{ minWidth: 0 }}>
            <div className="hdr-sub" style={{ marginBottom: "0.4rem" }}>Recent Results</div>
            {recent.slice(0, 7).map((r) => (
              <div key={r.fixture_id} className="list-fix">
                <span className="list-teams">
                  <span className="tbl-chip" style={{ background: teamColour(r.home_primary_colour, r.home_team_name) }} />
                  {r.home_team_name}
                  <span className="list-score">{r.home_score}–{r.away_score}</span>
                  {r.away_team_name}
                  <span className="tbl-chip" style={{ background: teamColour(r.away_primary_colour, r.away_team_name) }} />
                </span>
              </div>
            ))}
          </div>
        )}

        {upcoming.length > 0 && (
          <div style={{ minWidth: 0 }}>
            <div className="hdr-sub" style={{ marginBottom: "0.4rem" }}>Upcoming</div>
            {upcoming.slice(0, 7).map((u) => (
              <div key={u.fixture_id} className="list-fix">
                <span className="list-time">{timeShort(u.kickoff_time)}</span>
                <span className="list-teams">
                  {u.home_team_name} <span className="vs">v</span> {u.away_team_name}
                </span>
                {u.pitch_name && <span className="list-meta">{u.pitch_name}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
