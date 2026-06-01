import React, { useMemo, useState } from "react";
import { leagueUpdateFixtureStatus, leagueRescheduleFixture } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

// Reschedule + status changes (postpone/void/walkover/forfeit) for a league
// fixture. Available actions depend on the fixture's current status.
export default function FixtureManageModal({ leagueToken, fixture, homeName, awayName, onDone, onClose }) {
  const actions = useMemo(() => {
    const s = fixture.status;
    if (s === "postponed") return ["reschedule", "void"];
    if (s === "scheduled" || s === "allocated") return ["reschedule", "postponed", "walkover", "void", "forfeit"];
    return ["reschedule"];
  }, [fixture.status]);

  const [action, setAction] = useState(actions[0]);
  const [date, setDate] = useState(fixture.scheduled_date || "");
  const [time, setTime] = useState((fixture.kickoff_time || "").slice(0, 5));
  const [reason, setReason] = useState("");
  const [winnerId, setWinnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const needsReason = action === "postponed" || action === "void" || action === "forfeit";
  const needsWinner = action === "walkover" || action === "forfeit";

  async function save() {
    setError(null);
    try {
      if (action === "reschedule") {
        if (!date || !time) { setError("Pick a date and kickoff time."); return; }
        setBusy(true);
        await leagueRescheduleFixture(leagueToken, fixture.id, date, time, reason.trim() || null);
      } else {
        if (needsWinner && !winnerId) { setError("Pick the winning team."); return; }
        if (needsReason && !reason.trim()) { setError("A reason is required."); return; }
        const meta = {};
        if (action === "postponed") meta.postpone_reason = reason.trim();
        if (action === "void")      meta.void_reason = reason.trim();
        if (action === "walkover")  meta.winner_team_id = winnerId;
        if (action === "forfeit")   { meta.winner_team_id = winnerId; meta.forfeit_reason = reason.trim(); }
        setBusy(true);
        await leagueUpdateFixtureStatus(leagueToken, fixture.id, action, meta);
      }
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Manage fixture"
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save"}</button>
      </>}>
      <p className="muted" style={{ marginBottom: 6 }}>{homeName} v {awayName}</p>

      <label>Action</label>
      <select value={action} onChange={(e) => { setAction(e.target.value); setReason(""); setWinnerId(""); }}>
        {actions.map((a) => <option key={a} value={a}>{LABEL[a]}</option>)}
      </select>

      {action === "reschedule" && (
        <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div><label>New date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label>Kickoff</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
      )}

      {needsWinner && (
        <>
          <label>Winner</label>
          <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
            <option value="">— pick one —</option>
            <option value={fixture.home_team_id}>{homeName} (home)</option>
            {fixture.away_team_id && <option value={fixture.away_team_id}>{awayName} (away)</option>}
          </select>
        </>
      )}

      {(needsReason || action === "reschedule") && (
        <>
          <label>{action === "reschedule" ? "Note (optional)" : "Reason"}</label>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={PLACEHOLDER[action] || ""} />
        </>
      )}

      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

const LABEL = {
  reschedule: "Reschedule (new date/time)",
  postponed: "Postpone",
  void: "Void",
  walkover: "Walkover",
  forfeit: "Forfeit",
};
const PLACEHOLDER = {
  reschedule: "e.g. moved at both teams’ request",
  postponed: "e.g. waterlogged pitch",
  void: "e.g. duplicate fixture",
  forfeit: "e.g. ineligible player",
};
