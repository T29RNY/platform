import React from "react";
import Modal from "./Modal.jsx";
import { fmtTime, fmtDayShort, occLabel, occType } from "../bookingUtil.js";

const TYPE_LABEL = { pitch: "Pitch", room: "Room", trainer: "Trainer" };

// Read-only detail for any block on the unified resource calendar (Phase 1). Booking/
// managing each resource stays on its own surface (Bookings, Room hire, Classes, PT) —
// this is an overview pop. Acting on a block from the calendar arrives in Phase 2.
export default function ResourceBlockModal({ open, occ, onClose }) {
  if (!open || !occ) return null;
  const d = occ.detail ?? {};
  const type = occType(occ);

  const rows = [
    [TYPE_LABEL[occ.resource_type] || "Resource", occ.resource_name],
    ["When", `${fmtDayShort(occ.start)} · ${fmtTime(occ.start)}–${fmtTime(occ.end)}`],
    type ? ["Type", type] : null,
  ];

  if (occ.source_kind === "room_hire") {
    if (d.booker) rows.push(["Booker", d.booker]);
    if (d.purpose) rows.push(["Purpose", d.purpose]);
    if (d.attendee_count) rows.push(["Attendees", String(d.attendee_count)]);
  } else if (occ.source_kind === "class") {
    if (d.class_name) rows.push(["Class", d.class_name]);
    if (d.instructor) rows.push(["Instructor", d.instructor]);
    if (d.capacity) rows.push(["Capacity", String(d.capacity)]);
  } else if (occ.source_kind === "appointment") {
    // (the resource row above already names the trainer)
    if (d.member_name) rows.push(["Member", d.member_name]);
  }
  if (d.status) rows.push(["Status", d.status]);

  return (
    <Modal open={open} onClose={onClose} title={occLabel(occ)}>
      <div className="bk-detail">
        {rows.filter(Boolean).map(([k, v], i) => (
          <div className="bk-detail-row" key={`${k}-${i}`}>
            <span className="text-mute">{k}</span>
            <strong style={k === "Status" ? { textTransform: "capitalize" } : undefined}>{v}</strong>
          </div>
        ))}
      </div>
      <p className="text-mute" style={{ fontSize: "0.8rem", marginTop: "var(--gap-2)" }}>
        Read-only overview. Manage this on its own screen — booking from the calendar is coming soon.
      </p>
    </Modal>
  );
}
