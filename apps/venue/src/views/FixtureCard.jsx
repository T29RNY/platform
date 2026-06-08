import React, { useEffect, useRef, useState } from "react";
import FixtureActions from "./FixtureActions.jsx";
import Icon from "./Icon.jsx";
import { TeamCrest, StatusPill, deriveStatusForCard, FixtureCompact } from "./atoms.jsx";
import { getInitials, dayLabel } from "../lib/format.js";

// v2 fixture card (.fxc). `compact` renders the list-row variant for
// recent/upcoming. Real pitch/ref/status actions stay wired through
// <FixtureActions> (venueAssignPitch / venueAssignRef / venueUpdateFixtureStatus).
export default function FixtureCard({ fx, state, venueToken, onDone, prominent, compact, withActions, animateScore }) {
  const teams = state.teams || {};
  const teamFor = (id) => (id ? teams[id] : null);

  if (compact) {
    return <FixtureCompact fx={fx} teamFor={teamFor} dayLabel={dayLabel} />;
  }

  const home = teamFor(fx.home_team_id);
  const away = teamFor(fx.away_team_id);
  const pitch = (state.pitches || []).find((p) => p.id === fx.playing_area_id) || null;
  const ref = (state.refs || []).find((r) => r.id === fx.official_id) || null;
  const status = deriveStatusForCard(fx);
  const live = fx.status === "in_progress";
  const completed = fx.status === "completed";
  const showScore = live || completed || fx.home_score != null;

  const cls = [
    "fxc",
    live && "fxc--live",
    completed && "fxc--completed",
    ["postponed", "void", "walkover", "forfeit"].includes(fx.status) && "fxc--" + fx.status,
  ].filter(Boolean).join(" ");

  return (
    <article className={cls}>
      <header className="fxc-head">
        <span className="when">{dayLabel(fx.scheduled_date)} {fx.kickoff_time}</span>
        {fx.round_name && <><span className="dot" /><span className="meta">{fx.round_name}</span></>}
        <span className="spacer" />
        {live
          ? <span className="pill pill-live"><span className="pill-dot" />Live</span>
          : <StatusPill status={status} />}
      </header>

      <div className="fxc-body">
        <div className="fxc-team">
          <TeamCrest team={home} size={28} />
          <span className="name">{home?.name || fx.home_team_id}</span>
        </div>
        <Score show={showScore} value={fx.home_score} fx={fx} side="home" animate={animateScore} />
        <div className="fxc-team">
          <TeamCrest team={away} size={28} />
          <span className="name">{away ? away.name : "(bye)"}</span>
        </div>
        <Score show={showScore} value={fx.away_score} fx={fx} side="away" animate={animateScore} />
      </div>

      {(live || completed) && (
        <div className="fxc-progress">
          <div className="fxc-progress-fill" style={{ width: (completed ? 100 : 50) + "%" }} />
        </div>
      )}

      <footer className="fxc-foot">
        <span className="assign">
          <Icon name="pitch" size={12} />
          {pitch ? <strong>{pitch.name.replace(/ \(.*\)/, "")}</strong> : <span className="needs">Pitch?</span>}
        </span>
        <span className="assign">
          <Icon name="whistle" size={12} />
          {ref ? <strong>{ref.name.split(" ")[0]}</strong> : <span className="needs">Ref?</span>}
        </span>
        <span className="spacer" />
        {withActions && (
          <span className="actions">
            <FixtureActions venueToken={venueToken} fixture={fx} state={state} onDone={onDone} />
          </span>
        )}
      </footer>
    </article>
  );
}

// Walkover/forfeit synthesise a 3–0 to the winner; completed shows real scores.
function Score({ show, value, fx, side, animate }) {
  const wo = (fx.status === "walkover" && fx.walkover_winner_id) || (fx.status === "forfeit" && fx.forfeit_winner_id);
  if (wo) {
    const winnerId = fx.walkover_winner_id || fx.forfeit_winner_id;
    const wantHome = winnerId === fx.home_team_id;
    const n = side === "home" ? (wantHome ? 3 : 0) : (wantHome ? 0 : 3);
    return <div className="fxc-score">{n}</div>;
  }
  if (!show) return side === "home" ? <div className="fxc-score vs">vs</div> : <div className="fxc-score vs" />;
  return (
    <div className="fxc-score">
      {animate ? <CountUp value={value ?? 0} /> : (value ?? "–")}
    </div>
  );
}

function CountUp({ value }) {
  const [n, setN] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const duration = 700;
    const start = performance.now();
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="changed">{n}</span>;
}
