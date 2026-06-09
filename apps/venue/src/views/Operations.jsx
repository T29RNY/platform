import React from "react";
import FixtureCard from "./FixtureCard.jsx";
import RegistrationActions from "./RegistrationActions.jsx";
import IncidentActions, { ReportIncidentButton } from "./IncidentActions.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { longDate, incidentStamp } from "../lib/format.js";

// Operations content (the centre column). Stat row + right sidebar are rendered
// by Dashboard into their own grid areas. Real wiring preserved: fixture actions
// via <FixtureCard>/<FixtureActions>, registration approve/reject via
// <RegistrationActions>, and the incident lifecycle (report + resolve) via
// <ReportIncidentButton>/<IncidentActions> (venue_log_incident / venue_resolve_incident, mig 231).
export default function Operations({ state, venueToken, onRefresh }) {
  const fixtures = state.fixtures || {};
  const tonight = fixtures.tonight || [];
  const thisWeek = fixtures.this_week || [];
  const recent = fixtures.recent || [];
  const upcoming = fixtures.upcoming || [];
  const tonightIds = new Set(tonight.map((f) => f.id));
  const restOfWeek = thisWeek.filter((f) => !tonightIds.has(f.id));

  const pendingRegs = state.pending_registrations || [];
  const incidents = state.open_incidents || [];
  const issuesCount = pendingRegs.length + incidents.length;

  const liveCount = tonight.filter((f) => f.status === "in_progress").length;
  const toCome = tonight.filter((f) => !["in_progress", "completed"].includes(f.status)).length;
  const nextUp = restOfWeek[0] || upcoming[0];
  const teamName = (id) => state.teams?.[id]?.name || "TBC";

  return (
    <div>
      <section className="tonight">
        <div className="tonight-head">
          <h1>Tonight</h1>
          <span className="display">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
          {tonight.length > 0 && (
            <span className="matches-count">
              {tonight.length} match{tonight.length === 1 ? "" : "es"} · {liveCount} live · {toCome} to come
            </span>
          )}
        </div>

        {tonight.length === 0 ? (
          <div className="tonight-empty">
            <div className="floods">
              <div className="flood" /><div className="flood" />
              <div className="flood" /><div className="flood" />
            </div>
            <div>
              <h3>Floodlights down.</h3>
              <p>No fixtures scheduled here tonight. Quiet night at the venue.</p>
              {nextUp && (
                <div className="next-up">
                  <span style={{ color: "var(--ink-3)" }}>Next up</span>
                  <strong>{longDate(nextUp.scheduled_date)}{nextUp.kickoff_time ? ` · ${nextUp.kickoff_time}` : ""}</strong>
                  <span>{teamName(nextUp.home_team_id)} vs {teamName(nextUp.away_team_id)}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="tonight-grid">
            {tonight.map((f) => (
              <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} prominent withActions />
            ))}
          </div>
        )}
      </section>

      <section className="issues">
        <header className="issues-head">
          <h3>Open issues</h3>
          {issuesCount > 0 && <span className="count">{issuesCount}</span>}
          <span className="spacer" />
          <ReportIncidentButton venueToken={venueToken} onDone={onRefresh} />
        </header>
        {issuesCount === 0 ? (
          <div className="issues-empty">Nothing to action right now.</div>
        ) : (
          <>
            {pendingRegs.map((r) => (
              <div className="issues-row" key={`reg-${r.id}`}>
                <span className="sev sev-info"><Icon name="info" size={16} /></span>
                <div>
                  <div className="label">{r.team_name || r.team_id}</div>
                  <div className="meta">Pending team registration · awaiting approval</div>
                </div>
                <RegistrationActions venueToken={venueToken} registration={r} onDone={onRefresh} />
              </div>
            ))}
            {incidents.map((i) => (
              <div className="issues-row" key={`inc-${i.id}`}>
                <span className={"sev sev-" + (i.severity || "info")}>
                  <Icon name={i.severity === "info" ? "info" : "alert"} size={16} />
                </span>
                <div>
                  <div className="label">{i.description}</div>
                  <div className="meta">
                    Incident · {i.severity || "info"}
                    {" · reported by "}{state.venue?.name || "Venue admin"}
                    {i.created_at ? ` · ${incidentStamp(i.created_at)}` : ""}
                  </div>
                </div>
                <IncidentActions venueToken={venueToken} incident={i} onDone={onRefresh} />
              </div>
            ))}
          </>
        )}
      </section>

      {restOfWeek.length > 0 && (
        <section style={{ marginBottom: "var(--gap-3)" }}>
          <SectionHead label="This week" count={`${restOfWeek.length} fixture${restOfWeek.length === 1 ? "" : "s"}`} />
          <div className="tonight-grid">
            {restOfWeek.map((f) => (
              <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} withActions />
            ))}
          </div>
        </section>
      )}

      <div className="two-col">
        <div>
          <SectionHead label="Recent results" count={recent.length} />
          {recent.length === 0
            ? <EmptyState title="No recent results" body="Completed fixtures will appear here." />
            : recent.slice(0, 6).map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} compact animateScore />
              ))}
        </div>
        <div>
          <SectionHead label="Upcoming" count={upcoming.length} />
          {upcoming.length === 0
            ? <EmptyState title="No upcoming fixtures" body="Future fixtures will appear here." />
            : upcoming.slice(0, 6).map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} compact />
              ))}
        </div>
      </div>
    </div>
  );
}
