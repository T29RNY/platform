import React, { useState } from "react";
import {
  venueApproveTeamRegistration,
  venueRejectTeamRegistration,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

export default function RegistrationActions({ venueToken, registration, onDone }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function doApprove() {
    setBusy(true); setError(null);
    try {
      await venueApproveTeamRegistration(venueToken, registration.id);
      onDone?.();
    } catch (e) {
      setError(e?.message || String(e));
    } finally { setBusy(false); }
  }
  async function doReject() {
    if (!reason.trim()) { setError("Reason required."); return; }
    setBusy(true); setError(null);
    try {
      await venueRejectTeamRegistration(venueToken, registration.id, reason.trim());
      setRejectOpen(false);
      setReason("");
      onDone?.();
    } catch (e) {
      setError(e?.message || String(e));
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="actions">
        <button className="btn btn-xs btn-primary" onClick={doApprove} disabled={busy}>Approve</button>
        <button className="btn btn-xs" onClick={() => setRejectOpen(true)} disabled={busy}>Reject</button>
      </div>
      <Modal
        open={rejectOpen}
        onClose={() => !busy && setRejectOpen(false)}
        title={`Reject ${registration.team_name || registration.team_id}`}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-danger" onClick={doReject} disabled={busy}>
              {busy ? "Rejecting…" : "Reject"}
            </button>
          </>
        }
      >
        <label className="field-label">Reason</label>
        <textarea
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. squad not yet complete; please re-apply once finalised"
        />
        {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
      </Modal>
    </>
  );
}
