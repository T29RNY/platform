import React, { useState } from "react";
import FixtureCard from "./FixtureCard.jsx";
import Sidebar from "./Sidebar.jsx";
import RegistrationActions from "./RegistrationActions.jsx";
import SeasonWizard from "./SeasonWizard.jsx";

export default function Dashboard({ state, venueToken, onRefresh, refreshing }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const venue = state.venue ?? {};
  const leagues = state.leagues ?? [];
  const fixtures = state.fixtures ?? {};
  const tonight = fixtures.tonight ?? [];
  const thisWeek = fixtures.this_week ?? [];
  const upcoming = fixtures.upcoming ?? [];
  const recent = fixtures.recent ?? [];
  const pending = state.pending_registrations ?? [];
  const incidents = state.open_incidents ?? [];

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
          <button className="btn-accent" onClick={() => setWizardOpen(true)}>Set up new season</button>
          <button onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {wizardOpen && (
        <SeasonWizard
          state={state}
          venueToken={venueToken}
          onClose={() => setWizardOpen(false)}
          onDone={onRefresh}
        />
      )}

      <main className="content dash-grid">
        <section className="panel panel-tonight">
          <h2>Tonight</h2>
          {tonight.length === 0 ? (
            <p className="muted">No fixtures scheduled for today.</p>
          ) : (
            <div className="fixture-list">
              {tonight.map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} prominent withActions />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-this-week">
          <h2>This Week</h2>
          {restOfWeek.length === 0 ? (
            <p className="muted">No other fixtures in the next 7 days.</p>
          ) : (
            <div className="fixture-list">
              {restOfWeek.map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} withActions />
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
                  <RegistrationActions venueToken={venueToken} registration={p} onDone={onRefresh} />
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
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} compact withActions />
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
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} compact withActions />
              ))}
            </div>
          )}
        </section>

        <aside className="panel panel-sidebar">
          <Sidebar
            pitches={state.pitches ?? []}
            refs={state.refs ?? []}
            venueToken={venueToken}
            onDone={onRefresh}
          />
        </aside>
      </main>
    </div>
  );
}
