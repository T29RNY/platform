import React from "react";

// Full-hero goal celebration overlay (HANDOVER §10). Pure presentational:
// App owns the queue/throttle; `celebration` non-null = active.
export default function GoalCelebration({ celebration }) {
  const c = celebration;
  return (
    <div
      className={`goal-celebration${c ? " active" : ""}`}
      style={c ? { "--c-h": c.cH, "--c-a": c.cA } : undefined}
    >
      <div className="goal-celebration__bg" />
      <div className="goal-celebration__streak" />
      {c && (
        <div className="goal-celebration__card">
          <div className="goal-celebration__word">GOAL</div>
          <div className="goal-celebration__plr">{c.plr}</div>
          <div className="goal-celebration__meta">
            <span className="team-c" style={{ "--c": c.c }} />
            <span>{c.team}</span>
            {c.min && <span className="min">{c.min}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
