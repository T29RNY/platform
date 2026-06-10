import React from "react";
import { teamColour, timeShort, kickoffCountdown } from "../lib/format.js";

// Coming Up Tonight (HANDOVER §6.6): today's league upcoming_fixtures first,
// then casual bookings[] (mig 244) as blue-bordered single-team rows.
// Imminent (≤60m) rows tinted gold; red "Needs ref" when official_id is null.
export default function ComingUp({ upcoming, bookings, serverOffset }) {
  const league = (upcoming || []).map((f) => ({
    key: `fx-${f.fixture_id}`,
    ko: timeShort(f.kickoff_time),
    kickoff_time: f.kickoff_time,
    home: f.home_team_name, hc: f.home_primary_colour,
    away: f.away_team_name, ac: f.away_primary_colour,
    comp: f.competition_name,
    kind: f.competition_type === "cup" ? "cup" : "league",
    round: f.round_name,
    pitch: f.pitch_name,
    ref: f.official_name,
    refNeeds: f.official_id == null,
  }));
  const casual = (bookings || []).map((b) => ({
    key: `bk-${b.booking_id}`,
    ko: timeShort(b.kickoff_time),
    kickoff_time: b.kickoff_time,
    home: b.booked_name || "Booked", hc: null,
    away: null, ac: null,
    comp: "Casual",
    kind: "casual",
    pitch: b.pitch_name,
    ref: null, refNeeds: false,
  }));
  const rows = [...league, ...casual];

  return (
    <article className="panel">
      <div className="panel__head">
        <div className="panel__title"><span className="swoosh cool" /> Coming Up Tonight</div>
        <div className="panel__sub">{rows.length ? `${rows.length} to play` : ""}</div>
      </div>
      <div className="panel__body upcoming-list">
        {rows.length === 0 && <div className="panel__empty">Nothing else tonight</div>}
        {rows.slice(0, 8).map((m) => {
          const { label, imminent } = kickoffCountdown(m.kickoff_time, serverOffset);
          return (
            <div className={`uc-row${imminent ? " imminent" : ""}${m.kind === "casual" ? " casual" : ""}`} key={m.key}>
              <div className="uc-ko">
                <div className="t">{m.ko}</div>
                <div className={`inm${imminent ? "" : " far"}`}>{label}</div>
              </div>
              <div className="uc-teams">
                <div className="uc-teamline">
                  <span className="sw" style={{ "--c": m.kind === "casual" ? "var(--cool)" : teamColour(m.hc, m.home || "") }} />
                  <span className="tn">{m.home}</span>
                </div>
                {m.away && (
                  <div className="uc-teamline">
                    <span className="sw" style={{ "--c": teamColour(m.ac, m.away) }} />
                    <span className="tn">{m.away}</span>
                  </div>
                )}
                <div className="uc-comp-row">
                  <span className={`pill ${m.kind === "casual" ? "casual" : m.kind === "cup" ? "cup" : ""}`}>
                    {m.round ? `${m.comp} · ${m.round}` : m.comp}
                  </span>
                  <span className={`pill ${m.pitch ? "pitch" : "tbc"}`}>{m.pitch || "TBC"}</span>
                  {m.kind !== "casual" && (
                    <span className={`ref${m.refNeeds ? " needs" : ""}`}>
                      {m.refNeeds ? "Needs ref" : `Ref ${m.ref}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
