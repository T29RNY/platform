import React, { useState } from "react";
import {
  venueAssignPitch,
  venueAssignRef,
  venueUpdateFixtureStatus,
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
      <div className="row-actions">
        {["scheduled","allocated"].includes(fixture.status) && (
          <>
            <button onClick={() => setOpen("pitch")}>Pitch</button>
            <button onClick={() => setOpen("ref")}>Ref</button>
          </>
        )}
        <button onClick={() => setOpen("status")}>Status</button>
      </div>
      {open === "pitch"  && <PitchModal  fixture={fixture} state={state} venueToken={venueToken} onDone={onDone} onClose={() => setOpen(null)} />}
      {open === "ref"    && <RefModal    fixture={fixture} state={state} venueToken={venueToken} onDone={onDone} onClose={() => setOpen(null)} />}
      {open === "status" && <StatusModal fixture={fixture} state={state} venueToken={venueToken} onDone={onDone} onClose={() => setOpen(null)} />}
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
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label>Pitch</label>
      <select value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
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
      {error && <p className="error">{error}</p>}
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
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label>Official</label>
      <select value={refId} onChange={(e) => setRefId(e.target.value)}>
        <option value="">— None (clear) —</option>
        {refs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} — {r.preferred_channel || "push"}{r.overall_rating ? ` · ${Number(r.overall_rating).toFixed(1)}★` : ""}
          </option>
        ))}
      </select>
      {error && <p className="error">{error}</p>}
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
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label>New status</label>
      <select value={status} onChange={(e) => { setStatus(e.target.value); setReason(""); setWinnerId(""); }}>
        <option value="">— pick one —</option>
        {allowed.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {needsWinner && (
        <>
          <label>Winner</label>
          <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
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
          <label>Reason</label>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      )}
      {error && <p className="error">{error}</p>}
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
