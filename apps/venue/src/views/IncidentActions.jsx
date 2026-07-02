import React, { useState } from "react";
import {
  venueLogIncident,
  venueResolveIncident,
  venueTriageIncident,
  venueEscalateIncident,
  venueListAssignableStaff,
  venueFlagSafeguarding,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";

// Category values offered in the UI. NOTE: the DB CHECK also allows 'safeguarding'
// (reserved, mig 461) but it is deliberately NOT offered here — the operational
// queue must never silently swallow a child-protection disclosure. The safeguarding
// notice below steers those to the proper route instead.
const CATEGORIES = [
  ["facility", "Facility"], ["equipment", "Equipment"], ["safety", "Safety"],
  ["medical", "Medical"], ["conduct", "Conduct"], ["security", "Security"],
  ["weather", "Weather"], ["other", "Other"],
];
const PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];

// Safety ship-gate (Incident Triage): shown on report + resolve so operators never
// log a safeguarding disclosure into the operational queue.
function SafeguardingNotice() {
  return (
    <p style={{
      fontSize: 12, color: "var(--ink-2)", background: "var(--warn-soft)",
      border: "1px solid var(--warn)", borderRadius: "var(--radius-sm)",
      padding: "8px 10px", marginTop: 10,
    }}>
      <strong>Not for safeguarding.</strong> Child-protection or welfare concerns must go
      through your safeguarding route — never this operational queue.
    </p>
  );
}

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
        <SafeguardingNotice />
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>
    </>
  );
}

// Per-incident actions: Triage (categorise / prioritise / assign / acknowledge),
// Escalate (push to HQ), Resolve (close). mig 462 write RPCs; mig 465 staff read.
export default function IncidentActions({ venueToken, incident, onDone }) {
  const [modal, setModal] = useState(null); // 'triage' | 'escalate' | 'resolve' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Triage form state (pre-filled from the incident).
  const [category, setCategory] = useState(incident.category || "");
  const [priority, setPriority] = useState(incident.priority || "normal");
  const [assignedTo, setAssignedTo] = useState(incident.assigned_to || "");
  const [acknowledge, setAcknowledge] = useState(!!incident.acknowledged_at);
  const [staff, setStaff] = useState(null); // lazy-loaded assignable staff
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  function closeModal() { if (!busy) { setModal(null); setError(null); } }

  async function openTriage() {
    setModal("triage"); setError(null);
    if (staff === null) {
      try {
        const res = await venueListAssignableStaff(venueToken);
        setStaff(res?.staff || []);
      } catch { setStaff([]); } // picker just shows "no staff"; assignment still optional
    }
  }

  async function saveTriage() {
    setBusy(true); setError(null);
    try {
      await venueTriageIncident(venueToken, incident.id, {
        category: category || null,
        priority: priority || null,
        assignedTo: assignedTo || null,
        acknowledge,
      });
      closeModalForce();
      onDone?.();
    } catch (e) { setError(e?.message || String(e)); } finally { setBusy(false); }
  }

  async function escalate() {
    setBusy(true); setError(null);
    try {
      await venueEscalateIncident(venueToken, incident.id, reason.trim() || null);
      closeModalForce(); onDone?.();
    } catch (e) { setError(e?.message || String(e)); } finally { setBusy(false); }
  }

  async function resolve() {
    setBusy(true); setError(null);
    try {
      await venueResolveIncident(venueToken, incident.id, null, note.trim() || null);
      closeModalForce(); onDone?.();
    } catch (e) { setError(e?.message || String(e)); } finally { setBusy(false); }
  }

  async function flagSafeguarding() {
    setBusy(true); setError(null);
    try {
      await venueFlagSafeguarding(venueToken, incident.id);
      closeModalForce(); onDone?.();
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg.includes("already_flagged")
        ? "This incident is already flagged for safeguarding."
        : msg);
    } finally { setBusy(false); }
  }

  function closeModalForce() { setModal(null); setReason(""); setNote(""); }

  const escalated = !!incident.escalated_at;

  return (
    <>
      <div className="actions">
        <button className="btn btn-xs" onClick={openTriage}>Triage</button>
        {!escalated && (
          <button className="btn btn-xs" onClick={() => { setModal("escalate"); setError(null); }}>Escalate</button>
        )}
        <button className="btn btn-xs btn-primary" onClick={() => { setModal("resolve"); setError(null); }}>Resolve</button>
        {/* Safeguarding flag — violet, shield, deliberately not a plain btn-xs peer. */}
        <button className="btn btn-xs" onClick={() => { setModal("flag"); setError(null); }}
                title="Flag as a child-protection / welfare concern"
                style={{ borderColor: "var(--train)", color: "var(--train)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="shield" size={13} />Safeguarding
        </button>
      </div>

      {/* Triage */}
      <Modal
        open={modal === "triage"}
        onClose={closeModal}
        title="Triage incident"
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeModal} disabled={busy}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={saveTriage} disabled={busy}>
              {busy ? "Saving…" : "Save triage"}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>{incident.description}</p>
        <label className="field-label">Category</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">— none —</option>
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="field-label" style={{ marginTop: 12 }}>Priority</label>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="field-label" style={{ marginTop: 12 }}>Assign to</label>
        <select className="input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">— unassigned —</option>
          {(staff || []).map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
        </select>
        {staff !== null && staff.length === 0 && (
          <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>No assignable staff on this venue yet.</p>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} disabled={!!incident.acknowledged_at} />
          {incident.acknowledged_at ? "Acknowledged" : "Acknowledge — I'm on it"}
        </label>
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>

      {/* Escalate */}
      <Modal
        open={modal === "escalate"}
        onClose={closeModal}
        title="Escalate to HQ"
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeModal} disabled={busy}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={escalate} disabled={busy}>
              {busy ? "Escalating…" : "Escalate"}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>
          Push this incident up to HQ. They'll see it in their cross-venue escalation inbox.
        </p>
        <label className="field-label">Reason <span style={{ color: "var(--ink-3)" }}>(optional)</span></label>
        <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          placeholder="e.g. contractor needed — beyond what we can fix tonight" />
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>

      {/* Resolve */}
      <Modal
        open={modal === "resolve"}
        onClose={closeModal}
        title="Resolve incident"
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeModal} disabled={busy}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={resolve} disabled={busy}>
              {busy ? "Resolving…" : "Mark resolved"}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>{incident.description}</p>
        <label className="field-label">Resolution note <span style={{ color: "var(--ink-3)" }}>(optional)</span></label>
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder="e.g. floodlight replaced, pitch back in use" />
        <SafeguardingNotice />
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>

      {/* Flag as safeguarding — routes the incident privately to the venue's leads. */}
      <Modal
        open={modal === "flag"}
        onClose={closeModal}
        title="Flag as safeguarding"
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeModal} disabled={busy}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={flagSafeguarding} disabled={busy}
                    style={{ background: "var(--train)", borderColor: "var(--train)" }}>
              {busy ? "Flagging…" : "Flag as safeguarding"}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ color: "var(--train)", flexShrink: 0, marginTop: 2 }}><Icon name="shield" size={20} /></span>
          <div>
            <p style={{ fontSize: 13, color: "var(--ink-1)", marginBottom: 8 }}>
              This removes the incident from the normal operational queue and routes it privately to your
              venue's designated safeguarding lead(s). <strong>You won't be able to see or reopen it here.</strong>
            </p>
            <p style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 8 }}>
              Use this for a child-protection or welfare concern. If this <em>also</em> needs an operational
              response (e.g. first aid, a facility fault), log that as a separate incident.
            </p>
            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Flagging does not replace your organisation's safeguarding procedure — follow that too.
            </p>
          </div>
        </div>
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>
    </>
  );
}
