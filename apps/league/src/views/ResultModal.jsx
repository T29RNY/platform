import React, { useState } from "react";
import { leagueUpdateFixtureResult } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

// Correct a completed fixture's score (league_update_fixture_result).
export default function ResultModal({ leagueToken, fixture, homeName, awayName, onDone, onClose }) {
  const [home, setHome] = useState(fixture.home_score ?? 0);
  const [away, setAway] = useState(fixture.away_score ?? 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const h = Number(home), a = Number(away);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) { setError("Scores must be whole numbers, 0 or more."); return; }
    if (!reason.trim()) { setError("Give a reason for the correction (kept for audit)."); return; }
    setBusy(true); setError(null);
    try {
      await leagueUpdateFixtureResult(leagueToken, fixture.id, h, a, reason.trim());
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Correct result"
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save result"}</button>
      </>}>
      <div className="rm-score">
        <div className="rm-side">
          <span className="rm-team">{homeName}</span>
          <input type="number" min={0} value={home} onChange={(e) => setHome(e.target.value)} className="rm-input" />
        </div>
        <span className="rm-dash">–</span>
        <div className="rm-side">
          <span className="rm-team">{awayName}</span>
          <input type="number" min={0} value={away} onChange={(e) => setAway(e.target.value)} className="rm-input" />
        </div>
      </div>
      <label>Reason for correction</label>
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. scorer double-counted, reviewed footage" />
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
