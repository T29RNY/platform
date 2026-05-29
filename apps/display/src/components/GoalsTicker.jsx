import React from "react";
import { teamColour } from "../lib/format.js";

export default function GoalsTicker({ goals = [], customMessage }) {
  if (!goals.length) {
    return (
      <div className="ticker">
        <div className="ticker-label">⚽ Goals</div>
        <div className="ticker-track" style={{ animation: "none", paddingLeft: "1.6rem" }}>
          <span className="ticker-item" style={{ color: "var(--ink-dim)" }}>
            {customMessage || "No goals yet today — first one's coming…"}
          </span>
        </div>
      </div>
    );
  }
  // duplicate the list so the marquee loops seamlessly (-50% translate)
  const loop = [...goals, ...goals];
  return (
    <div className="ticker">
      <div className="ticker-label">⚽ Goals</div>
      <div className="ticker-track">
        {loop.map((g, i) => (
          <span className="ticker-item" key={i}>
            <span className="ticker-dot" style={{ background: teamColour(g.primary_colour, g.team_name), color: teamColour(g.primary_colour, g.team_name) }} />
            <b style={{ fontWeight: 700 }}>{g.player_name}</b>
            <span style={{ color: "var(--ink-dim)" }}>{g.team_name}</span>
            {g.minute != null && <span className="min">{g.minute}'</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
