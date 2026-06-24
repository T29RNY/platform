import React from "react";
import Icon from "./Icon.jsx";

// Quick-access filters for the schedule. All client-side. Chips toggle on/off;
// non-matching blocks are hidden by the parent. Pitch chips hidden on mobile
// (DayAgenda has its own pitch picker).
export default function CalendarFilters({
  pitches, hiddenPitches, onTogglePitch,
  q, onQ, f, onToggle, onClear, isMobile,
}) {
  const Chip = ({ k, label, cls }) => (
    <button className={"cal-chip" + (f[k] ? " is-active " + (cls || "") : "")} onClick={() => onToggle(k)}>
      {label}
    </button>
  );
  const anyActive = q.trim() || hiddenPitches.size > 0 ||
    Object.values(f).some(Boolean);

  return (
    <div className="cal-filters">
      <div className="cal-search">
        <Icon name="search" size={13} />
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Find a team or customer…" />
        {q && <button className="cal-search-x" onClick={() => onQ("")} aria-label="Clear search">×</button>}
      </div>

      <div className="cal-chiprow">
        <Chip k="paid" label="Paid" cls="chip-ok" />
        <Chip k="owed" label="Owed" cls="chip-warn" />
        <span className="cal-sep" />
        <Chip k="oneoff" label="One-off" />
        <Chip k="block" label="Block" />
        <Chip k="league" label="League" />
        <Chip k="training" label="Training" />
        <Chip k="match" label="Match" />
        <Chip k="maint" label="Maintenance" />
        <span className="cal-sep" />
        <Chip k="pending" label="Pending" />
        <Chip k="isnew" label="New" cls="chip-accent" />
        <Chip k="free" label="Free slots" />
        {anyActive && <button className="cal-clear" onClick={onClear}>Clear</button>}
      </div>

      {!isMobile && pitches.length > 1 && (
        <div className="cal-chiprow">
          <span className="cal-rowlabel">Pitches</span>
          {pitches.map((p) => (
            <button
              key={p.id}
              className={"cal-chip cal-pitch " + (hiddenPitches.has(p.id) ? "is-off" : "is-on")}
              onClick={() => onTogglePitch(p.id)}
              aria-pressed={!hiddenPitches.has(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
