import React, { useEffect, useState } from "react";
import { getCupBracket, getGroupStandings } from "@platform/core/storage/supabase.js";

// League Mode Phase 11 Cycle 11.3b — cup bracket on the display board.
// Shown in place of the standings table when the rotating competition is a cup
// (knockouts have no league table). Self-fetches the public bracket; refetches when
// the shown competition changes or the board reloads state (version prop).
export default function BracketZone({ competition, version }) {
  const [bracket, setBracket] = useState(null);
  const [groups, setGroups] = useState([]);
  const compId = competition?.competition_id;

  useEffect(() => {
    if (!compId) return;
    let alive = true;
    Promise.all([getCupBracket(compId), getGroupStandings(compId)])
      .then(([b, gs]) => { if (alive) { setBracket(b); setGroups(gs?.groups ?? []); } })
      .catch((e) => console.error("[display] bracket load failed", e));
    return () => { alive = false; };
  }, [compId, version]);

  if (!competition) return null;
  const rounds = bracket?.rounds ?? [];
  const champion = bracket?.champion;

  return (
    <div className="zone" style={{ flex: 1 }}>
      <div className="zone-head">
        <span className="zone-title">{competition.name}</span>
        <span className="zone-tag">{champion ? "Champion" : "Bracket"}</span>
      </div>
      <div className="zone-body">
        {champion && <div className="bkt-champion">🏆 {champion.name}</div>}
        {groups.length > 0 && (
          <div className="bkt-groups" style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 18 }}>
            {groups.map((g) => <GroupTable key={g.group_label} group={g} />)}
          </div>
        )}
        <div className="bkt-rounds">
          {rounds.map((rd) => (
            <div className="bkt-round" key={rd.round_number}>
              <div className="bkt-round-name">{rd.round_name}</div>
              {(rd.ties ?? []).map((tie) => <BktTie key={tie.id} tie={tie} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupTable({ group }) {
  return (
    <div className="bkt-group" style={{ flex: "1 1 320px", minWidth: 300 }}>
      <div className="bkt-round-name">Group {group.group_label}</div>
      <table className="bkt-group-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ opacity: 0.6 }}>
            <th style={{ textAlign: "left" }}>Team</th>
            <th style={{ textAlign: "right" }}>P</th>
            <th style={{ textAlign: "right" }}>W</th>
            <th style={{ textAlign: "right" }}>D</th>
            <th style={{ textAlign: "right" }}>L</th>
            <th style={{ textAlign: "right" }}>GD</th>
            <th style={{ textAlign: "right" }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {(group.standings ?? []).map((s) => (
            <tr key={s.team_id} className={s.qualifying ? "bkt-q" : ""} style={s.qualifying ? { fontWeight: 700 } : undefined}>
              <td style={{ textAlign: "left" }}>{s.qualifying ? "▸ " : ""}{s.team_name}</td>
              <td style={{ textAlign: "right" }}>{s.played}</td>
              <td style={{ textAlign: "right" }}>{s.w}</td>
              <td style={{ textAlign: "right" }}>{s.d}</td>
              <td style={{ textAlign: "right" }}>{s.l}</td>
              <td style={{ textAlign: "right" }}>{s.gd}</td>
              <td style={{ textAlign: "right" }}>{s.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BktTie({ tie }) {
  const winH = tie.winner_team_id && tie.winner_team_id === tie.home_team_id;
  const winA = tie.winner_team_id && tie.winner_team_id === tie.away_team_id;
  const hasScore = tie.home_score != null && tie.away_score != null;
  const isBye = tie.away_team_id == null && tie.home_source === "bye";

  const row = (name, src, win, score) => (
    <div className={`bkt-row${win ? " win" : ""}`}>
      <span className="bkt-team">{name || (src === "bye" ? "(bye)" : "TBC")}</span>
      {hasScore && !isBye && <span className="bkt-score">{score}</span>}
    </div>
  );

  return (
    <div className="bkt-tie">
      {row(tie.home_team_name, tie.home_source, winH, tie.home_score)}
      {isBye ? <div className="bkt-row bkt-bye"><span className="bkt-team">bye</span></div>
             : row(tie.away_team_name, tie.away_source, winA, tie.away_score)}
    </div>
  );
}
