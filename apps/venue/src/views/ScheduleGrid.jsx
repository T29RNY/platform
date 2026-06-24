import React from "react";
import { dayWindow, minsOfDay, hhmm, fmtTime, occClass, occLabel, occType, occIsFirst, occIcon, occInitials, occRankBadge, freeGaps, reservedBands } from "../bookingUtil.js";
import Icon from "./Icon.jsx";

const PXMIN = 1.0;          // pixels per minute (60px/hr — fits name + time + ins in a 60-min block)
const SNAP = 30;            // tap-to-book snaps to 30-min

export default function ScheduleGrid({ date, pitches, dayOcc, bookingIns = {}, canBook, windowOverride = null, freeMode = false, reservedByPitch = null, onTapEmpty, onSelectBooking }) {
  const { startMin, endMin } = windowOverride ?? dayWindow(pitches, date, dayOcc);
  const height = (endMin - startMin) * PXMIN;

  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  const byPitch = new Map(pitches.map((p) => [p.id, []]));
  for (const o of dayOcc) {
    if (byPitch.has(o.playing_area_id)) byPitch.get(o.playing_area_id).push(o);
  }

  const tapColumn = (pitchId, e) => {
    if (!canBook) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = startMin + Math.floor(y / PXMIN / SNAP) * SNAP;
    mins = Math.max(startMin, Math.min(mins, endMin - SNAP));
    onTapEmpty(pitchId, hhmm(mins));
  };

  return (
    <div className="sg-scroll">
      <div className="sg" style={{ gridTemplateColumns: `52px repeat(${pitches.length}, minmax(120px, 1fr))` }}>
        {/* header row */}
        <div className="sg-corner" />
        {pitches.map((p) => (
          <div className="sg-colhead" key={p.id}>{p.name}</div>
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
        {pitches.map((p) => (
          <div
            className={"sg-col" + (canBook ? " is-bookable" : "")}
            key={p.id}
            style={{ height }}
            onClick={(e) => tapColumn(p.id, e)}
            title={canBook ? "Tap an empty slot to book" : undefined}
          >
            {hours.map((m) => (
              <div className="sg-hourline" key={m} style={{ top: (m - startMin) * PXMIN }} />
            ))}
            {reservedByPitch && reservedBands(reservedByPitch.get(p.id), date).map((b, i) => (
              <div className={"sg-reserved sg-reserved-" + b.audience} key={"rsv" + i}
                style={{ top: (b.startMin - startMin) * PXMIN, height: Math.max((b.endMin - b.startMin) * PXMIN, 14) }}
                title={`Reserved — ${b.label}`}>
                <span className="sg-reserved-tag">{b.label}</span>
              </div>
            ))}
            {freeMode && freeGaps(byPitch.get(p.id) ?? [], startMin, endMin).map(([s, e], i) => (
              <div className="occ occ-free occ-actionable" key={"free" + i}
                style={{ top: (s - startMin) * PXMIN, height: Math.max((e - s) * PXMIN, 22) }}
                onClick={(ev) => { ev.stopPropagation(); if (canBook) onTapEmpty?.(p.id, hhmm(s)); }}>
                <span className="occ-label">Available</span>
                <span className="occ-time">{hhmm(s)}–{hhmm(e)}</span>
              </div>
            ))}
            {!freeMode && (byPitch.get(p.id) ?? []).map((o) => {
              const top = (minsOfDay(o.start) - startMin) * PXMIN;
              const h = Math.max((minsOfDay(o.end) - minsOfDay(o.start)) * PXMIN, 18);
              const isBooking = o.source_kind === "booking";
              const ins = isBooking ? bookingIns[o.source_id] : null;
              const type = occType(o);
              const glyph = occIcon(o);
              const initials = occInitials(o);
              const rank = occRankBadge(o);
              return (
                <div
                  key={o.id}
                  className={"occ " + occClass(o) + (isBooking ? " occ-actionable" : "")}
                  style={{ top, height: h }}
                  onClick={(e) => { e.stopPropagation(); if (isBooking) onSelectBooking?.(o); }}
                >
                  <div className="occ-top">
                    {glyph && <span className="occ-glyph"><Icon name={glyph} size={12} /></span>}
                    {rank && <span className="occ-rank" title="Team priority">{rank}</span>}
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
        ))}
      </div>
    </div>
  );
}
