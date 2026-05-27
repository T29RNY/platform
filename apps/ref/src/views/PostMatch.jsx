import React, { useMemo, useState } from "react";

// Post-match read-only summary. Shown once fixture.status === 'completed'
// (after ref_confirm_full_time succeeds). The ref cannot edit anything
// here — corrections come from the venue admin via
// venue_update_fixture_result (mig 127).

export default function PostMatch({ state }) {
  const fixture     = state.fixture     ?? {};
  const competition = state.competition ?? {};
  const venue       = state.venue       ?? {};
  const homeTeam    = state.home_team   ?? {};
  const awayTeam    = state.away_team   ?? {};
  const homeSquad   = state.home_squad  ?? [];
  const awaySquad   = state.away_squad  ?? [];
  const events      = state.events      ?? [];

  const playerNameById = useMemo(() => {
    const m = new Map();
    for (const p of homeSquad) m.set(p.id, p.name);
    for (const p of awaySquad) m.set(p.id, p.name);
    return m;
  }, [homeSquad, awaySquad]);

  const goals = events.filter((e) => e.event_type === "goal" || e.event_type === "own_goal");
  const cards = events.filter((e) => e.event_type === "yellow_card" || e.event_type === "red_card");
  const subs  = events.filter((e) => e.event_type === "substitution");

  const [copied, setCopied] = useState(false);
  const shareText = useMemo(() => buildShareText({
    homeTeam, awayTeam, fixture, goals, cards, playerNameById,
  }), [homeTeam, awayTeam, fixture, goals, cards, playerNameById]);

  async function onShare() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[ref] copy failed", err);
      window.prompt("Copy this result:", shareText);
    }
  }

  return (
    <main className="match">
      <div className="match-head">
        <div className="match-eyebrow">
          {venue.name ? `${venue.name} · ` : ""}{competition.name || "Match"}
          {fixture.week_number ? ` · Week ${fixture.week_number}` : ""}
        </div>
        <h1 className="match-title">Full time</h1>
        <div className="match-subtitle">Result recorded. Send it on.</div>
      </div>

      <div className="post-score">
        <TeamScore team={homeTeam} score={fixture.home_score} />
        <span className="post-score-sep">–</span>
        <TeamScore team={awayTeam} score={fixture.away_score} />
      </div>

      <section className="post-section">
        <h3>Scorers</h3>
        {goals.length === 0 ? (
          <div className="muted">No goals.</div>
        ) : (
          <ul className="post-list">
            {goals
              .slice()
              .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
              .map((g) => (
                <li key={g.id || g.client_event_id} className="post-row">
                  <span className="post-row-icon">{g.event_type === "own_goal" ? "🥅" : "⚽"}</span>
                  <span className="post-row-name">{playerNameById.get(g.player_id) || g.player_id}</span>
                  {g.event_type === "own_goal" && <span className="post-row-tag">OG</span>}
                  <span className="post-row-meta">{g.minute}′ · {g.period}</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {cards.length > 0 && (
        <section className="post-section">
          <h3>Cards</h3>
          <ul className="post-list">
            {cards
              .slice()
              .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
              .map((c) => (
                <li key={c.id || c.client_event_id} className="post-row">
                  <span className="post-row-icon">{c.event_type === "red_card" ? "🟥" : "🟨"}</span>
                  <span className="post-row-name">{playerNameById.get(c.player_id) || c.player_id}</span>
                  <span className="post-row-meta">{c.minute}′ · {c.period}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {subs.length > 0 && (
        <section className="post-section">
          <h3>Subs</h3>
          <ul className="post-list">
            {subs
              .slice()
              .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
              .map((s) => (
                <li key={s.id || s.client_event_id} className="post-row">
                  <span className="post-row-icon">↕️</span>
                  <span className="post-row-name">
                    {playerNameById.get(s.sub_player_on_id) || s.sub_player_on_id}
                    <span className="muted"> on for </span>
                    {playerNameById.get(s.sub_player_off_id) || s.sub_player_off_id}
                  </span>
                  <span className="post-row-meta">{s.minute}′ · {s.period}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <button className="btn-primary post-share" onClick={onShare}>
        {copied ? "Copied!" : "Share result"}
      </button>

      <p className="muted post-correction-note">
        Need a correction? Ask the venue admin — refs can&apos;t edit results
        after full time.
      </p>
    </main>
  );
}

function TeamScore({ team, score }) {
  return (
    <div className="post-score-side">
      <span className="post-score-swatch" style={{ background: team?.primary_colour || "var(--surface-2)" }} />
      <div>
        <div className="post-score-team">{team?.name || "—"}</div>
        <div className="post-score-num">{score ?? "—"}</div>
      </div>
    </div>
  );
}

function buildShareText({ homeTeam, awayTeam, fixture, goals, cards, playerNameById }) {
  const lines = [];
  lines.push(`${homeTeam?.name || "Home"} ${fixture.home_score ?? 0} – ${fixture.away_score ?? 0} ${awayTeam?.name || "Away"}`);

  if (goals.length > 0) {
    const goalsText = goals
      .slice()
      .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
      .map((g) => {
        const name = playerNameById.get(g.player_id) || "—";
        const tag  = g.event_type === "own_goal" ? " (OG)" : "";
        return `${name} ${g.minute}′${tag}`;
      })
      .join(", ");
    lines.push(`⚽ ${goalsText}`);
  }

  if (cards.length > 0) {
    const cardsText = cards
      .slice()
      .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
      .map((c) => {
        const icon = c.event_type === "red_card" ? "🟥" : "🟨";
        const name = playerNameById.get(c.player_id) || "—";
        return `${icon} ${name} ${c.minute}′`;
      })
      .join(", ");
    lines.push(cardsText);
  }

  return lines.join("\n");
}
