import React, { useState } from "react";
import { venueResolveBump } from "@platform/core";
import { fmtDayShort, fmtTime } from "../bookingUtil.js";
import Icon from "./Icon.jsx";

// Pitch priority Phase 3 — operator-facing list of pending bump proposals. When a higher-
// ranked club team takes a contested slot the bumped team's event goes tentative and the
// system suggests the closest free alternative. The operator can Accept (move the event onto
// the suggested slot) or Decline (leave it tentative for the manager to sort) on the team's
// behalf. Reads come from venue_list_bump_proposals; actions go via venue_resolve_bump.
function slotLabel(p) {
  if (!p.suggested_start) return null;
  const where = [p.suggested_pitch_name, p.suggested_venue_name].filter(Boolean).join(" · ");
  return `${where ? where + " · " : ""}${fmtDayShort(p.suggested_start)} ${fmtTime(p.suggested_start)}`;
}

function ProposalRow({ venueToken, p, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const suggestion = slotLabel(p);

  const run = async (action) => {
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await venueResolveBump(venueToken, p.id, action);
      if (res?.retry) {
        setNote("That slot was just taken — we've found another. Review and Accept again.");
        onResolved?.({ soft: true });   // refetch list (suggestion updated) but keep the row
        return;
      }
      onResolved?.();                    // proposal resolved — refetch + drop the row
    } catch (e) {
      console.error("[venue] resolve_bump failed", e);
      setError("Couldn't update — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bump-row">
      <div className="bump-row-body">
        <strong>{p.club_team_name || "A team"}</strong>
        <span className="text-mute">
          {" "}was bumped from {p.original_start ? `${fmtDayShort(p.original_start)} ${fmtTime(p.original_start)}` : "its slot"}.
        </span>
        {suggestion
          ? <div className="bump-sugg">Closest free: <strong>{suggestion}</strong></div>
          : <div className="bump-sugg bump-sugg-none">No automatic alternative found — needs a manual re-book.</div>}
        {note && <div className="bump-note">{note}</div>}
        {error && <div className="bump-note bump-note-err">{error}</div>}
      </div>
      <div className="bump-row-actions">
        <button className="btn btn-sm btn-primary" disabled={busy || !p.suggested_start}
          onClick={() => run("accept")}>{busy ? "…" : "Accept"}</button>
        <button className="btn btn-sm btn-ghost" disabled={busy}
          onClick={() => run("decline")}>Decline</button>
      </div>
    </div>
  );
}

export default function BumpProposalsBanner({ venueToken, proposals = [], onResolved }) {
  if (!proposals.length) return null;
  return (
    <div className="banner banner-warn bump-banner">
      <div className="bump-banner-head">
        <Icon name="whistle" size={16} />
        <strong>Pitch changes need attention</strong>
        <span className="text-mute">{proposals.length} team{proposals.length !== 1 ? "s" : ""} bumped to a higher-priority booking</span>
      </div>
      <div className="bump-list">
        {proposals.map((p) => (
          <ProposalRow key={p.id} venueToken={venueToken} p={p} onResolved={onResolved} />
        ))}
      </div>
    </div>
  );
}
