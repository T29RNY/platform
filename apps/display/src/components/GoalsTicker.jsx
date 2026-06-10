import React, { useEffect, useState } from "react";
import { teamColour } from "../lib/format.js";

// Bottom goals ticker (HANDOVER §6.8): gold chevron · 90s doubled-list
// scroll · "synced Ns ago" indicator off the last successful state pull.
export default function GoalsTicker({ goals, lastSyncAt }) {
  const [ago, setAgo] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setAgo(lastSyncAt ? Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000)) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [lastSyncAt]);

  const items = goals || [];
  const renderItems = (suffix) =>
    items.map((g, i) => (
      <div className="t-item" key={`${suffix}-${i}`}>
        <span className="ico">⚽</span>
        {g.minute != null && <span className="min">{g.minute}'</span>}
        <span className="sw" style={{ "--c": teamColour(g.primary_colour, g.team_name || "") }} />
        <span className="plr">{g.player_name || "Goal"}</span>
        {g.team_name && (<><span className="dot">·</span><span className="tm">{g.team_name}</span></>)}
      </div>
    ));

  return (
    <footer className="ticker">
      <div className="ticker__label"><span className="ball" /> Goals tonight</div>
      <div className="ticker__track">
        {items.length ? (
          <div className="ticker__inner">
            {renderItems("a")}
            {renderItems("b")}
          </div>
        ) : (
          <div className="ticker__empty">No goals yet tonight</div>
        )}
      </div>
      <div className="ticker__right">
        <span className="key">↻</span> · live sync · <span>{ago}s ago</span>
      </div>
    </footer>
  );
}
