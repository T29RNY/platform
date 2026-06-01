import React, { useEffect, useState } from "react";
import { getCupBracket } from "@platform/core/storage/supabase.js";

// League Mode Phase 11 Cycle 11.3b — cup bracket on the display board.
// Shown in place of the standings table when the rotating competition is a cup
// (knockouts have no league table). Self-fetches the public bracket; refetches when
// the shown competition changes or the board reloads state (version prop).
export default function BracketZone({ competition, version }) {
  const [bracket, setBracket] = useState(null);
  const compId = competition?.competition_id;

  useEffect(() => {
    if (!compId) return;
    let alive = true;
    getCupBracket(compId)
      .then((b) => { if (alive) setBracket(b); })
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
