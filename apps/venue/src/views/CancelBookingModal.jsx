import React, { useState } from "react";
import Modal from "./Modal.jsx";
import { cancelBooking } from "@platform/core/storage/supabase.js";
import { fmtTime, fmtDayShort } from "../bookingUtil.js";

// Policy-driven single-booking cancellation (mig 222). The operator picks a
// reason + refund decision; the server refunds/charges the booking's charge
// accordingly and records the lot to the cancellations log. within-policy is a
// client heuristic (>=48h notice) surfaced from venue.cancellation_policy and
// used only to pre-select the sensible default decision.
const REASONS = ["Pitch unavailable", "Booker request", "Weather", "Operator error", "Venue closure", "Other"];
const DECISIONS = [
  { id: "full", label: "Full refund", hint: "Charge dropped — nothing owed." },
  { id: "partial", label: "50% credit", hint: "Half the fee still charged." },
  { id: "none", label: "No refund", hint: "Full fee still owed." },
];

export default function CancelBookingModal({ booking, venue, venueToken, onClose, onDone }) {
  const start = booking?.start ? new Date(booking.start) : null;
  const hoursUntil = start ? (start.getTime() - Date.now()) / 3600000 : Infinity;
  const withinPolicy = hoursUntil >= 48;

  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState(withinPolicy ? "full" : "partial");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      await cancelBooking(booking.id, venueToken, { reason, note: note.trim() || null, decision, withinPolicy });
      onDone?.();
    } catch (e) {
      setError("Couldn't cancel the booking — try again.");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={() => !busy && onClose()} title="Cancel booking"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Keep booking</button>
        <span className="spacer" />
        <button className="btn btn-danger" onClick={confirm} disabled={busy}>{busy ? "Cancelling…" : "Cancel booking"}</button>
      </>}>
      <div className="card surface-2 card-pad" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700 }}>{booking.teamName || booking.bookedByName || "Booking"}</div>
        <div className="text-mute" style={{ fontSize: 13, marginTop: 2 }}>
          {booking.pitchName} · {start ? `${fmtDayShort(booking.start)} · ${fmtTime(booking.start)}` : ""}
        </div>
      </div>

      <div className={"banner " + (withinPolicy ? "banner-info" : "banner-warn")} style={{ marginBottom: 16 }}>
        <strong>{withinPolicy ? "Within cancellation policy" : "Short notice"}</strong>
        <span> · {venue?.cancellation_policy || (withinPolicy ? "48h+ notice." : "Less than 48h to kickoff.")}</span>
      </div>

      <label className="field-label">Reason</label>
      <div className="chips" style={{ flexWrap: "wrap", marginBottom: 16 }}>
        {REASONS.map((r) => (
          <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
        ))}
      </div>

      <label className="field-label">Note (optional)</label>
      <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. floodlight repair clashes" style={{ marginBottom: 16 }} />

      <label className="field-label">Refund decision</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {DECISIONS.map((d) => (
          <button key={d.id} type="button" className="charge-opt"
            onClick={() => setDecision(d.id)}
            style={{ borderColor: decision === d.id ? "var(--accent)" : "var(--border)" }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
            <div className="text-mute" style={{ fontSize: 11, marginTop: 4 }}>{d.hint}</div>
          </button>
        ))}
      </div>

      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}
