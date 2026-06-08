import React, { useState } from "react";
import Modal from "./Modal.jsx";
import CancelBookingModal from "./CancelBookingModal.jsx";
import { venueConfirmBooking, venueDeclineBooking, cancelBookingSeries }
  from "@platform/core/storage/supabase.js";
import { fmtTime, fmtDayShort } from "../bookingUtil.js";

// Tap a booking block → confirm/decline (pending) or cancel (confirmed).
// A confirmed-booking cancel opens the policy-driven CancelBookingModal so the
// operator records a reason + refund decision (mig 222).
export default function BookingDetailModal({ open, occ, venue, ins, venueToken, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  if (!open || !occ) return null;

  const d = occ.detail ?? {};
  const bookingId = occ.source_id;
  const isSeries = !!d.series_id;
  const pending = d.status === "requested";

  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged?.(); onClose?.(); }
    catch (e) {
      setError(e?.message === "booking_not_pending"
        ? "That slot was just taken — it can't be confirmed."
        : "Couldn't update the booking — try again.");
      setBusy(false);
    }
  };

  if (cancelOpen) {
    return (
      <CancelBookingModal
        booking={{ id: bookingId, seriesId: d.series_id, teamName: d.team_name, bookedByName: d.booked_by_name, pitchName: occ.pitch_name, start: occ.start, end: occ.end }}
        venue={venue}
        venueToken={venueToken}
        onClose={() => setCancelOpen(false)}
        onDone={() => { setCancelOpen(false); onChanged?.(); onClose?.(); }}
      />
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={d.team_name || d.booked_by_name || "Booking"}>
      <div className="bk-detail">
        <div className="bk-detail-row"><span className="text-mute">Pitch</span><strong>{occ.pitch_name}</strong></div>
        <div className="bk-detail-row"><span className="text-mute">When</span><strong>{fmtDayShort(occ.start)} · {fmtTime(occ.start)}–{fmtTime(occ.end)}</strong></div>
        <div className="bk-detail-row"><span className="text-mute">Type</span><strong>{isSeries ? "Weekly block" : "One-off"}</strong></div>
        <div className="bk-detail-row"><span className="text-mute">Status</span><strong style={{ textTransform: "capitalize" }}>{d.status}</strong></div>
        {ins && (
          <div className="bk-detail-row">
            <span className="text-mute">Players in</span>
            <strong style={{ color: "var(--ok)" }}>{ins.in_count}{ins.target ? `/${ins.target}` : ""} in <span className="pill pill-live" style={{ marginLeft: 6 }}><span className="pill-dot" />live</span></strong>
          </div>
        )}
      </div>

      {error && <div className="bk-inbox-error">{error}</div>}

      <div className="bk-detail-actions" style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {pending ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(() => venueConfirmBooking(venueToken, bookingId))}>
              {busy ? "…" : "Confirm"}
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => run(() => venueDeclineBooking(venueToken, bookingId))}>
              Decline
            </button>
          </>
        ) : (
          <button className="btn btn-danger" disabled={busy} onClick={() => setCancelOpen(true)}>
            Cancel this booking
          </button>
        )}
      </div>
      {isSeries && !pending && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={busy}
          onClick={() => run(() => cancelBookingSeries(d.series_id, venueToken))}>
          Cancel the whole weekly series
        </button>
      )}
    </Modal>
  );
}
