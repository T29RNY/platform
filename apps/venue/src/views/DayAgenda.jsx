import React from "react";
import { dayWindow, minsOfDay, hhmm, fmtTime, occClass, occLabel } from "../bookingUtil.js";

const PXMIN = 0.9;
const SNAP = 30;

export default function DayAgenda({ date, pitches, pitchId, onPitchChange, dayOcc, canBook, onTapEmpty }) {
  const pitch = pitches.find((p) => p.id === pitchId) ?? pitches[0];
  const { startMin, endMin } = dayWindow(pitches, date, dayOcc);
  const height = (endMin - startMin) * PXMIN;
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  const blocks = dayOcc.filter((o) => o.playing_area_id === pitch?.id);

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
      <div className="da-switch">
        {pitches.map((p) => (
          <button
            key={p.id}
            className={"da-pitch" + (p.id === pitch?.id ? " is-active" : "")}
            onClick={() => onPitchChange(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="da-timeline" style={{ gridTemplateColumns: "52px 1fr" }}>
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
          {blocks.map((o) => {
            const top = (minsOfDay(o.start) - startMin) * PXMIN;
            const h = Math.max((minsOfDay(o.end) - minsOfDay(o.start)) * PXMIN, 22);
            return (
              <div
                key={o.id}
                className={"occ " + occClass(o)}
                style={{ top, height: h }}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="occ-label">{occLabel(o)}</span>
                <span className="occ-time">{fmtTime(o.start)}–{fmtTime(o.end)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {canBook && pitch && (
        <button className="btn-accent da-fab" onClick={() => onTapEmpty(pitch.id, "")} aria-label="Add walk-in booking">
          +
        </button>
      )}
    </div>
  );
}
