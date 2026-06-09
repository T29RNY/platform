import React, { useState } from "react";
import {
  venueLogIncident,
  venueResolveIncident,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

// "Report incident" button + modal — sits in the Open issues header.
export function ReportIncidentButton({ venueToken, onDone }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("warning");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function reset() { setDescription(""); setSeverity("warning"); setError(null); }

  async function submit() {
    if (!description.trim()) { setError("Describe what's happened."); return; }
    setBusy(true); setError(null);
    try {
      await venueLogIncident(venueToken, description.trim(), severity);
      setOpen(false);
      reset();
      onDone?.();
    } catch (e) {
      setError(e?.message || String(e));
    } finally { setBusy(false); }
  }

  return (
    <>
      <button className="btn btn-xs" onClick={() => setOpen(true)}>Report incident</button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Report an incident"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? "Saving…" : "Log incident"}
            </button>
          </>
        }
      >
        <label className="field-label">What's happened?</label>
        <textarea
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="e.g. Floodlight fault on pitch 2 — half the pitch dim"
        />
        <label className="field-label" style={{ marginTop: 12 }}>Severity</label>
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="info">Info — for awareness</option>
          <option value="warning">Warning — needs attention</option>
          <option value="critical">Critical — fixtures at risk</option>
        </select>
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>
    </>
  );
}

// Per-incident "Resolve" action (with optional resolution note).
export default function IncidentActions({ venueToken, incident, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function resolve() {
    setBusy(true); setError(null);
    try {
      await venueResolveIncident(venueToken, incident.id, note.trim() || null);
      setOpen(false);
      setNote("");
      onDone?.();
    } catch (e) {
      setError(e?.message || String(e));
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="actions">
        <button className="btn btn-xs btn-primary" onClick={() => setOpen(true)}>Resolve</button>
      </div>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Resolve incident"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={resolve} disabled={busy}>
              {busy ? "Resolving…" : "Mark resolved"}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>{incident.description}</p>
        <label className="field-label">Resolution note <span style={{ color: "var(--ink-3)" }}>(optional)</span></label>
        <textarea
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. floodlight replaced, pitch back in use"
        />
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>
    </>
  );
}
