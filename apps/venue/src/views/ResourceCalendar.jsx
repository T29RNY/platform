import React, { useMemo } from "react";
import GroupedColumnGrid from "./GroupedColumnGrid.jsx";
import { BOOKABLE_RESOURCE_TYPES } from "../bookingUtil.js";

// The unified resource calendar: pitches + rooms + trainers laid out on ONE grid, grouped
// by venue × resource-type, across EVERY venue the operator runs. Runs on the shared
// GroupedColumnGrid engine. Tapping a block opens its read-only detail; tapping an empty
// slot on the operator's OWN-site bookable lanes (pitch/room) starts a booking via onBook —
// other sites and trainer lanes stay read-only. Equipment is a quantity strip rendered
// separately by the parent, not a lane here.
const TYPE_ORDER = ["pitch", "room", "trainer"];
const TYPE_LABEL = { pitch: "Pitches", room: "Rooms", trainer: "Trainers" };

export default function ResourceCalendar({ date, venues, dayOcc, activeTypes, windowOverride = null, nowMin = null, fixedHeight = false, onSelectBlock, onBook }) {
  const multiVenue = venues.length > 1;

  const { bands, typeById } = useMemo(() => {
    const out = [];
    const tById = new Map();
    for (const v of venues) {
      const cols = { pitch: v.pitches ?? [], room: v.rooms ?? [], trainer: v.trainers ?? [] };
      for (const t of TYPE_ORDER) {
        if (!activeTypes.includes(t)) continue;
        const columns = cols[t];
        if (!columns.length) continue;
        const bookable = !!v.is_self && BOOKABLE_RESOURCE_TYPES.has(t);
        for (const c of columns) tById.set(c.id, t);
        out.push({
          key: `${v.venue_id}:${t}`,
          label: multiVenue ? `${v.venue_name} · ${TYPE_LABEL[t]}` : TYPE_LABEL[t],
          ro: false,
          columns: columns.map((c) => ({ id: c.id, name: c.name, bookable })),
        });
      }
    }
    return { bands: out, typeById: tById };
  }, [venues, activeTypes, multiVenue]);

  if (!bands.length) return null;

  return (
    <GroupedColumnGrid
      date={date}
      bands={bands}
      dayOcc={dayOcc}
      colIdOf={(o) => o.resource_id}
      allColumns={[]}
      windowOverride={windowOverride}
      nowMin={nowMin}
      fixedHeight={fixedHeight}
      blockClickable={() => true}
      onBlockClick={(o) => onSelectBlock?.(o)}
      onTapEmpty={(colId, hhmm) => onBook?.(typeById.get(colId), colId, hhmm)}
    />
  );
}
