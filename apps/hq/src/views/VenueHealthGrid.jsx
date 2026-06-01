import React from "react";

const CHIP = (n, l) => (
  <div className="chip" key={l}>
    <div className="n">{n ?? "—"}</div>
    <div className="l">{l}</div>
  </div>
);

export default function VenueHealthGrid({ summary, venues, selectedVenueId, onSelect }) {
  return (
    <div>
      <div className="section">
        <h2>Company</h2>
        <div className="chips">
          {CHIP(summary?.venue_count, "Venues")}
          {CHIP(summary?.active_leagues, "Leagues")}
          {CHIP(summary?.registered_teams, "Teams")}
          {CHIP(summary?.open_incidents, "Incidents")}
        </div>
      </div>

      <div className="section">
        <h2>Venue health</h2>
        {venues.length === 0 && <div className="empty">No venues in scope.</div>}
        {venues.map((v) => (
          <button
            key={v.id}
            className={"venue-card" + (v.id === selectedVenueId ? " active" : "")}
            onClick={() => onSelect(v.id)}
          >
            <div className="vc-top">
              <span className={"dot " + (v.health || "green")} />
              <span className="vc-name">{v.name}</span>
              {v.health_score != null && (
                <span className={"badge " + healthClass(v.health)}>{v.health_score}</span>
              )}
              <SubBadge status={v.subscription_status} />
            </div>
            {v.health_reason && <div className="vc-sub">{v.health_reason}</div>}
            {v.region && <div className="vc-sub">{v.region}</div>}
            <div className="vc-stats">
              <span>Tonight <b>{v.tonight_fixtures}</b></span>
              <span>Incidents <b>{v.open_incidents}</b></span>
              {v.unallocated_this_week > 0 && <span className="fr-warn">No pitch <b>{v.unallocated_this_week}</b></span>}
              {v.unassigned_refs_this_week > 0 && <span className="fr-warn">No ref <b>{v.unassigned_refs_this_week}</b></span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function healthClass(health) {
  if (health === "green") return "good";
  if (health === "amber") return "warn";
  return "danger";
}

function SubBadge({ status }) {
  if (!status) return null;
  const cls = status === "active" ? "good" : (status === "trial" ? "warn" : "danger");
  return <span className={"badge " + cls}>{status}</span>;
}
