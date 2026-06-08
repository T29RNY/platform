import React, { useState } from "react";
import PitchForm from "./PitchForm.jsx";
import RefForm from "./RefForm.jsx";
import Icon from "./Icon.jsx";

// v2 right-rail: Pitches + Officials cards (.sb-card). Add/Edit keep their real
// PitchForm / RefForm wiring (venueAddPitch / venueUpdatePitch / venueAddRef …).
export default function Sidebar({ pitches, refs, venueToken, onDone }) {
  const [pitchForm, setPitchForm] = useState(null); // null | "add" | pitch obj
  const [refForm, setRefForm] = useState(null);

  const activePitches = pitches.filter((p) => p.active).length;
  const activeRefs = refs.filter((r) => r.active).length;

  return (
    <aside className="sidebar">
      <div className="sb-card">
        <header className="sb-head">
          <h3>Pitches</h3>
          <span className="count">{activePitches} active</span>
        </header>
        <div className="sb-list">
          {pitches.length === 0 && <div className="sb-row"><span /><div className="meta">None added yet.</div><span /></div>}
          {pitches.map((p) => {
            const maint = p.active && !p.is_available;
            return (
              <div key={p.id} className={"sb-row" + (!p.active ? " inactive" : "") + (maint ? " maint" : "")}>
                <span className="pip" />
                <div>
                  <div className="name">{p.name}</div>
                  <div className="meta">
                    {p.surface || "—"}{p.capacity ? ` · cap ${p.capacity}` : ""}
                    {maint ? " · in maintenance" : ""}{!p.active ? " · retired" : ""}
                  </div>
                </div>
                <button className="btn btn-xs btn-ghost" onClick={() => setPitchForm(p)}>Edit</button>
              </div>
            );
          })}
        </div>
        <div className="sb-foot">
          <button className="btn btn-sm" onClick={() => setPitchForm("add")}>
            <Icon name="plus" size={14} /> Add pitch
          </button>
        </div>
      </div>

      <div className="sb-card">
        <header className="sb-head">
          <h3>Officials</h3>
          <span className="count">{activeRefs} active</span>
        </header>
        <div className="sb-list">
          {refs.length === 0 && <div className="sb-row"><span /><div className="meta">None added yet.</div><span /></div>}
          {refs.map((r) => (
            <div key={r.id} className={"sb-row" + (!r.active ? " inactive" : "")}>
              <span className="pip" />
              <div>
                <div className="name">{r.name}</div>
                <div className="meta">
                  {(r.employment_type || "freelance").replace("_", " ")}
                  {r.overall_rating ? ` · ★${Number(r.overall_rating).toFixed(1)}` : ""}
                  {!r.active ? " · retired" : ""}
                </div>
              </div>
              <button className="btn btn-xs btn-ghost" onClick={() => setRefForm(r)}>Edit</button>
            </div>
          ))}
        </div>
        <div className="sb-foot">
          <button className="btn btn-sm" onClick={() => setRefForm("add")}>
            <Icon name="plus" size={14} /> Add official
          </button>
        </div>
      </div>

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
    </aside>
  );
}
