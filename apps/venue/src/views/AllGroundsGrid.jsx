import React from "react";
import GroupedColumnGrid from "./GroupedColumnGrid.jsx";

// One grid spanning EVERY venue this operator runs, grouped by venue: a venue
// header band, then that venue's pitch columns. The home (is_self) venue's columns
// are tappable to book; other sites are view-only — booking happens from their own
// console, so an empty-slot tap there is a no-op and their blocks aren't actionable.
// Thin adapter: maps venues → bands and renders the shared GroupedColumnGrid engine
// (same engine the unified ResourceCalendar uses). Behaviour preserved exactly.
export default function AllGroundsGrid({ date, venues, dayOcc, bookingIns = {}, canBookSelf = false, windowOverride = null, freeMode = false, reservedByPitch = null, onTapEmpty, onSelectBooking }) {
  const bands = venues.map((v) => ({
    key: v.venue_id,
    label: v.venue_name,
    ro: !v.is_self,
    columns: (v.pitches ?? []).map((p) => ({
      id: p.id, name: p.name,
      bookable: v.is_self && canBookSelf,   // tap-empty-to-book: home site only
      selfSite: v.is_self,                  // booking blocks open detail on the home site
    })),
  }));
  const allColumns = venues.flatMap((v) => v.pitches ?? []);

  return (
    <GroupedColumnGrid
      date={date}
      bands={bands}
      dayOcc={dayOcc}
      colIdOf={(o) => o.playing_area_id}
      allColumns={allColumns}
      bookingIns={bookingIns}
      windowOverride={windowOverride}
      freeMode={freeMode}
      reservedById={reservedByPitch}
      onTapEmpty={onTapEmpty}
      blockClickable={(o, col) => o.source_kind === "booking" && col.selfSite}
      onBlockClick={(o) => onSelectBooking?.(o)}
    />
  );
}
