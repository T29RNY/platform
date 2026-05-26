import React, { useState } from "react";
import PitchForm from "./PitchForm.jsx";
import RefForm from "./RefForm.jsx";

export default function Sidebar({ pitches, refs, venueToken, onDone }) {
  const [pitchForm, setPitchForm] = useState(null); // null | "add" | pitch obj
  const [refForm, setRefForm] = useState(null);

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <h3>Pitches</h3>
        <button className="btn-link" onClick={() => setPitchForm("add")}>+ Add</button>
      </div>
      <ul className="sidebar-list">
        {pitches.length === 0 && <li className="muted">None added yet.</li>}
        {pitches.map((p) => (
          <li key={p.id} className={p.active ? "" : "dim"}>
            <div className="sb-row">
              <span className="sb-name">{p.name}</span>
              <button className="btn-link sb-edit" onClick={() => setPitchForm(p)}>Edit</button>
            </div>
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

      <div className="sidebar-head">
        <h3>Officials</h3>
        <button className="btn-link" onClick={() => setRefForm("add")}>+ Add</button>
      </div>
      <ul className="sidebar-list">
        {refs.length === 0 && <li className="muted">None added yet.</li>}
        {refs.map((r) => (
          <li key={r.id} className={r.active ? "" : "dim"}>
            <div className="sb-row">
              <span className="sb-name">{r.name}</span>
              <button className="btn-link sb-edit" onClick={() => setRefForm(r)}>Edit</button>
            </div>
            <span className="sb-meta">
              {(r.preferred_channel || "push")}
              {r.employment_type ? ` · ${r.employment_type}` : ""}
              {r.overall_rating ? ` · ${Number(r.overall_rating).toFixed(1)}★` : ""}
              {!r.active ? " · retired" : ""}
            </span>
          </li>
        ))}
      </ul>

      {pitchForm && (
        <PitchForm
          venueToken={venueToken}
          pitch={pitchForm === "add" ? null : pitchForm}
          onClose={() => setPitchForm(null)}
          onDone={onDone}
        />
      )}
      {refForm && (
        <RefForm
          venueToken={venueToken}
          refRow={refForm === "add" ? null : refForm}
          onClose={() => setRefForm(null)}
          onDone={onDone}
        />
      )}
    </div>
  );
}
