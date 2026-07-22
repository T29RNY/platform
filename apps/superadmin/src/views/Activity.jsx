import React, { useEffect, useState, useCallback } from "react";
import { superadminRecentActivity, superadminRecentSessions } from "@platform/core/storage/supabase.js";

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

// A session's duration in plain words.
function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// route TYPE → what a non-technical operator reads. Unknown types pass through
// title-cased rather than showing a raw slug.
const ROUTE_LABELS = {
  hub: "Home", tonight: "Tonight", player: "Availability", admin: "Admin",
  sessions: "Sessions", classes: "Classes", book: "Booking", bookings: "Bookings",
  profile: "Profile", member: "Member area", club_public: "Club page",
  club_trial: "Trial booking", tournament: "Tournament", landing: "Landing",
  feed: "Feed", stats: "Stats", matches: "Matches", people: "People",
};
function routeLabel(t) {
  if (!t) return "—";
  return ROUTE_LABELS[t] || t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deviceLabel(s) {
  const platform = s.platform === "native" ? "iPhone" : "Browser";
  return platform;
}

// Honest activity hint from what app_sessions actually knows (screen count).
function activityHint(s) {
  const n = s.screen_count || 1;
  if (n <= 1) return "Just glanced";
  return `Browsed ${n} screens`;
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
  const [mode, setMode] = useState("sessions"); // 'sessions' | 'events'
  const [hours, setHours] = useState(24);
  const [events, setEvents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const p = mode === "sessions"
      ? superadminRecentSessions(200, since).then((data) => setSessions(data))
      : superadminRecentActivity({ limit: 200, sinceHours: hours }).then((data) => setEvents(data));
    p.catch((err) => setError(err.message || String(err))).finally(() => setLoading(false));
  }, [hours, mode]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className={mode === "sessions" ? "primary" : ""} onClick={() => setMode("sessions")}>Sessions</button>
            <button className={mode === "events" ? "primary" : ""} onClick={() => setMode("events")}>Raw events</button>
          </div>
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

        {mode === "sessions" ? (
          <table className="data">
            <thead>
              <tr>
                <th>Who</th>
                <th style={{ width: 110 }}>When</th>
                <th style={{ width: 90 }}>Device</th>
                <th style={{ width: 80 }}>Stayed</th>
                <th style={{ width: 130 }}>Got as far as</th>
                <th>Did anything?</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && !loading && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  Nobody opened the app in this window.
                </td></tr>
              )}
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.who}
                    {s.active_hat && <span className="muted"> · {s.active_hat.replace(/_/g, " ")}</span>}
                  </td>
                  <td className="mono">{fmtTime(s.started_at)}</td>
                  <td className="muted">{deviceLabel(s)}</td>
                  <td className="mono" style={{ color: (s.duration_seconds || 0) < 20 ? "var(--danger)" : undefined }}>
                    {fmtDuration(s.duration_seconds)}
                  </td>
                  <td>{routeLabel(s.last_route)}</td>
                  <td className="muted">{activityHint(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
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
        )}
      </div>
    </div>
  );
}
