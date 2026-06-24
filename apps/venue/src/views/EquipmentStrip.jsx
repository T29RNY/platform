import React from "react";
import Icon from "./Icon.jsx";

// Equipment availability strip for the unified calendar. Equipment is quantity-over-time
// ("12 of 20 bibs out 18:00–20:00"), not a one-thing-per-slot lane — so it renders as a
// strip beneath the grid, driven by get_equipment_availability over the visible day.
export default function EquipmentStrip({ items = [], dayLabel, pinned = false }) {
  const cls = "eq-strip" + (pinned ? " eq-strip-pinned" : "");
  if (!items.length) {
    return (
      <div className={cls}>
        <span className="eq-strip-label"><Icon name="equipment" size={13} /> Equipment</span>
        <span className="text-mute">No equipment catalogued.</span>
      </div>
    );
  }
  const rows = items
    .map((e) => ({ ...e, out: Math.max((e.quantity ?? 0) - (e.free ?? 0), 0) }))
    .sort((a, b) => b.out - a.out || a.name.localeCompare(b.name));

  return (
    <div className={cls}>
      <span className="eq-strip-label"><Icon name="equipment" size={13} /> Equipment{dayLabel ? ` · ${dayLabel}` : ""}</span>
      <div className="eq-strip-items">
        {rows.map((e) => (
          <span key={e.id} className={"eq-item" + (e.out > 0 ? " is-out" : "")} title={`${e.free} of ${e.quantity} free`}>
            <strong>{e.name}</strong>
            <span className="eq-count">{e.out}/{e.quantity} out</span>
          </span>
        ))}
      </div>
    </div>
  );
}
