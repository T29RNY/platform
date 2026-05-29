import React, { useState } from "react";

export default function VenueDetail({ detail, loading, hasSelection, role, onResolve }) {
  if (!hasSelection) {
    return (
      <div>
        <div className="panel-title">Select a venue</div>
        <div className="panel-sub">Tap a venue in the health grid to see its fixtures, leagues and open issues.</div>
      </div>
    );
  }
  if (loading || !detail) return <div className="muted">Loading venue…</div>;

  const v = detail.venue || {};
  const canResolve = role !== "analyst";

  return (
    <div>
      <div className="panel-title">{v.name}</div>
      <div className="panel-sub">
        {v.region ? v.region + " · " : ""}{v.subscription_status}
        {typeof detail.pending_registrations === "number" && detail.pending_registrations > 0
          ? ` · ${detail.pending_registrations} pending registration${detail.pending_registrations > 1 ? "s" : ""}`
          : ""}
      </div>

      <IncidentList
        incidents={detail.open_incidents || []}
        canResolve={canResolve}
        onResolve={onResolve}
      />

      <FixtureSection title="Tonight" rows={detail.fixtures_tonight} score />
      <FixtureSection title="This week" rows={detail.fixtures_this_week} />
      <FixtureSection title="Recent results" rows={detail.fixtures_recent} score />

      <div className="section">
        <h2>Leagues</h2>
        {(detail.leagues || []).length === 0 && <div className="empty">No leagues.</div>}
        {(detail.leagues || []).map((l) => (
          <div className="fixture-row" key={l.id}>
            <span className="fr-teams">{l.name}</span>
            <span className={"badge " + (l.active ? "good" : "")}>{l.active ? "active" : "inactive"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IncidentList({ incidents, canResolve, onResolve }) {
  return (
    <div className="section">
      <h2>Open incidents</h2>
      {incidents.length === 0 && <div className="empty">No open incidents 🎉</div>}
      {incidents.map((i) => (
        <IncidentRow key={i.id} incident={i} canResolve={canResolve} onResolve={onResolve} />
      ))}
    </div>
  );
}

function IncidentRow({ incident, canResolve, onResolve }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const sev = incident.severity === "critical" ? "danger" : (incident.severity === "warning" ? "warn" : "good");

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await onResolve(incident.id, note);
    } catch (e) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  };

  return (
    <div className="list-row">
      <div className="lr-top">
        <span className={"badge " + sev}>{incident.severity}</span>
        <span className="lr-desc">{incident.description}</span>
        {canResolve && !open && (
          <button className="small" onClick={() => setOpen(true)}>Resolve</button>
        )}
      </div>
      <div className="lr-meta">{fmt(incident.created_at)}</div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {open && (
        <div className="resolve-box">
          <input
            placeholder="Resolution note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
          <button className="primary small" onClick={submit} disabled={busy}>
            {busy ? "…" : "Confirm"}
          </button>
          <button className="small" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function FixtureSection({ title, rows, score }) {
  const list = rows || [];
  if (list.length === 0) return null;
  return (
    <div className="section">
      <h2>{title}</h2>
      {list.map((f) => (
        <div className="fixture-row" key={f.id}>
          <span className="fr-teams">{f.home || "TBC"} v {f.away || "TBC"}</span>
          {score && f.home_score != null
            ? <span className="fr-score">{f.home_score}–{f.away_score}</span>
            : <span className="muted">{f.time ? String(f.time).slice(0, 5) : f.status}</span>}
          {f.pitch_allocated === false && <span className="fr-warn">no pitch</span>}
          {f.ref_assigned === false && <span className="fr-warn">no ref</span>}
        </div>
      ))}
    </div>
  );
}

function fmt(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ts; }
}
