import React from "react";
import { dayWindow, minsOfDay, hhmm, fmtTime, occClass, occLabel, occType, occIsFirst, occIcon, occInitials, freeGaps, reservedBands } from "../bookingUtil.js";
import Icon from "./Icon.jsx";

const PXMIN = 1.0;          // pixels per minute (matches ScheduleGrid)
const SNAP = 30;            // tap-to-book snaps to 30-min

// One grid spanning EVERY venue this operator runs, grouped by venue: a venue
// header band, then that venue's pitch columns. The home (is_self) venue's columns
// are tappable to book; other sites are view-only — booking happens from their own
// console, so an empty-slot tap there is a no-op and their blocks aren't actionable.
// Block visuals reuse the exact ScheduleGrid rendering + bookingUtil helpers.
export default function AllGroundsGrid({ date, venues, dayOcc, bookingIns = {}, canBookSelf = false, windowOverride = null, freeMode = false, reservedByPitch = null, onTapEmpty, onSelectBooking }) {
  const allPitches = venues.flatMap((v) => v.pitches ?? []);
  const { startMin, endMin } = windowOverride ?? dayWindow(allPitches, date, dayOcc);
  const height = (endMin - startMin) * PXMIN;

  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  const byPitch = new Map(allPitches.map((p) => [p.id, []]));
  for (const o of dayOcc) {
    if (byPitch.has(o.playing_area_id)) byPitch.get(o.playing_area_id).push(o);
  }

  // Flat column list, each tagged with its owning venue, so a venue header can span
  // its pitches and each column knows whether it's bookable.
  const columns = [];
  for (const v of venues) for (const p of (v.pitches ?? [])) columns.push({ pitch: p, venue: v });
  const totalCols = columns.length;

  const tapColumn = (col, e) => {
    if (!(col.venue.is_self && canBookSelf)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = startMin + Math.floor(y / PXMIN / SNAP) * SNAP;
    mins = Math.max(startMin, Math.min(mins, endMin - SNAP));
    onTapEmpty(col.pitch.id, hhmm(mins));
  };

  return (
    <div className="sg-scroll">
      <div className="sg is-grouped" style={{ gridTemplateColumns: `52px repeat(${totalCols}, minmax(120px, 1fr))` }}>
        {/* venue group header row */}
        <div className="sg-corner sg-corner-venue" />
        {venues.map((v) => (
          <div className="sg-venuehead" key={v.venue_id} style={{ gridColumn: `span ${(v.pitches ?? []).length}` }}>
            <span className="sg-venuename">{v.venue_name}</span>
            {!v.is_self && <span className="sg-venue-ro">View-only</span>}
          </div>
        ))}

        {/* pitch header row */}
        <div className="sg-corner sg-corner-pitch" />
        {columns.map(({ pitch }) => (
          <div className="sg-colhead" key={pitch.id}>{pitch.name}</div>
        ))}

        {/* axis */}
        <div className="sg-axis" style={{ height }}>
          {hours.map((m) => (
            <div className="sg-tick" key={m} style={{ top: (m - startMin) * PXMIN }}>
              <span>{hhmm(m)}</span>
            </div>
          ))}
        </div>

        {/* pitch columns */}
        {columns.map((col) => {
          const { pitch, venue } = col;
          const bookable = venue.is_self && canBookSelf;
          const blocks = byPitch.get(pitch.id) ?? [];
          return (
            <div
              className={"sg-col" + (bookable ? " is-bookable" : "")}
              key={pitch.id}
              style={{ height }}
              onClick={(e) => tapColumn(col, e)}
              title={bookable ? "Tap an empty slot to book" : undefined}
            >
              {hours.map((m) => (
                <div className="sg-hourline" key={m} style={{ top: (m - startMin) * PXMIN }} />
              ))}
              {reservedByPitch && reservedBands(reservedByPitch.get(pitch.id), date).map((b, i) => (
                <div className={"sg-reserved sg-reserved-" + b.audience} key={"rsv" + i}
                  style={{ top: (b.startMin - startMin) * PXMIN, height: Math.max((b.endMin - b.startMin) * PXMIN, 14) }}
                  title={`Reserved — ${b.label}`}>
                  <span className="sg-reserved-tag">{b.label}</span>
                </div>
              ))}
              {freeMode && freeGaps(blocks, startMin, endMin).map(([s, e], i) => (
                <div className={"occ occ-free" + (bookable ? " occ-actionable" : "")} key={"free" + i}
                  style={{ top: (s - startMin) * PXMIN, height: Math.max((e - s) * PXMIN, 22) }}
                  onClick={(ev) => { ev.stopPropagation(); if (bookable) onTapEmpty?.(pitch.id, hhmm(s)); }}>
                  <span className="occ-label">Available</span>
                  <span className="occ-time">{hhmm(s)}–{hhmm(e)}</span>
                </div>
              ))}
              {!freeMode && blocks.map((o) => {
                const top = (minsOfDay(o.start) - startMin) * PXMIN;
                const h = Math.max((minsOfDay(o.end) - minsOfDay(o.start)) * PXMIN, 18);
                const isBooking = o.source_kind === "booking";
                const clickable = isBooking && venue.is_self;   // foreign bookings stay view-only
                const ins = isBooking ? bookingIns[o.source_id] : null;
                const type = occType(o);
                const glyph = occIcon(o);
                const initials = occInitials(o);
                return (
                  <div
                    key={o.id}
                    className={"occ " + occClass(o) + (clickable ? " occ-actionable" : "")}
                    style={{ top, height: h }}
                    onClick={(e) => { e.stopPropagation(); if (clickable) onSelectBooking?.(o); }}
                  >
                    <div className="occ-top">
                      {glyph && <span className="occ-glyph"><Icon name={glyph} size={12} /></span>}
                      <span className="occ-label">{occLabel(o)}</span>
                      {occIsFirst(o) && <span className="occ-new">NEW</span>}
                      {type && <span className="occ-type">{type}</span>}
                    </div>
                    <span className="occ-time">{fmtTime(o.start)}–{fmtTime(o.end)}</span>
                    {ins && <span className="occ-ins">{ins.in_count}{ins.target ? `/${ins.target}` : ""} in</span>}
                    {initials && <span className="occ-mgr">{initials}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
