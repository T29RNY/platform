import React from "react";
import FixtureCard from "./FixtureCard.jsx";
import Sidebar from "./Sidebar.jsx";

export default function Dashboard({ state, onRefresh, refreshing }) {
  const venue = state.venue ?? {};
  const leagues = state.leagues ?? [];
  const fixtures = state.fixtures ?? {};
  const tonight = fixtures.tonight ?? [];
  const thisWeek = fixtures.this_week ?? [];
  const upcoming = fixtures.upcoming ?? [];
  const recent = fixtures.recent ?? [];
  const pending = state.pending_registrations ?? [];
  const incidents = state.open_incidents ?? [];
  const teamsById = buildTeamIndex(state);

  // de-dupe tonight from this_week (tonight is a subset of this_week)
  const tonightIds = new Set(tonight.map((f) => f.id));
  const restOfWeek = thisWeek.filter((f) => !tonightIds.has(f.id));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-line1">{venue.name || "Venue"}</span>
          <span className="brand-line2">
            {leagues[0]?.name ?? ""}
            {leagues.length > 1 ? `  +${leagues.length - 1} more` : ""}
          </span>
        </div>
        <div className="user">
          <button onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <main className="content dash-grid">
        <section className="panel panel-tonight">
          <h2>Tonight</h2>
          {tonight.length === 0 ? (
            <p className="muted">No fixtures scheduled for today.</p>
          ) : (
            <div className="fixture-list">
              {tonight.map((f) => (
                <FixtureCard key={f.id} fx={f} teamsById={teamsById} state={state} prominent />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-this-week">
          <h2>This Week</h2>
          {restOfWeek.length === 0 ? (
            <p className="muted">No fixtures in the next 7 days.</p>
          ) : (
            <div className="fixture-list">
              {restOfWeek.map((f) => (
                <FixtureCard key={f.id} fx={f} teamsById={teamsById} state={state} />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-issues">
          <h2>Open Issues</h2>
          {pending.length === 0 && incidents.length === 0 ? (
            <p className="muted">Nothing to action.</p>
          ) : (
            <div className="issues-list">
              {pending.map((p) => (
                <div className="issue-row" key={`reg-${p.id}`}>
                  <span className="issue-tag">REGISTRATION</span>
                  <span className="issue-title">{p.team_name || p.team_id}</span>
                  <span className="muted">awaiting approval</span>
                </div>
              ))}
              {incidents.map((i) => (
                <div className="issue-row" key={`inc-${i.id}`}>
                  <span className="issue-tag issue-tag-critical">{(i.severity || "info").toUpperCase()}</span>
                  <span className="issue-title">{i.description}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-recent">
          <h2>Recent Results</h2>
          {recent.length === 0 ? (
            <p className="muted">No completed fixtures yet.</p>
          ) : (
            <div className="fixture-list">
              {recent.slice(0, 10).map((f) => (
                <FixtureCard key={f.id} fx={f} teamsById={teamsById} state={state} compact />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-upcoming">
          <h2>Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="muted">No fixtures further out.</p>
          ) : (
            <div className="fixture-list">
              {upcoming.slice(0, 10).map((f) => (
                <FixtureCard key={f.id} fx={f} teamsById={teamsById} state={state} compact />
              ))}
            </div>
          )}
        </section>

        <aside className="panel panel-sidebar">
          <Sidebar
            pitches={state.pitches ?? []}
            refs={state.refs ?? []}
          />
        </aside>
      </main>
    </div>
  );
}

function buildTeamIndex(state) {
  // venue_get_state doesn't directly include a `teams` array. Fixture
  // rows carry home_team_id / away_team_id but not names. For 2.7c
  // we just show team ids fallback; 2.7d will widen the read RPC or
  // add a teams_directory key.
  const idx = new Map();
  const rows = [
    ...(state.fixtures?.tonight ?? []),
    ...(state.fixtures?.this_week ?? []),
    ...(state.fixtures?.upcoming ?? []),
    ...(state.fixtures?.recent ?? []),
  ];
  for (const f of rows) {
    if (f.home_team_id) idx.set(f.home_team_id, idx.get(f.home_team_id) || f.home_team_id);
    if (f.away_team_id) idx.set(f.away_team_id, idx.get(f.away_team_id) || f.away_team_id);
  }
  return idx;
}
