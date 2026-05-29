import React from "react";

// Company-wide "needs attention" rail. Surfaces venues that aren't green (open
// incidents, missing pitch/ref this week, or a non-active subscription) and lets the
// operator jump straight into the venue's drill-down to act. Incident resolution itself
// lives in VenueDetail (where the incident rows are).
export default function AlertsActions({ venues, selectedVenueId, onSelect }) {
  const attention = (venues || []).filter(
    (v) => v.health !== "green" ||
      v.open_incidents > 0 ||
      v.unallocated_this_week > 0 ||
      v.unassigned_refs_this_week > 0
  );
  const billing = (venues || []).filter(
    (v) => v.subscription_status && v.subscription_status !== "active"
  );

  return (
    <div>
      <div className="section">
        <h2>Needs attention</h2>
        {attention.length === 0 && <div className="empty">All venues healthy 🎉</div>}
        {attention.map((v) => (
          <button
            key={v.id}
            className={"venue-card" + (v.id === selectedVenueId ? " active" : "")}
            onClick={() => onSelect(v.id)}
          >
            <div className="vc-top">
              <span className={"dot " + (v.health || "green")} />
              <span className="vc-name">{v.name}</span>
            </div>
            <div className="vc-stats">
              {v.critical_incidents > 0 && <span className="fr-warn">{v.critical_incidents} critical</span>}
              {v.open_incidents > 0 && <span>{v.open_incidents} open</span>}
              {v.unallocated_this_week > 0 && <span className="fr-warn">{v.unallocated_this_week} no pitch</span>}
              {v.unassigned_refs_this_week > 0 && <span className="fr-warn">{v.unassigned_refs_this_week} no ref</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="section">
        <h2>Billing</h2>
        {billing.length === 0 && <div className="empty">All subscriptions active.</div>}
        {billing.map((v) => (
          <div className="list-row" key={v.id}>
            <div className="lr-top">
              <span className="lr-desc">{v.name}</span>
              <span className={"badge " + (v.subscription_status === "trial" ? "warn" : "danger")}>
                {v.subscription_status}
              </span>
            </div>
            {v.trial_ends_at && (
              <div className="lr-meta">Trial ends {fmtDate(v.trial_ends_at)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch (e) { return ts; }
}
