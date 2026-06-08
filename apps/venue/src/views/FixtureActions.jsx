import React, { useState } from "react";
import {
  venueAssignPitch,
  venueAssignRef,
  venueUpdateFixtureStatus,
  venueUpdateFixtureResult,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

const STATUS_CHOICES = [
  { value: "postponed", label: "Postpone" },
  { value: "void",      label: "Void" },
  { value: "walkover",  label: "Walkover" },
  { value: "forfeit",   label: "Forfeit" },
];

const MUTABLE = new Set(["scheduled", "allocated", "postponed", "completed"]);

export default function FixtureActions({ venueToken, fixture, state, onDone }) {
  const [open, setOpen] = useState(null); // 'pitch' | 'ref' | 'status' | null
  if (!MUTABLE.has(fixture.status)) return null;

  return (
    <>
      <div className="actions">
        {["scheduled","allocated"].includes(fixture.status) && (
          <>
            <button className="btn btn-xs" onClick={() => setOpen("pitch")}>Pitch</button>
            <button className="btn btn-xs" onClick={() => setOpen("ref")}>Ref</button>
          </>
        )}
        {fixture.status === "completed" && (
          <button className="btn btn-xs" onClick={() => setOpen("score")}>Edit score</button>
        )}
        <button className="btn btn-xs" onClick={() => setOpen("status")}>•••</button>
      </div>
      {open === "pitch"  && <PitchModal  fixture={fixture} state={state} venueToken={venueToken} onDone={onDone} onClose={() => setOpen(null)} />}
      {open === "ref"    && <RefModal    fixture={fixture} state={state} venueToken={venueToken} onDone={onDone} onClose={() => setOpen(null)} />}
      {open === "status" && <StatusModal fixture={fixture} state={state} venueToken={venueToken} onDone={onDone} onClose={() => setOpen(null)} />}
      {open === "score"  && <ScoreModal  fixture={fixture} state={state} venueToken={venueToken} onDone={onDone} onClose={() => setOpen(null)} />}
    </>
  );
}

function PitchModal({ fixture, state, venueToken, onDone, onClose }) {
  const [pitchId, setPitchId] = useState(fixture.playing_area_id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pitches = (state.pitches || []).filter((p) => p.active);

  function inMaintenance(p) {
    if (!fixture.scheduled_date) return false;
    const date = fixture.scheduled_date;
    return (p.maintenance_windows || []).some(
      (w) => date >= w.start_date && date <= w.end_date
    );
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      await venueAssignPitch(venueToken, fixture.id, pitchId || null);
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title="Assign pitch"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label className="field-label">Pitch</label>
      <select className="input" value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
        <option value="">— None (clear) —</option>
        {pitches.map((p) => {
          const blocked = inMaintenance(p);
          return (
            <option key={p.id} value={p.id} disabled={blocked}>
              {p.name}{p.surface ? ` (${p.surface})` : ""}{!p.is_available ? " — unavailable" : ""}{blocked ? " — in maintenance" : ""}
            </option>
          );
        })}
      </select>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

function RefModal({ fixture, state, venueToken, onDone, onClose }) {
  const [refId, setRefId] = useState(fixture.official_id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const refs = (state.refs || []).filter((r) => r.active);

  async function save() {
    setBusy(true); setError(null);
    try {
      await venueAssignRef(venueToken, fixture.id, refId || null);
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title="Assign referee"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label className="field-label">Official</label>
      <select className="input" value={refId} onChange={(e) => setRefId(e.target.value)}>
        <option value="">— None (clear) —</option>
        {refs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} — {r.preferred_channel || "push"}{r.overall_rating ? ` · ${Number(r.overall_rating).toFixed(1)}★` : ""}
          </option>
        ))}
      </select>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

function StatusModal({ fixture, state, venueToken, onDone, onClose }) {
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [winnerId, setWinnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const teams = state.teams || {};

  const allowed = STATUS_CHOICES.filter((c) => allowsTransition(fixture.status, c.value));
  const needsReason = status === "postponed" || status === "void" || status === "forfeit";
  const needsWinner = status === "walkover" || status === "forfeit";

  async function save() {
    if (!status) { setError("Pick a status."); return; }
    if (needsReason && !reason.trim()) { setError("Reason required."); return; }
    if (needsWinner && !winnerId) { setError("Pick a winner."); return; }
    const meta = {};
    if (status === "postponed") meta.postpone_reason = reason.trim();
    if (status === "void")      meta.void_reason     = reason.trim();
    if (status === "walkover")  meta.winner_team_id  = winnerId;
    if (status === "forfeit")   { meta.winner_team_id = winnerId; meta.forfeit_reason = reason.trim(); }
    setBusy(true); setError(null);
    try {
      await venueUpdateFixtureStatus(venueToken, fixture.id, status, meta);
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title="Change fixture status"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label className="field-label">New status</label>
      <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setReason(""); setWinnerId(""); }}>
        <option value="">— pick one —</option>
        {allowed.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {needsWinner && (
        <>
          <label className="field-label">Winner</label>
          <select className="input" value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
            <option value="">— pick one —</option>
            <option value={fixture.home_team_id}>{teams[fixture.home_team_id]?.name || fixture.home_team_id} (home)</option>
            {fixture.away_team_id && (
              <option value={fixture.away_team_id}>{teams[fixture.away_team_id]?.name || fixture.away_team_id} (away)</option>
            )}
          </select>
        </>
      )}
      {needsReason && (
        <>
          <label className="field-label">Reason</label>
          <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      )}
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

// Correct the scoreline on an already-completed league fixture
// (venue_update_fixture_result). Requires a reason; the correction notifies both
// teams + the league and re-derives the table. Does NOT enter a result on a
// not-yet-completed fixture — the RPC rejects that (live scoring is the ref app).
function ScoreModal({ fixture, state, venueToken, onDone, onClose }) {
  const teams = state.teams || {};
  const [home, setHome] = useState(fixture.home_score ?? 0);
  const [away, setAway] = useState(fixture.away_score ?? 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const h = parseInt(home, 10), a = parseInt(away, 10);
    if (!Number.isFinite(h) || !Number.isFinite(a) || h < 0 || a < 0) { setError("Enter both scores (0 or more)."); return; }
    if (!reason.trim()) { setError("A reason is required for a correction."); return; }
    setBusy(true); setError(null);
    try {
      await venueUpdateFixtureResult(venueToken, { fixtureId: fixture.id, homeScore: h, awayScore: a, reason: reason.trim() });
      onDone?.(); onClose();
    } catch (e) {
      setError(e?.message === "fixture_not_completed" ? "Only a finished match can be corrected." : (e?.message || "Couldn’t save the score."));
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Edit score"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save score"}</button>
      </>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>Corrects the recorded result. Both teams are notified and the table updates.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "end", gap: 12 }}>
        <div>
          <label className="field-label">{teams[fixture.home_team_id]?.name || "Home"}</label>
          <input className="input" type="number" min="0" inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value)} />
        </div>
        <div style={{ paddingBottom: 12, color: "var(--ink-3)" }}>–</div>
        <div>
          <label className="field-label">{teams[fixture.away_team_id]?.name || "Away"}</label>
          <input className="input" type="number" min="0" inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value)} />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 14 }}>Reason</label>
      <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. ref recorded the wrong scoreline" />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

function allowsTransition(from, to) {
  if (to === "postponed") return ["scheduled","allocated"].includes(from);
  if (to === "void")      return ["scheduled","allocated","postponed"].includes(from);
  if (to === "walkover")  return ["scheduled","allocated"].includes(from);
  if (to === "forfeit")   return ["scheduled","allocated","completed"].includes(from);
  return false;
}
