import React, { useState } from "react";
import { venueConfirmBooking, venueDeclineBooking, cancelBookingSeries } from "@platform/core/storage/supabase.js";
import { fmtTime, fmtDayLabel } from "../bookingUtil.js";

function summary(g) {
  const first = g.starts[0];
  const time = first ? fmtTime(first) : "";
  if (g.seriesId) {
    return `Weekly · ${g.bookingIds.length} week${g.bookingIds.length === 1 ? "" : "s"} · ${first ? fmtDayLabel(first) : ""} · ${time}`;
  }
  return `${first ? fmtDayLabel(first) : ""} · ${time}`;
}

export default function RequestsInbox({ groups, venueToken, onChanged }) {
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);

  if (!groups.length) {
    return <p className="muted">No pending requests. The queue is clear.</p>;
  }

  const run = async (g, action) => {
    setBusyKey(g.key);
    setError(null);
    try {
      if (action === "confirm") {
        // Confirm each occurrence (series = confirm every weekly row we hold).
        for (const id of g.bookingIds) await venueConfirmBooking(venueToken, id);
      } else if (g.seriesId) {
        await cancelBookingSeries(g.seriesId, venueToken); // decline whole block
      } else {
        await venueDeclineBooking(venueToken, g.bookingIds[0]);
      }
      onChanged?.();
    } catch (e) {
      setError(e?.message === "booking_not_pending"
        ? "That slot was just taken — it can't be confirmed."
        : "Couldn't update the request — try again.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="bk-inbox">
      {error && <div className="bk-inbox-error">{error}</div>}
      {groups.map((g) => {
        const busy = busyKey === g.key;
        return (
          <div className="bk-req" key={g.key}>
            <div className="bk-req-main">
              <div className="bk-req-team">{g.teamName}</div>
              <div className="bk-req-meta">
                <span className={"bk-kind " + (g.seriesId ? "bk-kind-block" : "bk-kind-adhoc")}>
                  {g.seriesId ? "Block" : "One-off"}
                </span>
                <span className="bk-req-pitch">{g.pitchName}</span>
              </div>
              <div className="bk-req-when">{summary(g)}</div>
            </div>
            <div className="bk-req-actions">
              <button className="btn-good" disabled={busy} onClick={() => run(g, "confirm")}>
                {busy ? "…" : "Confirm"}
              </button>
              <button className="btn-bad" disabled={busy} onClick={() => run(g, "decline")}>
                Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
