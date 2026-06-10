import React from "react";
import { teamColour } from "../lib/format.js";

// Golden Boot panel (HANDOVER §6.5): leader card + top-10 list for the
// competition currently shown in the Live Table (rotates in sync).
// apps comes from mig 244 (lineup membership); G/90 is computed here from
// goals÷apps when apps>0; MoM has no league signal so it never renders.
export default function GoldenBoot({ competition }) {
  const scorers = competition?.top_scorers || [];
  const leader = scorers[0] || null;

  // shared-rank numbering: equal goals ⇒ same rank
  const ranked = scorers.map((s, i) => ({
    ...s,
    rank: i > 0 && scorers[i - 1].goals === s.goals ? null : i + 1,
  }));
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].rank == null) ranked[i].rank = ranked[i - 1].rank;
  }

  const g90 = leader && leader.apps > 0 ? (leader.goals / leader.apps).toFixed(2) : null;
  const leaderC = leader ? teamColour(leader.primary_colour, leader.team_name || "") : "#1E5BAA";

  return (
    <article className="panel">
      <div className="panel__head">
        <div className="panel__title"><span className="swoosh" /> Golden Boot</div>
        <div className="panel__sub">{competition ? `${competition.name} · Top 10` : ""}</div>
      </div>
      {leader ? (
        <div className="panel__body gb">
          <div className="gb__leader" style={{ "--c-leader": leaderC }}>
            <div className="gb__photo">
              <span className="num">{leader.shirt_number != null ? `#${leader.shirt_number}` : "⚽"}</span>
            </div>
            <div className="gb__leader-info">
              <div className="gb__leader-name">{leader.name}</div>
              <div className="gb__leader-team">
                <span className="sw" /> <span>{leader.team_name || ""}</span>
              </div>
              <div className="gb__leader-stats">
                <div className="gb__leader-stat"><span className="v">{leader.apps ?? 0}</span><span className="k">Apps</span></div>
                {g90 && <div className="gb__leader-stat"><span className="v">{g90}</span><span className="k">G/90</span></div>}
              </div>
            </div>
            <div className="gb__leader-goals">
              <div className="big">{leader.goals}</div>
              <div className="lbl">Goals</div>
            </div>
          </div>
          <div className="gb__list">
            {ranked.slice(1, 10).map((s) => (
              <div className="gb__row" key={s.player_id}>
                <div className="gb__rank">{s.rank}</div>
                <div className="gb__sw" style={{ "--c": teamColour(s.primary_colour, s.team_name || "") }} />
                <div>
                  <div className="nm">{s.name}</div>
                  <div className="tm">{s.team_name || ""}</div>
                </div>
                <div className="gb__g">{s.goals}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="panel__body"><div className="panel__empty">No goals yet</div></div>
      )}
    </article>
  );
}
