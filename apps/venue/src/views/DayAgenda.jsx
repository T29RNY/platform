import React from "react";
import { dayWindow, minsOfDay, hhmm, fmtTime, occClass, occLabel, occType, occIcon, occInitials, occRankBadge, freeGaps } from "../bookingUtil.js";
import Icon from "./Icon.jsx";

const PXMIN = 0.9;
const SNAP = 30;

export default function DayAgenda({ date, pitches, pitchId, onPitchChange, dayOcc, bookingIns = {}, canBook, windowOverride = null, freeMode = false, onTapEmpty, onSelectBooking }) {
  const pitch = pitches.find((p) => p.id === pitchId) ?? pitches[0];
  const { startMin, endMin } = windowOverride ?? dayWindow(pitches, date, dayOcc);
  const height = (endMin - startMin) * PXMIN;
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  const blocks = dayOcc.filter((o) => o.playing_area_id === pitch?.id);
  const gaps = freeMode ? freeGaps(blocks, startMin, endMin) : [];

  const tap = (e) => {
    if (!canBook) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = startMin + Math.floor(y / PXMIN / SNAP) * SNAP;
    mins = Math.max(startMin, Math.min(mins, endMin - SNAP));
    onTapEmpty(pitch.id, hhmm(mins));
  };

  return (
    <div className="da">
      <div className="agenda-pitches">
        {pitches.map((p) => (
          <button
            key={p.id}
            className={"btn btn-xs" + (p.id === pitch?.id ? " btn-primary" : "")}
            onClick={() => onPitchChange(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="da-timeline" style={{ display: "grid", gridTemplateColumns: "52px 1fr" }}>
        <div className="sg-axis" style={{ height }}>
          {hours.map((m) => (
            <div className="sg-tick" key={m} style={{ top: (m - startMin) * PXMIN }}>
              <span>{hhmm(m)}</span>
            </div>
          ))}
        </div>
        <div
          className={"sg-col" + (canBook ? " is-bookable" : "")}
          style={{ height }}
          onClick={tap}
        >
          {hours.map((m) => (
            <div className="sg-hourline" key={m} style={{ top: (m - startMin) * PXMIN }} />
          ))}
          {freeMode && gaps.map(([s, e], i) => (
            <div className="occ occ-free occ-actionable" key={"free" + i}
              style={{ top: (s - startMin) * PXMIN, height: Math.max((e - s) * PXMIN, 22) }}
              onClick={(ev) => { ev.stopPropagation(); if (canBook) onTapEmpty?.(pitch.id, hhmm(s)); }}>
              <span className="occ-label">Available</span>
              <span className="occ-time">{hhmm(s)}–{hhmm(e)}</span>
            </div>
          ))}
          {!freeMode && blocks.map((o) => {
            const top = (minsOfDay(o.start) - startMin) * PXMIN;
            const h = Math.max((minsOfDay(o.end) - minsOfDay(o.start)) * PXMIN, 22);
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
                  {type && <span className="occ-type">{type}</span>}
                </div>
                <span className="occ-time">{fmtTime(o.start)}–{fmtTime(o.end)}</span>
                {ins && <span className="occ-ins">{ins.in_count}{ins.target ? `/${ins.target}` : ""} in</span>}
                {initials && <span className="occ-mgr">{initials}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {canBook && pitch && (
        <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={() => onTapEmpty(pitch.id, "")}>
          + Add walk-in booking
        </button>
      )}
    </div>
  );
}
