import React, { useState } from "react";
import { venueConfirmBooking, venueDeclineBooking, cancelBookingSeries } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";
import { getInitials } from "../lib/format.js";
import { fmtTime, fmtDayShort } from "../bookingUtil.js";

export default function RequestsInbox({ groups, venueToken, onChanged }) {
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);

  if (!groups.length) {
    return <EmptyState title="The queue is clear." body="New booking requests will arrive here." />;
  }

  const run = async (g, action) => {
    setBusyKey(g.key);
    setError(null);
    try {
      if (action === "confirm") {
        for (const id of g.bookingIds) await venueConfirmBooking(venueToken, id);
      } else if (g.seriesId) {
        await cancelBookingSeries(g.seriesId, venueToken);
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
    <>
      {error && <div className="banner banner-warn" style={{ marginBottom: "var(--gap)" }}>{error}</div>}
      <div className="req-grid">
        {groups.map((g) => {
          const busy = busyKey === g.key;
          const first = g.starts[0];
          return (
            <div className="req-card" key={g.key}>
              <div className="req-top">
                <span className="req-label">
                  {g.seriesId ? `Weekly · ${g.bookingIds.length} wk${g.bookingIds.length === 1 ? "" : "s"}` : "One-off"}
                </span>
                <span className="req-pitch">
                  <Icon name="pitch" size={12} /> {(g.pitchName || "").replace(/ \(.*\)/, "")}
                </span>
              </div>
              <div className="req-booker">
                <div className="avatar">{getInitials(g.teamName)}</div>
                <div className="req-booker-text">
                  <div className="bname">{g.teamName}</div>
                </div>
              </div>
              <div className="req-when">
                <Icon name="clock" size={12} />
                <span>{first && <><strong>{fmtDayShort(first)}</strong> · {fmtTime(first)}</>}</span>
              </div>
              <div className="req-actions">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(g, "confirm")}>
                  {busy ? "…" : "Confirm"}
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={() => run(g, "decline")}>Decline</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
