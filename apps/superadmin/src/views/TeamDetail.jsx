import React, { useEffect, useMemo, useState } from "react";
import { superadminTeamDetail } from "@platform/core/storage/supabase.js";
import { actionLabel, actorLabel } from "../eventLabels.js";

const EVENT_PERIODS = [
  { key: "all", label: "All", hours: null },
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7 days", hours: 168 },
  { key: "30d", label: "30 days", hours: 720 },
];

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function fmtMoney(n) {
  if (n == null) return "—";
  return "£" + Number(n).toFixed(2);
}

const CASUAL_BASE = "https://www.in-or-out.com";
function copyToClipboard(text) {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).catch((err) => console.error("[teamdetail] copy failed", err));
}
function CopyBtn({ text }) {
  return <button onClick={(e) => { e.stopPropagation(); copyToClipboard(text); }} style={{ fontSize: 12, padding: "2px 8px" }}>Copy</button>;
}

function StatusBadge({ status }) {
  const cls =
    status === "in"      ? "good" :
    status === "out"     ? "danger" :
    status === "maybe"   ? "warn" :
    status === "reserve" ? "warn" :
    "";
  return <span className={`badge ${cls}`}>{status || "—"}</span>;
}

export default function TeamDetail({ teamId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [evPeriod, setEvPeriod] = useState("all");
  const [evType, setEvType] = useState("all");

  const allEvents = detail?.recent_events || [];
  const eventTypes = useMemo(
    () => Array.from(new Set(allEvents.map((e) => e.action))).sort(),
    [allEvents]
  );
  const filteredEvents = useMemo(() => {
    const cutoff = EVENT_PERIODS.find((p) => p.key === evPeriod)?.hours;
    const minTs = cutoff ? Date.now() - cutoff * 3600 * 1000 : null;
    return allEvents.filter((e) =>
      (evType === "all" || e.action === evType) &&
      (!minTs || new Date(e.created_at).getTime() >= minTs)
    );
  }, [allEvents, evPeriod, evType]);

  useEffect(() => {
    setLoading(true);
    superadminTeamDetail(teamId)
      .then((data) => { setDetail(data); setError(null); })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [teamId]);

  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!detail) return <div className="muted">No data.</div>;

  const { team, schedule, squad, matches, payments, admins, recent_events } = detail;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {/* Header (full width) */}
      <div className="section" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{team.name}</h2>
            <div className="mono muted">{team.id}</div>
          </div>
          <div className="kv">
            <dt>Admin email</dt><dd>{team.admin_email || "—"}</dd>
            <dt>Join code</dt><dd className="mono">{team.join_code || "—"}</dd>
            <dt>Created</dt><dd>{fmtDate(team.created_at)}</dd>
            <dt>Onboarding</dt>
            <dd>{team.onboarding_complete
              ? <span className="badge good">complete</span>
              : <span className="badge warn">incomplete</span>}</dd>
          </div>
        </div>
      </div>

      {/* Share links — onboarding hand-off */}
      <div className="section" style={{ gridColumn: "1 / -1" }}>
        <h2 style={{ marginTop: 0 }}>Share links</h2>
        {team.join_code ? (
          <div style={{ marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Join link — send to new players so they can join the squad:</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code className="mono" style={{ flex: 1, padding: "8px 10px", background: "#0f0f12", borderRadius: 6, wordBreak: "break-all" }}>
                {CASUAL_BASE}/join/{team.join_code}
              </code>
              <CopyBtn text={`${CASUAL_BASE}/join/${team.join_code}`} />
            </div>
          </div>
        ) : <div className="muted" style={{ marginBottom: 14 }}>No join code on this squad.</div>}

        <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Player links — each player's personal in/out page (re-send to anyone who hasn't joined or installed):</div>
        <table className="data">
          <thead><tr><th>Player</th><th>Personal link</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {squad.filter((p) => !p.disabled && p.token).map((p) => (
              <tr key={p.player_id}>
                <td>{p.name}{p.is_guest && <span className="badge" style={{ marginLeft: 6 }}>guest</span>}</td>
                <td className="mono muted">{CASUAL_BASE}/p/{p.token.slice(0, 10)}…</td>
                <td><CopyBtn text={`${CASUAL_BASE}/p/${p.token}`} /></td>
              </tr>
            ))}
            {squad.filter((p) => !p.disabled && p.token).length === 0 && (
              <tr><td colSpan={3} className="muted">No player links yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Schedule */}
      <div className="section">
        <h2>Schedule</h2>
        {schedule ? (
          <div className="card" style={{ maxWidth: "none" }}>
            <dl className="kv">
              <dt>Day</dt>             <dd>{schedule.day_of_week} {schedule.kickoff}</dd>
              <dt>Venue</dt>           <dd>{schedule.venue || "—"}</dd>
              <dt>Squad size</dt>      <dd>{schedule.squad_size}</dd>
              <dt>Price</dt>           <dd>{fmtMoney(schedule.price_per_player)}</dd>
              <dt>Live now</dt>        <dd>{schedule.game_is_live ? "yes" : "no"}</dd>
              <dt>Lineup locked</dt>   <dd>{schedule.lineup_locked ? "yes" : "no"}</dd>
              <dt>Cancelled</dt>       <dd>{schedule.is_cancelled ? `yes — ${schedule.cancel_reason || ""}` : "no"}</dd>
              <dt>Active match</dt>    <dd className="mono">{schedule.active_match_id || "—"}</dd>
            </dl>
          </div>
        ) : <div className="muted">No active schedule.</div>}
      </div>

      {/* Payments + Admins */}
      <div className="section">
        <h2>Payments</h2>
        <div className="card" style={{ maxWidth: "none", marginBottom: 14 }}>
          <dl className="kv">
            <dt>Outstanding total</dt> <dd>{fmtMoney(payments.outstanding_total)}</dd>
            <dt>Unpaid players</dt>    <dd>{payments.unpaid_count}</dd>
            <dt>Paid (30d)</dt>        <dd>{fmtMoney(payments.paid_last_30d)}</dd>
            <dt>Ledger entries</dt>    <dd>{payments.ledger_size}</dd>
          </dl>
        </div>

        <h2>Team admins ({admins.length})</h2>
        <table className="data">
          <thead>
            <tr><th>Email</th><th>Role</th><th>Granted</th><th>Last sign-in</th></tr>
          </thead>
          <tbody>
            {admins.length === 0 && <tr><td colSpan={4} className="muted">No admins.</td></tr>}
            {admins.map((a) => (
              <tr key={a.user_id}>
                <td>{a.email}</td>
                <td><span className="badge">{a.role}</span></td>
                <td className="mono">{fmtDate(a.granted_at)}</td>
                <td className="mono">{fmtDateTime(a.last_sign_in_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Squad */}
      <div className="section" style={{ gridColumn: "1 / -1" }}>
        <h2>Squad ({squad.length})</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Type</th>
              <th>Team</th>
              <th className="num">Attended</th>
              <th className="num">Goals</th>
              <th className="num">POTM</th>
              <th className="num">Owes</th>
              <th>Token</th>
            </tr>
          </thead>
          <tbody>
            {squad.map((p) => (
              <tr key={p.player_id} style={p.disabled ? { opacity: 0.5 } : undefined}>
                <td>
                  <div>{p.name}{p.is_guest && <span className="badge" style={{ marginLeft: 6 }}>guest</span>}</div>
                  <div className="mono muted">{p.player_id}</div>
                </td>
                <td><StatusBadge status={p.status} /></td>
                <td className="mono muted">{p.type}</td>
                <td className="mono">{p.team || "—"}</td>
                <td className="num">{p.attended} / {p.total}</td>
                <td className="num">{p.goals}</td>
                <td className="num">{p.motm}</td>
                <td className="num">{p.owes > 0 ? fmtMoney(p.owes) : "—"}</td>
                <td>
                  {p.token ? (
                    <a href={`https://www.in-or-out.com/p/${p.token}`} target="_blank" rel="noopener noreferrer" className="mono">
                      /p/{p.token.slice(0, 8)}…
                    </a>
                  ) : <span className="badge danger">missing</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent matches + Recent events */}
      <div className="section">
        <h2>Recent matches ({matches.length})</h2>
        <table className="data">
          <thead><tr><th>Date</th><th>Score</th><th>Winner</th><th>Match id</th></tr></thead>
          <tbody>
            {matches.length === 0 && <tr><td colSpan={4} className="muted">No matches.</td></tr>}
            {matches.map((m) => (
              <tr key={m.match_id}>
                <td>{fmtDate(m.match_date)}</td>
                <td className="mono">
                  {m.cancelled
                    ? <span className="badge danger">cancelled</span>
                    : `${m.score_a ?? "?"} – ${m.score_b ?? "?"}`}
                </td>
                <td className="mono">{m.winner || "—"}</td>
                <td className="mono muted">{m.match_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Recent events ({filteredEvents.length}{filteredEvents.length !== allEvents.length ? ` of ${allEvents.length}` : ""})</h2>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {EVENT_PERIODS.map((p) => (
              <button key={p.key} className={evPeriod === p.key ? "primary" : ""} onClick={() => setEvPeriod(p.key)}>
                {p.label}
              </button>
            ))}
            <select value={evType} onChange={(e) => setEvType(e.target.value)}>
              <option value="all">All event types</option>
              {eventTypes.map((a) => (
                <option key={a} value={a}>{actionLabel(a)}</option>
              ))}
            </select>
          </div>
        </div>
        <table className="data" style={{ marginTop: 10 }}>
          <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 160 }}>Who</th><th>What happened</th></tr></thead>
          <tbody>
            {filteredEvents.length === 0 && <tr><td colSpan={3} className="muted">No events match.</td></tr>}
            {filteredEvents.map((ev) => (
              <tr key={ev.id}>
                <td className="mono">{fmtDateTime(ev.created_at)}</td>
                <td>
                  <span className="badge">{actorLabel(ev.actor_type)}</span>
                  {ev.actor_email && <span className="muted" style={{ marginLeft: 6 }}>{ev.actor_email}</span>}
                </td>
                <td>{actionLabel(ev.action)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
