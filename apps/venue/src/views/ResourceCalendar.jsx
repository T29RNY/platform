import React, { useMemo } from "react";
import GroupedColumnGrid from "./GroupedColumnGrid.jsx";

// The unified resource calendar (Phase 1, read-only): pitches + rooms + trainers laid out
// on ONE grid, grouped by venue × resource-type, across EVERY venue the operator runs.
// Runs on the shared GroupedColumnGrid engine. Read-only — tapping a block opens its
// read-only detail; empty slots are inert (book-from-calendar is Phase 2). Equipment is a
// quantity strip rendered separately by the parent, not a lane here.
const TYPE_ORDER = ["pitch", "room", "trainer"];
const TYPE_LABEL = { pitch: "Pitches", room: "Rooms", trainer: "Trainers" };

export default function ResourceCalendar({ date, venues, dayOcc, activeTypes, windowOverride = null, nowMin = null, fixedHeight = false, onSelectBlock }) {
  const multiVenue = venues.length > 1;

  const bands = useMemo(() => {
    const out = [];
    for (const v of venues) {
      const cols = { pitch: v.pitches ?? [], room: v.rooms ?? [], trainer: v.trainers ?? [] };
      for (const t of TYPE_ORDER) {
        if (!activeTypes.includes(t)) continue;
        const columns = cols[t];
        if (!columns.length) continue;
        out.push({
          key: `${v.venue_id}:${t}`,
          label: multiVenue ? `${v.venue_name} · ${TYPE_LABEL[t]}` : TYPE_LABEL[t],
          ro: false,
          columns: columns.map((c) => ({ id: c.id, name: c.name, bookable: false })),
        });
      }
    }
    return out;
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
    />
  );
}
