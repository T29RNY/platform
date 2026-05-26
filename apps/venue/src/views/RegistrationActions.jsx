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
      <div className="row-actions">
        <button onClick={doApprove} disabled={busy} className="btn-good">Approve</button>
        <button onClick={() => setRejectOpen(true)} disabled={busy} className="btn-bad">Reject</button>
      </div>
      <Modal
        open={rejectOpen}
        onClose={() => !busy && setRejectOpen(false)}
        title={`Reject ${registration.team_name || registration.team_id}`}
        footer={
          <>
            <button onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</button>
            <button onClick={doReject} disabled={busy} className="btn-bad">
              {busy ? "Rejecting…" : "Reject"}
            </button>
          </>
        }
      >
        <label>Reason</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. squad not yet complete; please re-apply once finalised"
        />
        {error && <p className="error">{error}</p>}
      </Modal>
    </>
  );
}
