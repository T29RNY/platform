import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

// ⌘K command palette. Builds an in-memory index from already-loaded state
// (fixtures, teams, pitches, officials) — no search endpoint needed at this
// scale. Selecting a result switches to the relevant tab via onNavigate.
function buildIndex(state) {
  const idx = [];
  const teams = state.teams || {};
  const teamName = (id) => teams[id]?.name || "TBC";
  const allFixtures = [
    ...(state.fixtures?.tonight || []),
    ...(state.fixtures?.this_week || []),
    ...(state.fixtures?.upcoming || []),
    ...(state.fixtures?.recent || []),
  ];
  const seen = new Set();
  allFixtures.forEach((f) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    idx.push({
      group: "Fixtures", icon: "ops", iconCls: "fixture", tab: "ops",
      title: `${teamName(f.home_team_id)} vs ${teamName(f.away_team_id)}`,
      sub: `${f.scheduled_date || ""}${f.kickoff_time ? " · " + f.kickoff_time : ""}`,
      key: `${teamName(f.home_team_id)} ${teamName(f.away_team_id)}`,
    });
  });
  Object.values(teams).forEach((t) => idx.push({
    group: "Teams", icon: "teams", iconCls: "team", tab: "teams",
    title: t.name, sub: "Team", key: t.name,
  }));
  (state.pitches || []).forEach((p) => idx.push({
    group: "Pitches & officials", icon: "pitch", iconCls: "", tab: "ops",
    title: p.name, sub: `Pitch${p.surface ? " · " + p.surface : ""}`, key: p.name,
  }));
  (state.refs || []).forEach((r) => idx.push({
    group: "Pitches & officials", icon: "whistle", iconCls: "", tab: "staff",
    title: r.name, sub: "Official", key: r.name,
  }));
  return idx;
}

export default function SearchPalette({ state, onClose, onNavigate }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const index = useMemo(() => buildIndex(state), [state]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return index.slice(0, 8);
    return index.filter((r) => (r.key + " " + r.sub).toLowerCase().includes(term)).slice(0, 30);
  }, [q, index]);

  const groups = useMemo(() => {
    const m = new Map();
    results.forEach((r) => { if (!m.has(r.group)) m.set(r.group, []); m.get(r.group).push(r); });
    return [...m.entries()];
  }, [results]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [q]);

  const choose = (r) => { if (r) { onNavigate?.({ tab: r.tab }); onClose?.(); } };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
    else if (e.key === "Escape") { onClose?.(); }
  };

  let flatIdx = -1;
  return createPortal(
    <div className="palette-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="palette" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fixtures, teams, pitches, officials…" />
        </div>
        <div className="palette-body">
          {results.length === 0 ? (
            <div className="palette-empty">No matches for “{q}”.</div>
          ) : (
            groups.map(([group, rows]) => (
              <div className="palette-group" key={group}>
                <div className="palette-group-label">{group}</div>
                {rows.map((r) => {
                  flatIdx += 1;
                  const i = flatIdx;
                  return (
                    <button
                      key={i}
                      className={"palette-row" + (i === active ? " active" : "")}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(r)}
                    >
                      <span className={"palette-ico palette-ico-" + (r.iconCls || "")}><Icon name={r.icon} size={15} /></span>
                      <span className="palette-text">
                        <span className="palette-title">{r.title}</span>
                        {r.sub && <span className="palette-sub">{r.sub}</span>}
                      </span>
                      <span className="palette-meta">{r.tab}</span>
                      <span className="palette-arrow">↵</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span className="palette-hint"><span className="kbd">↑↓</span> navigate</span>
          <span className="palette-hint"><span className="kbd">↵</span> open</span>
          <span className="palette-hint"><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
