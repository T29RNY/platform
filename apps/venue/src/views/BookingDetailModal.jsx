import React, { useState } from "react";
import Modal from "./Modal.jsx";
import { venueConfirmBooking, venueDeclineBooking, cancelBooking, cancelBookingSeries }
  from "@platform/core/storage/supabase.js";
import { fmtTime, fmtDayShort } from "../bookingUtil.js";

// Tap a booking block on the calendar → confirm/decline (pending) or cancel (confirmed).
// Fixtures and maintenance are not actionable here, so they never open this modal.
export default function BookingDetailModal({ open, occ, venueToken, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
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

  return (
    <Modal open={open} onClose={onClose} title={d.team_name || "Booking"}>
      <div className="bk-detail">
        <div className="bk-detail-row"><span>Pitch</span><strong>{occ.pitch_name}</strong></div>
        <div className="bk-detail-row"><span>When</span><strong>{fmtDayShort(occ.start)} · {fmtTime(occ.start)}–{fmtTime(occ.end)}</strong></div>
        <div className="bk-detail-row"><span>Type</span><strong>{isSeries ? "Weekly block" : "One-off"}</strong></div>
        <div className="bk-detail-row"><span>Status</span><strong style={{ textTransform: "capitalize" }}>{d.status}</strong></div>
      </div>

      {error && <div className="bk-inbox-error">{error}</div>}

      <div className="bk-detail-actions">
        {pending ? (
          <>
            <button className="btn-good" disabled={busy} onClick={() => run(() => venueConfirmBooking(venueToken, bookingId))}>
              {busy ? "…" : "Confirm"}
            </button>
            <button className="btn-bad" disabled={busy} onClick={() => run(() => venueDeclineBooking(venueToken, bookingId))}>
              Decline
            </button>
          </>
        ) : (
          <button className="btn-bad" disabled={busy} onClick={() => run(() => cancelBooking(bookingId, venueToken))}>
            {busy ? "Cancelling…" : "Cancel this booking"}
          </button>
        )}
      </div>
      {isSeries && !pending && (
        <button className="btn-link bk-detail-series" disabled={busy} onClick={() => run(() => cancelBookingSeries(d.series_id, venueToken))}>
          Cancel the whole weekly series
        </button>
      )}
    </Modal>
  );
}
