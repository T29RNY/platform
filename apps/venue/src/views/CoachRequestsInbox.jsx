import React, { useState } from "react";
import { venueApproveCoachRequest, venueDeclineCoachRequest } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { getInitials } from "../lib/format.js";
import { fmtTime, fmtDayShort } from "../bookingUtil.js";

// Coach pitch REQUESTS inbox (PR #5) — a club coach booked a pitch as a club_session and
// hit a non-bumpable clash, so it's held as pitch_status='requested' (holds no occupancy,
// so it never shows on the grid). The owner Approves (re-run the reserve) or Declines.
// A separate lane from the external-booking RequestsInbox because the data + writes differ.
export default function CoachRequestsInbox({ requests, venueToken, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  if (!requests.length) return null;

  const run = async (r, action) => {
    setBusyId(r.session_id);
    setError(null);
    try {
      if (action === "approve") {
        const res = await venueApproveCoachRequest(venueToken, r.session_id);
        // Approve never auto-evicts a paying hire — a still-clashing slot stays 'requested'.
        if (res && res.ok === false) {
          setError("That slot's still taken by another booking — clear it first, or decline the request.");
          setBusyId(null);
          return;
        }
      } else {
        await venueDeclineCoachRequest(venueToken, r.session_id);
      }
      onChanged?.();
    } catch {
      setError("Couldn't update the request — try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {error && <div className="banner banner-warn" style={{ marginBottom: "var(--gap)" }}>{error}</div>}
      <div className="req-grid">
        {requests.map((r) => {
          const busy = busyId === r.session_id;
          return (
            <div className="req-card" key={r.session_id}>
              <div className="req-top">
                <span className="req-label">Coach request</span>
                {r.pitch_name && (
                  <span className="req-pitch">
                    <Icon name="pitch" size={12} /> {r.pitch_name.replace(/ \(.*\)/, "")}
                  </span>
                )}
              </div>
              <div className="req-booker">
                <div className="avatar">{getInitials(r.team_name)}</div>
                <div className="req-booker-text">
                  <div className="bname">{r.team_name || r.title}</div>
                  {r.club_name && <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{r.club_name}</div>}
                </div>
              </div>
              <div className="req-when">
                <Icon name="clock" size={12} />
                <span>{r.scheduled_at && <><strong>{fmtDayShort(r.scheduled_at)}</strong> · {fmtTime(r.scheduled_at)}</>}</span>
              </div>
              <div className="req-actions">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(r, "approve")}>
                  {busy ? "…" : "Approve"}
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={() => run(r, "decline")}>Decline</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
