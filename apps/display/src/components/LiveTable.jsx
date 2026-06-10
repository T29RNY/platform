import React, { useEffect, useRef, useState } from "react";
import BracketZone from "./BracketZone.jsx";
import { teamColour } from "../lib/format.js";

// Rotating standings panel (HANDOVER §6.4). Rotation index + interval are
// owned by App (mode-aware); this renders tabs, the gold progress bar, the
// table with form cascade + rank flash, and the cup bracket for type='cup'.
export default function LiveTable({ comps, activeIdx, intervalSecs, liveTeamIds, serverTime }) {
  const [progress, setProgress] = useState(0);
  const [secLeft, setSecLeft] = useState(intervalSecs);
  const flashRef = useRef(new Map()); // `${compId}|${teamId}` -> last rank
  const [flashed, setFlashed] = useState(() => new Set());

  // progress bar ticks, reset whenever the active tab or interval changes
  useEffect(() => {
    let elapsed = 0;
    setProgress(0); setSecLeft(intervalSecs);
    const id = setInterval(() => {
      elapsed += 200;
      setProgress(Math.min(100, (elapsed / (intervalSecs * 1000)) * 100));
      setSecLeft(Math.max(0, Math.ceil((intervalSecs * 1000 - elapsed) / 1000)));
    }, 200);
    return () => clearInterval(id);
  }, [activeIdx, intervalSecs, comps.length]);

  const comp = comps[activeIdx] || null;
  const rows = comp?.standings_live || [];

  // rank-flash: diff current ranks vs the last render of this comp
  useEffect(() => {
    if (!comp) return;
    const changed = new Set();
    rows.forEach((r, i) => {
      const key = `${comp.competition_id}|${r.team_id}`;
      const prev = flashRef.current.get(key);
      if (prev != null && prev !== i + 1) changed.add(r.team_id);
      flashRef.current.set(key, i + 1);
    });
    if (changed.size) {
      setFlashed(changed);
      const t = setTimeout(() => setFlashed(new Set()), 1700);
      return () => clearTimeout(t);
    }
  }, [comp?.competition_id, JSON.stringify(rows.map((r) => r.team_id))]);

  if (!comp) {
    return (
      <article className="panel">
        <div className="panel__head">
          <div className="panel__title"><span className="swoosh live" /> Live Table</div>
        </div>
        <div className="panel__body"><div className="panel__empty">No active competitions</div></div>
      </article>
    );
  }

  const anyLive = liveTeamIds.size > 0;
  const isCup = comp.type === "cup";

  return (
    <article className="panel">
      <div className="panel__head with-tabs">
        <div className="row1">
          <div className="panel__title">
            <span className={`swoosh${anyLive ? " live" : ""}`} /> {anyLive ? "Live Table" : "Table"}
          </div>
          {comps.length > 1 && <div className="lg-tabs__meta"><span>{secLeft}</span>s</div>}
        </div>
        <div className="row2">
          <div className="lg-tabs">
            {comps.map((c, i) => (
              <div className={`lg-tab${i === activeIdx ? " active" : ""}`} key={c.competition_id}>
                {c.name}
                {i === activeIdx && comps.length > 1 && (
                  <div className="lg-tab__prog" style={{ width: `${progress}%` }} />
                )}
              </div>
            ))}
          </div>
          <div className="panel__sub">{isCup ? "Cup" : anyLive ? "Live" : "Confirmed"}</div>
        </div>
      </div>
      <div className="panel__body">
        {isCup ? (
          <div className="bkt-wrap">
            <BracketZone competition={comp} version={serverTime} />
          </div>
        ) : (
          <table className="table">
            <colgroup>
              <col className="c-rank" /><col className="c-team" />
              <col className="c-n" /><col className="c-n" /><col className="c-n" /><col className="c-n" />
              <col className="c-gd" /><col className="c-pts" /><col className="c-form" />
            </colgroup>
            <thead>
              <tr>
                <th className="l">#</th>
                <th className="l">Team</th>
                <th>P</th><th>W</th><th>D</th><th>L</th>
                <th>GD</th><th>PTS</th>
                <th className="l">Form</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const cls = [];
                if (i === 0) cls.push("lead");
                if (liveTeamIds.has(r.team_id)) cls.push("live-flag");
                if (flashed.has(r.team_id)) cls.push("rank-flash");
                return (
                  <tr className={cls.join(" ")} key={r.team_id} data-team-id={r.team_id}>
                    <td className="rank">{i + 1}</td>
                    <td className="l">
                      <div className="team-cell">
                        <span className="mini-c" style={{ "--c": teamColour(r.primary_colour, r.team_name) }} />
                        <span className="tn">{r.team_name}</span>
                      </div>
                    </td>
                    <td>{r.played}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td>
                    <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="pts">{r.pts}</td>
                    <td className="l">
                      <span className="form" key={`${comp.competition_id}-${activeIdx}`}>
                        {(r.form || []).map((fr, fi) => (
                          <span className={`f ${fr}`} key={fi}>{fr}</span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
}
