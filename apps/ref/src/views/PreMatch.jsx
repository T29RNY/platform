import React, { useEffect, useMemo, useRef, useState } from "react";
import { refStartMatch } from "@platform/core/storage/supabase.js";

const HOLD_MS = 3000;           // 3-second hold to override the kickoff gate
const EARLY_WINDOW_MIN = 15;    // unlock the Start button this many mins before kickoff

export default function PreMatch({ state, refToken, onRefresh, refreshing }) {
  const fixture     = state.fixture     ?? {};
  const competition = state.competition ?? {};
  const venue       = state.venue       ?? {};
  const pitch       = state.pitch       ?? null;
  const official    = state.official    ?? null;
  const homeTeam    = state.home_team   ?? { name: fixture.home_team_id };
  const awayTeam    = state.away_team   ?? { name: fixture.away_team_id ?? "(bye)" };
  const homeSquad   = state.home_squad  ?? [];
  const awaySquad   = state.away_squad  ?? [];

  // Show a terminal-state banner instead of Start when the fixture is not
  // in a pre-match status (walkover, completed, void, postponed).
  const terminal = useMemo(() => {
    const s = fixture.status;
    if (s === "completed") return { kind: "completed", label: "Result already recorded" };
    if (s === "void")      return { kind: "void",      label: "Match voided" };
    if (s === "postponed") return { kind: "postponed", label: `Postponed${fixture.postpone_reason ? ` — ${fixture.postpone_reason}` : ""}` };
    if (s === "walkover")  return { kind: "walkover",  label: "Decided by walkover" };
    if (s === "forfeit")   return { kind: "forfeit",   label: `Forfeit${fixture.forfeit_reason ? ` — ${fixture.forfeit_reason}` : ""}` };
    return null;
  }, [fixture.status, fixture.postpone_reason, fixture.forfeit_reason]);

  // Compute the kickoff Date once per fixture change.
  const kickoffAt = useMemo(() => parseKickoff(fixture.scheduled_date, fixture.kickoff_time), [fixture.scheduled_date, fixture.kickoff_time]);

  // Live tick so the kickoff gate flips without a refresh.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (terminal) return; // no countdown needed
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [terminal]);

  const unlocksInMin = kickoffAt ? Math.round((kickoffAt.getTime() - now.getTime()) / 60000) - EARLY_WINDOW_MIN : null;
  const insideWindow = kickoffAt ? unlocksInMin <= 0 : true;

  if (terminal) {
    return (
      <main className="match">
        <Header fixture={fixture} competition={competition} venue={venue} />
        <KickoffStrip kickoffAt={kickoffAt} pitch={pitch} official={official} />
        <div className={`banner banner-${terminal.kind}`}>{terminal.label}</div>
        {(fixture.home_score != null || fixture.away_score != null) && (
          <div className="final-score">
            <span className="final-score-num">{fixture.home_score ?? "—"}</span>
            <span className="final-score-vs">vs</span>
            <span className="final-score-num">{fixture.away_score ?? "—"}</span>
          </div>
        )}
        <Squads homeTeam={homeTeam} awayTeam={awayTeam} homeSquad={homeSquad} awaySquad={awaySquad} />
        <button className="btn-ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </main>
    );
  }

  return (
    <main className="match">
      <Header fixture={fixture} competition={competition} venue={venue} />
      <KickoffStrip kickoffAt={kickoffAt} pitch={pitch} official={official} />
      <Squads homeTeam={homeTeam} awayTeam={awayTeam} homeSquad={homeSquad} awaySquad={awaySquad} />
      <StartMatch
        insideWindow={insideWindow}
        unlocksInMin={unlocksInMin}
        refreshing={refreshing}
        onRefresh={onRefresh}
        refToken={refToken}
        onAfterStart={onRefresh}
      />
    </main>
  );
}

function Header({ fixture, competition, venue }) {
  return (
    <div className="match-head">
      <div className="match-eyebrow">
        {venue.name ? `${venue.name} · ` : ""}{competition.name || "Match"}
        {fixture.week_number ? ` · Week ${fixture.week_number}` : ""}
        {fixture.round_name ? ` · ${fixture.round_name}` : ""}
      </div>
      <h1 className="match-title">Pre-match</h1>
      <div className="match-subtitle">Confirm both squads, then start the match when ready.</div>
    </div>
  );
}

function KickoffStrip({ kickoffAt, pitch, official }) {
  return (
    <div className="kickoff">
      <div className="kickoff-cell">
        <div className="kickoff-label">Kickoff</div>
        <div className="kickoff-value">{kickoffAt ? formatTime(kickoffAt) : "—"}</div>
        <div className="kickoff-sub">{kickoffAt ? formatDate(kickoffAt) : "Time TBC"}</div>
      </div>
      <div className="kickoff-cell">
        <div className="kickoff-label">Pitch · Ref</div>
        <div className="kickoff-value">{pitch?.name || "—"}</div>
        <div className="kickoff-sub">
          {official?.name ? official.name : "No referee assigned"}
          {pitch?.surface ? ` · ${pitch.surface}` : ""}
        </div>
      </div>
    </div>
  );
}

function Squads({ homeTeam, awayTeam, homeSquad, awaySquad }) {
  return (
    <div className="squads">
      <SquadCard team={homeTeam} squad={homeSquad} side="home" />
      <SquadCard team={awayTeam} squad={awaySquad} side="away" />
    </div>
  );
}

function SquadRow({ p }) {
  const suspended = p.suspension_until && new Date(p.suspension_until) > new Date();
  return (
    <li className="squad-row">
      {p.shirt_number != null
        ? <span className="squad-shirt">{p.shirt_number}</span>
        : <span className="squad-shirt-blank">—</span>}
      <span className="squad-name">{p.name}</span>
      {suspended && <span className="squad-flag">Susp</span>}
    </li>
  );
}

function SquadCard({ team, squad, side }) {
  // A submitted teamsheet tags each player with lineup_role ('starting'|'bench').
  // When present, show a Starting / Bench split; otherwise the flat registered squad
  // exactly as before (backward compatible — Cycle 5.6).
  const hasLineup = squad.some((p) => p.lineup_role);
  const starting = hasLineup ? squad.filter((p) => p.lineup_role === "starting") : [];
  const bench    = hasLineup ? squad.filter((p) => p.lineup_role === "bench") : [];
  const subhead = { fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase",
                    opacity: 0.6, margin: "10px 0 4px" };
  return (
    <section className="squad">
      <div className="squad-head">
        <div className="squad-team">
          <span className="squad-swatch" style={{ background: team?.primary_colour || "var(--surface-2)" }} />
          {team?.name || (side === "away" ? "(bye)" : "Home")}
        </div>
        <div className="squad-count">
          {hasLineup
            ? `${starting.length} starting · ${bench.length} sub${bench.length === 1 ? "" : "s"}`
            : `${squad.length} player${squad.length === 1 ? "" : "s"}`}
        </div>
      </div>
      {squad.length === 0 ? (
        <div className="squad-empty">No confirmed squad yet</div>
      ) : hasLineup ? (
        <>
          <div style={subhead}>Starting</div>
          <ul className="squad-list">{starting.map((p) => <SquadRow key={p.id} p={p} />)}</ul>
          {bench.length > 0 && (
            <>
              <div style={subhead}>Bench</div>
              <ul className="squad-list">{bench.map((p) => <SquadRow key={p.id} p={p} />)}</ul>
            </>
          )}
        </>
      ) : (
        <ul className="squad-list">
          {squad.map((p) => <SquadRow key={p.id} p={p} />)}
        </ul>
      )}
    </section>
  );
}

function StartMatch({ insideWindow, unlocksInMin, refreshing, onRefresh, refToken, onAfterStart }) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const rafRef = useRef(null);
  const startedAtRef = useRef(0);
  const startingRef = useRef(false);

  async function onStart() {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      await refStartMatch(refToken, crypto.randomUUID(), new Date().toISOString());
      await onAfterStart();
      // App re-renders into LiveMatch on the next state load — nothing else to do here.
    } catch (err) {
      console.error("[ref] ref_start_match failed", err);
      setStartError(err?.message || String(err));
      setStarting(false);
      startingRef.current = false;
    }
  }

  function beginHold() {
    if (holding) return;
    setHolding(true);
    startedAtRef.current = performance.now();
    const tick = (t) => {
      const elapsed = t - startedAtRef.current;
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        cancelHold();
        onStart();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  function cancelHold() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setHolding(false);
    setProgress(0);
  }
  useEffect(() => () => cancelHold(), []);

  if (insideWindow) {
    return (
      <div className="start">
        <button className="btn-primary start-btn" onClick={onStart} disabled={starting}>
          <span className="start-label">{starting ? "Starting…" : "Start Match"}</span>
        </button>
        {startError && <div className="start-hint is-warning">{startError}</div>}
        <button className="btn-ghost" onClick={onRefresh} disabled={refreshing || starting}>
          {refreshing ? "Refreshing…" : "Refresh squads"}
        </button>
      </div>
    );
  }

  // Outside the kickoff window — Start is gated. Hold for 3s to override.
  const hint = formatUnlock(unlocksInMin);

  return (
    <div className="start">
      <button
        className="btn-primary start-btn"
        disabled={starting}
        onPointerDown={beginHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        style={{ "--hold": `${progress}%` }}
      >
        <span className="start-fill" />
        <span className="start-label">
          {starting ? "Starting…" : holding ? "Hold to start early…" : "Start Match"}
        </span>
      </button>
      <div className={`start-hint ${holding || startError ? "is-warning" : ""}`}>
        {startError
          ? startError
          : holding
            ? `Keep holding · ${Math.ceil((HOLD_MS - (progress / 100) * HOLD_MS) / 1000)}s`
            : hint}
      </div>
      <button className="btn-ghost" onClick={onRefresh} disabled={refreshing || starting}>
        {refreshing ? "Refreshing…" : "Refresh squads"}
      </button>
    </div>
  );
}

function formatUnlock(min) {
  if (min <= 0)   return "Unlock available";
  if (min < 60)   return `Unlocks in ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `Unlocks in ${hours} h`;
  const days = Math.round(hours / 24);
  return `Unlocks in ${days} day${days === 1 ? "" : "s"}`;
}

function parseKickoff(dateIso, time) {
  if (!dateIso) return null;
  const t = (time || "00:00").slice(0, 5);
  const d = new Date(`${dateIso}T${t}:00`);
  return isNaN(d.getTime()) ? null : d;
}
function formatTime(d) {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
