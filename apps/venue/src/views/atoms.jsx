import React from "react";
import { getInitials, crestColours } from "../lib/format.js";

// Shared presentational atoms for the v2 venue dashboard. All pure/prop-driven
// — no global data access (the design prototype read window.DATA_*; here every
// atom takes what it needs). Class names map to apps/venue/src/styles.css.

// Diagonal-split crest. Pass explicit c1/c2 or let a team seed deterministic
// fallback colours.
export function Crest({ c1, c2, size = 28, initials, big = false, seed = "" }) {
  const [a, b] = crestColours(c1, c2, seed || initials || "");
  const radius = big ? Math.round(size * 0.27) : Math.round(size * 0.3);
  return (
    <div
      className="crest"
      style={{
        width: size, height: size, borderRadius: radius, position: "relative",
        overflow: "hidden", border: "1px solid var(--border-strong)",
        display: "inline-grid", placeItems: "center", flex: "none",
      }}
    >
      <div
        className="gradient"
        style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` }}
      />
      {initials && (
        <span
          className="glyph"
          style={{
            position: "relative",
            fontSize: big ? Math.round(size * 0.32) : Math.round(size * 0.4),
            fontWeight: 700, color: "white", textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            letterSpacing: "-0.02em",
          }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

// Build a <Crest> from a team object ({ name, primary_colour, secondary_colour }).
export function TeamCrest({ team, size, big = false }) {
  if (!team) return null;
  return (
    <Crest
      c1={team.primary_colour}
      c2={team.secondary_colour}
      size={size || (big ? 52 : 28)}
      initials={getInitials(team.name)}
      big={big}
      seed={team.name}
    />
  );
}

// Resolve the display status of a fixture for the pill (needs pitch / needs ref
// derive from the assignment fields when still scheduled/allocated).
export function deriveStatusForCard(fx) {
  if (fx.status === "scheduled" && !fx.playing_area_id) return "needs_pitch";
  if (fx.status === "allocated" && !fx.official_id) return "needs_ref";
  return fx.status;
}

const STATUS_MAP = {
  scheduled:   { cls: "pill-muted", label: "Needs pitch" },
  needs_pitch: { cls: "pill-warn",  label: "Needs pitch" },
  needs_ref:   { cls: "pill-warn",  label: "Needs ref" },
  allocated:   { cls: "pill-muted", label: "All set" },
  in_progress: { cls: "pill-live",  label: "Live" },
  completed:   { cls: "pill-ok",    label: "Result" },
  postponed:   { cls: "pill-muted", label: "Postponed" },
  void:        { cls: "pill-muted", label: "Void" },
  walkover:    { cls: "pill-warn",  label: "Walkover" },
  forfeit:     { cls: "pill-warn",  label: "Forfeit" },
};

export function StatusPill({ status }) {
  const c = STATUS_MAP[status] || STATUS_MAP.scheduled;
  return (
    <span className={"pill " + c.cls}>
      <span className="pill-dot" /> {c.label}
    </span>
  );
}

export function SectionHead({ label, count, children }) {
  return (
    <div className="h-section">
      <h2>{label}</h2>
      {count != null && <span className="h-count">{count}</span>}
      {children && <span className="h-actions">{children}</span>}
    </div>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function StarRating({ n, max = 5 }) {
  return (
    <span className="rating">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={"star" + (i < n ? " on" : "")} />
      ))}
    </span>
  );
}

// Compact list row for recent/upcoming fixtures. `teamFor(id)` resolves a team
// object from the caller's state (e.g. id => state.teams[id]).
export function FixtureCompact({ fx, teamFor, dayLabel }) {
  const home = teamFor(fx.home_team_id);
  const away = teamFor(fx.away_team_id);
  const showScore = fx.status === "completed" || fx.status === "in_progress" || fx.home_score != null;
  const scoreText =
    fx.status === "walkover" ? "W/O"
    : fx.status === "postponed" ? "PP"
    : fx.status === "void" ? "—"
    : showScore ? `${fx.home_score}–${fx.away_score}`
    : "";
  return (
    <div className="fxc-compact">
      <span className="when"><strong>{fx.kickoff_time}</strong>{dayLabel(fx.scheduled_date)}</span>
      <span className="matchup">
        <TeamCrest team={home} size={18} />
        <span>{home?.name || "TBC"}</span>
        <span className="vs-sep">vs</span>
        <TeamCrest team={away} size={18} />
        <span>{away?.name || "TBC"}</span>
      </span>
      <span className="score">{scoreText}</span>
    </div>
  );
}
