import React, { useMemo } from "react";
import { minsOfDay, fmtTime, occClass, occLabel, occSub, occType, occIcon } from "../bookingUtil.js";
import Icon from "./Icon.jsx";

// Denser alternative to the time-aligned grid: each booked resource is a ROW, its bookings
// laid out left-to-right as time-ordered chips. Fits far more on screen for big venues and
// is the natural mobile layout. Only resources WITH bookings appear. Read-only (tap a chip →
// its detail). Same colour/label/type helpers as the grid so the two views read identically.
const TYPE_ORDER = ["pitch", "room", "trainer"];
const TYPE_LABEL = { pitch: "Pitches", room: "Rooms", trainer: "Trainers" };

export default function ResourceAgenda({ venues, dayOcc, activeTypes, onSelectBlock }) {
  const multiVenue = venues.length > 1;
  const venueName = useMemo(() => {
    const m = new Map();
    for (const v of venues) {
      for (const p of (v.pitches ?? [])) m.set(p.id, v.venue_name);
      for (const r of (v.rooms ?? [])) m.set(r.id, v.venue_name);
      for (const t of (v.trainers ?? [])) m.set(t.id, v.venue_name);
    }
    return m;
  }, [venues]);

  // One row per resource that has a booking, grouped by resource type.
  const rowsByType = useMemo(() => {
    const rows = new Map();
    for (const o of dayOcc) {
      if (!activeTypes.includes(o.resource_type)) continue;
      if (!rows.has(o.resource_id)) {
        rows.set(o.resource_id, { id: o.resource_id, name: o.resource_name, type: o.resource_type, items: [] });
      }
      rows.get(o.resource_id).items.push(o);
    }
    const out = {};
    for (const t of TYPE_ORDER) out[t] = [];
    for (const r of rows.values()) {
      r.items.sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start));
      (out[r.type] ??= []).push(r);
    }
    for (const t of TYPE_ORDER) out[t].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [dayOcc, activeTypes]);

  return (
    <div className="agenda-res">
      {TYPE_ORDER.filter((t) => activeTypes.includes(t) && rowsByType[t]?.length).map((t) => (
        <div className="agenda-res-band" key={t}>
          <div className="agenda-res-bandhead">{TYPE_LABEL[t]}</div>
          {rowsByType[t].map((row) => (
            <div className="agenda-res-row" key={row.id}>
              <div className="agenda-res-name">
                <span className="agenda-res-title">{row.name}</span>
                {multiVenue && venueName.get(row.id) && (
                  <span className="agenda-res-venue">{venueName.get(row.id)}</span>
                )}
              </div>
              <div className="agenda-res-chips">
                {row.items.map((o) => {
                  const glyph = occIcon(o);
                  const sub = occSub(o);
                  const type = occType(o);
                  return (
                    <button className={"agenda-chip " + occClass(o)} key={o.id} onClick={() => onSelectBlock?.(o)}>
                      <span className="agenda-chip-time">{fmtTime(o.start)}–{fmtTime(o.end)}</span>
                      <span className="agenda-chip-main">
                        {glyph && <span className="occ-glyph"><Icon name={glyph} size={11} /></span>}
                        <span className="agenda-chip-label">{occLabel(o)}</span>
                        {type && <span className="occ-type">{type}</span>}
                      </span>
                      {sub && <span className="agenda-chip-sub">{sub}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
