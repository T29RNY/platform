import React from "react";

export default function Sidebar({ pitches, refs }) {
  return (
    <div className="sidebar">
      <h3>Pitches</h3>
      <ul className="sidebar-list">
        {pitches.length === 0 && <li className="muted">None added yet.</li>}
        {pitches.map((p) => (
          <li key={p.id} className={p.active ? "" : "dim"}>
            <span className="sb-name">{p.name}</span>
            <span className="sb-meta">
              {p.surface || "—"}
              {p.capacity ? ` · cap ${p.capacity}` : ""}
              {!p.active ? " · closed" : !p.is_available ? " · unavailable" : ""}
            </span>
            {Array.isArray(p.maintenance_windows) && p.maintenance_windows.length > 0 && (
              <span className="sb-warn">
                {p.maintenance_windows.length} maintenance window{p.maintenance_windows.length === 1 ? "" : "s"}
              </span>
            )}
          </li>
        ))}
      </ul>

      <h3>Officials</h3>
      <ul className="sidebar-list">
        {refs.length === 0 && <li className="muted">None added yet.</li>}
        {refs.map((r) => (
          <li key={r.id} className={r.active ? "" : "dim"}>
            <span className="sb-name">{r.name}</span>
            <span className="sb-meta">
              {(r.preferred_channel || "push")}
              {r.employment_type ? ` · ${r.employment_type}` : ""}
              {r.overall_rating ? ` · ${Number(r.overall_rating).toFixed(1)}★` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
