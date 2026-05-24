import React, { useEffect, useState, useCallback } from "react";
import { superadminRecentActivity } from "@platform/supabase";

const WINDOWS = [
  { label: "1h",  hours: 1 },
  { label: "6h",  hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d",  hours: 168 },
];

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ActorBadge({ type, email }) {
  const cls =
    type === "team_admin"   ? "good" :
    type === "vice_captain" ? "good" :
    type === "super_admin"  ? "warn" :
    type === "system"       ? "" :
    "";
  return (
    <span className={`badge ${cls}`} title={email || type}>
      {type}
    </span>
  );
}

export default function Activity({ onOpenTeam }) {
  const [hours, setHours] = useState(24);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    superadminRecentActivity({ limit: 200, sinceHours: hours })
      .then((data) => { setEvents(data); setError(null); })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Live activity</h2>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="muted">window:</span>
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                className={hours === w.hours ? "primary" : ""}
                onClick={() => setHours(w.hours)}
              >
                {w.label}
              </button>
            ))}
            <button onClick={load} disabled={loading}>{loading ? "…" : "Refresh"}</button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 110 }}>When</th>
              <th style={{ width: 180 }}>Team</th>
              <th style={{ width: 130 }}>Actor</th>
              <th>Action</th>
              <th style={{ width: 110 }}>Entity</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                No events in window.
              </td></tr>
            )}
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="mono">{fmtTime(ev.created_at)}</td>
                <td>
                  {ev.team_id ? (
                    <a href="#" onClick={(e) => { e.preventDefault(); onOpenTeam(ev.team_id); }}>
                      {ev.team_name || ev.team_id}
                    </a>
                  ) : <span className="muted">—</span>}
                </td>
                <td><ActorBadge type={ev.actor_type} email={ev.actor_email} /></td>
                <td className="mono">{ev.action}</td>
                <td className="muted mono" title={ev.entity_id}>{ev.entity_type}</td>
                <td className="mono muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
                  {ev.metadata && Object.keys(ev.metadata).length > 0
                    ? JSON.stringify(ev.metadata).slice(0, 120)
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
