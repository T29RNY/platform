// ============================================================
// PreMatch — squads, start gate (kick-off window + hold-to-override),
// and the terminal banners (void / postponed / walkover / forfeit /
// completed). Ported from the artifact's screens.jsx, wired to the
// real refStartMatch wrapper.
// ============================================================
import React, { useState, useEffect, useRef, useCallback } from "react";
import { refStartMatch, refStartTournamentMatch } from "@platform/core/storage/supabase.js";
import { uuid, nowISO, hasLineup, isSuspended } from "../lib/engine.js";
import { Swatch, RefreshIcon, PlayIcon, fmtKick } from "../components/ui.jsx";

const EARLY_WINDOW_MIN = 15;
const HOLD_MS = 3000;

function SquadRows({ squad }) {
  if (!squad || squad.length === 0) return <div className="empty-state">No confirmed squad yet</div>;
  const lineup = hasLineup(squad);
  const row = (p) => (
    <div className="prow" key={p.id} style={{ cursor: "default", minHeight: 50 }}>
      <span className="shirt" style={{ width: 32, height: 32, fontSize: 14 }}>{p.shirt_number ?? "—"}</span>
      <div className="who">
        <div className="nm"><span className="t">{p.name}</span>{isSuspended(p) && <span className="flag-susp">Susp</span>}</div>
      </div>
    </div>
  );
  if (!lineup) return <div>{squad.map(row)}</div>;
  const starting = squad.filter((p) => p.lineup_role === "starting");
  const bench = squad.filter((p) => p.lineup_role === "bench");
  return (
    <div>
      <div className="subhead">Starting</div>
      {starting.map(row)}
      {bench.length > 0 && <div className="subhead">Bench</div>}
      {bench.map(row)}
    </div>
  );
}

function SquadCard({ team, squad, isBye }) {
  const lineup = squad && hasLineup(squad);
  const count = lineup
    ? `${squad.filter((p) => p.lineup_role === "starting").length} starting · ${squad.filter((p) => p.lineup_role === "bench").length} subs`
    : (squad && squad.length ? `${squad.length} players` : "");
  return (
    <div className="card squad-card">
      <div className="sc-head">
        <Swatch c={team ? team.primary_colour : "#555"} size={14} />
        <div className="nm">{team ? team.name : "Bye"} {isBye && <span style={{ color: "var(--txt3)", fontWeight: 600 }}>(bye)</span>}</div>
        {count && <div className="ct">{count}</div>}
      </div>
      <div className="sc-body">
        {isBye ? <div className="empty-state">No opponent — this is a bye</div> : <SquadRows squad={squad} />}
      </div>
    </div>
  );
}

function StartGate({ state, onStart, onRefresh, busy, error }) {
  const { fixture } = state;
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(id); }, []);

  let unlockMin = -1; // default: unlocked (no schedule)
  if (fixture.scheduled_date && fixture.kickoff_time) {
    const ko = new Date(`${fixture.scheduled_date}T${fixture.kickoff_time.length === 5 ? fixture.kickoff_time + ":00" : fixture.kickoff_time}`);
    unlockMin = (ko.getTime() - EARLY_WINDOW_MIN * 60000 - Date.now()) / 60000;
  }
  const inWindow = unlockMin <= 0;

  const [holding, setHolding] = useState(false);
  const [pct, setPct] = useState(0);
  const raf = useRef(0), start = useRef(0), fired = useRef(false);
  const stopHold = useCallback(() => { cancelAnimationFrame(raf.current); setHolding(false); setPct(0); fired.current = false; }, []);
  const tick = useCallback(() => {
    const p = Math.min(1, (performance.now() - start.current) / HOLD_MS);
    setPct(p);
    if (p >= 1) { if (!fired.current) { fired.current = true; setHolding(false); onStart(); } return; }
    raf.current = requestAnimationFrame(tick);
  }, [onStart]);
  const beginHold = useCallback((e) => {
    e.preventDefault(); if (busy) return;
    setHolding(true); fired.current = false; start.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  }, [busy, tick]);

  const unlockHint = () => {
    if (inWindow) return "Unlock available";
    if (unlockMin >= 1440) return `Unlocks in ${Math.round(unlockMin / 1440)} day${unlockMin >= 2880 ? "s" : ""}`;
    if (unlockMin >= 60) return `Unlocks in ${Math.round(unlockMin / 60)} h`;
    return `Unlocks in ${Math.ceil(unlockMin)} min`;
  };

  return (
    <div className="gate">
      {inWindow ? (
        <button className="btn btn-primary btn-block btn-xl" disabled={busy} onClick={onStart}>
          <PlayIcon s={18} /> {busy ? "Starting…" : "Start Match"}
        </button>
      ) : (
        <div
          className={"hold-btn" + (holding ? " holding" : "")}
          onPointerDown={beginHold} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}
        >
          <span className="hold-fill" style={{ width: `${pct * 100}%`, transition: holding ? "none" : "width .2s" }} />
          <span className="hlabel">
            <PlayIcon s={18} />
            {holding ? `Keep holding · ${Math.ceil((1 - pct) * HOLD_MS / 1000)}s` : "Hold to start early"}
          </span>
        </div>
      )}
      <div className="gate-hint">{inWindow ? "Within kick-off window" : unlockHint() + " · hold 3s to override"}</div>
      {error && <div className="gate-hint" style={{ color: "var(--red)" }}>{error}</div>}
      <button className="btn btn-ghost btn-block" style={{ height: 46, marginTop: 14 }} onClick={onRefresh}>
        <RefreshIcon /> Refresh squads
      </button>
    </div>
  );
}

function TerminalBanner({ state, onRefresh }) {
  const { fixture, home_team, away_team } = state;
  const map = {
    void: { cls: "void", tt: "Match voided", td: fixture.void_reason || "This fixture has been voided." },
    postponed: { cls: "postponed", tt: "Postponed", td: fixture.postpone_reason || "This fixture has been postponed." },
    walkover: { cls: "walkover", tt: "Decided by walkover", td: "A walkover has been awarded." },
    forfeit: { cls: "forfeit", tt: "Forfeit", td: fixture.forfeit_reason || "This fixture was forfeited." },
    completed: { cls: "completed", tt: "Result already recorded", td: "This match is complete." },
  }[fixture.status] || { cls: "void", tt: "Unavailable", td: "" };
  const hasScore = fixture.home_score != null && fixture.away_score != null;
  return (
    <div className={"term-banner " + map.cls}>
      <div className="tt">{map.tt}</div>
      <div className="td">{map.td}</div>
      {hasScore && (
        <div className="disp tabnum" style={{ fontSize: 24, marginTop: 6 }}>
          {home_team?.name?.split(" ")[0]} {fixture.home_score} – {fixture.away_score} {away_team?.name?.split(" ")[0]}
        </div>
      )}
      <button className="btn btn-ghost btn-block" style={{ height: 46, marginTop: 12 }} onClick={onRefresh}>
        <RefreshIcon /> Refresh
      </button>
    </div>
  );
}

export default function PreMatch({ state, refToken, onRefresh }) {
  const { fixture, venue, competition, pitch, official, home_team, away_team, home_squad, away_squad } = state;
  const isBye = !away_team;
  const terminal = ["completed", "void", "postponed", "walkover", "forfeit"].includes(fixture.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const eyebrow = [venue?.name, competition?.name, fixture.week_number != null ? `Week ${fixture.week_number}` : null, fixture.round_name]
    .filter(Boolean).join(" · ");
  const kick = fmtKick(fixture.scheduled_date, fixture.kickoff_time);

  const isTournament = !!fixture.home_competition_team_id;

  const start = async () => {
    if (busy) return; setBusy(true); setErr(null);
    try {
      if (isTournament) {
        await refStartTournamentMatch(refToken, uuid(), nowISO());
      } else {
        await refStartMatch(refToken, uuid(), nowISO());
      }
      await onRefresh();
    }
    catch (e) { setErr(e?.message || "Could not start match"); setBusy(false); }
  };

  return (
    <div className="app">
      <div className="safetop" />
      <div className="scroll">
        <div className="hdr">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{terminal ? "Fixture" : "Pre-match"}</h1>
          <div className="sub">{terminal ? "This match isn’t playable right now." : "Confirm both squads, then start the clock at kick-off."}</div>
        </div>

        <div className="kick-strip">
          <div className="kick-cell">
            <div className="k">Kick-off</div>
            <div className="v tabnum">{kick.big}</div>
            {kick.small && <div className="v2">{kick.small}</div>}
          </div>
          <div className="kick-cell">
            <div className="k">Pitch · Referee</div>
            <div className="v">{pitch ? pitch.name : "TBC"}</div>
            <div className="v2">{official ? official.name : "No referee assigned"}{pitch?.surface ? ` · ${pitch.surface}` : ""}</div>
          </div>
        </div>

        {terminal
          ? <TerminalBanner state={state} onRefresh={onRefresh} />
          : <StartGate state={state} onStart={start} onRefresh={onRefresh} busy={busy} error={err} />}

        <SquadCard team={home_team} squad={home_squad} />
        <SquadCard team={away_team} squad={away_squad} isBye={isBye} />
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
