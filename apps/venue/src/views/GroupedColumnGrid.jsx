import React, { useRef, useEffect } from "react";
import { dayWindow, minsOfDay, hhmm, fmtTime, occClass, occLabel, occSub, occType, occIsFirst, occIsPending, occIcon, occInitials, occRankBadge, freeGaps, reservedBands } from "../bookingUtil.js";
import Icon from "./Icon.jsx";

const PXMIN = 1.0;          // pixels per minute (matches ScheduleGrid)
const SNAP = 30;            // tap-to-book snaps to 30-min

// Generic grouped-column calendar engine. Columns are organised under header bands
// (a band spans its columns via grid-column span — the .sg-venuehead pattern). Each
// band carries { key, label, ro, columns[] }; each column { id, name, bookable, selfSite }.
// Occupancy rows are keyed to a column by colIdOf(o). This one engine powers both the
// all-grounds pitch view (AllGroundsGrid) and the unified resource calendar
// (ResourceCalendar) — band = venue, or band = venue×resource-type.
export default function GroupedColumnGrid({
  date, bands, dayOcc, colIdOf, allColumns = [], bookingIns = {},
  windowOverride = null, freeMode = false, reservedById = null, nowMin = null, fixedHeight = false,
  onTapEmpty, blockClickable, onBlockClick,
}) {
  const { startMin, endMin } = windowOverride ?? dayWindow(allColumns, date, dayOcc);
  const height = (endMin - startMin) * PXMIN;

  // Fixed-height grids scroll vertically through the day; open at now (or the first
  // booking) rather than at the top so the relevant part of the day is in view.
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!fixedHeight || !scrollRef.current) return;
    const firstBlock = dayOcc.length ? Math.min(...dayOcc.map((o) => minsOfDay(o.start))) : null;
    const target = nowMin ?? firstBlock;
    if (target == null) return;
    scrollRef.current.scrollTop = Math.max(0, (target - startMin) * PXMIN - 64);
  }, [fixedHeight, nowMin, date, startMin, dayOcc]);

  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  // Flat column list (tagged with its band) + occupancy bucketed per column.
  const columns = [];
  for (const b of bands) for (const c of (b.columns ?? [])) columns.push({ col: c, band: b });
  const totalCols = columns.length;

  const byCol = new Map(columns.map(({ col }) => [col.id, []]));
  for (const o of dayOcc) {
    const id = colIdOf(o);
    if (byCol.has(id)) byCol.get(id).push(o);
  }

  const tapColumn = (col, e) => {
    if (!col.bookable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = startMin + Math.floor(y / PXMIN / SNAP) * SNAP;
    mins = Math.max(startMin, Math.min(mins, endMin - SNAP));
    onTapEmpty?.(col.id, hhmm(mins));
  };

  return (
    <div className={"sg-scroll" + (fixedHeight ? " sg-scroll-fixed" : "")} ref={scrollRef}>
      <div className="sg is-grouped" style={{ gridTemplateColumns: `52px repeat(${totalCols}, minmax(120px, 1fr))` }}>
        {/* group header row */}
        <div className="sg-corner sg-corner-venue" />
        {bands.map((b) => (
          <div className="sg-venuehead" key={b.key} style={{ gridColumn: `span ${(b.columns ?? []).length}` }}>
            <span className="sg-venuename">{b.label}</span>
            {b.ro && <span className="sg-venue-ro">View-only</span>}
          </div>
        ))}

        {/* column header row */}
        <div className="sg-corner sg-corner-pitch" />
        {columns.map(({ col }) => (
          <div className="sg-colhead" key={col.id}>{col.name}</div>
        ))}

        {/* axis */}
        <div className="sg-axis" style={{ height }}>
          {hours.map((m) => (
            <div className="sg-tick" key={m} style={{ top: (m - startMin) * PXMIN }}>
              <span>{hhmm(m)}</span>
            </div>
          ))}
        </div>

        {/* columns */}
        {columns.map(({ col }) => {
          const blocks = byCol.get(col.id) ?? [];
          return (
            <div
              className={"sg-col" + (col.bookable ? " is-bookable" : "")}
              key={col.id}
              style={{ height }}
              onClick={(e) => tapColumn(col, e)}
              title={col.bookable ? "Tap an empty slot to book" : undefined}
            >
              {hours.map((m) => (
                <div className="sg-hourline" key={m} style={{ top: (m - startMin) * PXMIN }} />
              ))}
              {nowMin != null && (
                <div className="sg-nowline" style={{ top: (nowMin - startMin) * PXMIN }} />
              )}
              {reservedById && reservedBands(reservedById.get(col.id), date).map((b, i) => (
                <div className={"sg-reserved sg-reserved-" + b.audience} key={"rsv" + i}
                  style={{ top: (b.startMin - startMin) * PXMIN, height: Math.max((b.endMin - b.startMin) * PXMIN, 14) }}
                  title={`Reserved — ${b.label}`}>
                  <span className="sg-reserved-tag">{b.label}</span>
                </div>
              ))}
              {freeMode && freeGaps(blocks, startMin, endMin).map(([s, e], i) => (
                <div className={"occ occ-free" + (col.bookable ? " occ-actionable" : "")} key={"free" + i}
                  style={{ top: (s - startMin) * PXMIN, height: Math.max((e - s) * PXMIN, 22) }}
                  onClick={(ev) => { ev.stopPropagation(); if (col.bookable) onTapEmpty?.(col.id, hhmm(s)); }}>
                  <span className="occ-label">Available</span>
                  <span className="occ-time">{hhmm(s)}–{hhmm(e)}</span>
                </div>
              ))}
              {!freeMode && blocks.map((o) => {
                const top = (minsOfDay(o.start) - startMin) * PXMIN;
                const h = Math.max((minsOfDay(o.end) - minsOfDay(o.start)) * PXMIN, 18);
                const clickable = !!onBlockClick && (!blockClickable || blockClickable(o, col));
                const ins = o.source_kind === "booking" ? bookingIns[o.source_id] : null;
                const type = occType(o);
                const glyph = occIcon(o);
                const initials = occInitials(o);
                const rank = occRankBadge(o);
                const sub = occSub(o);
                return (
                  <div
                    key={o.id}
                    className={"occ " + occClass(o) + (clickable ? " occ-actionable" : "")}
                    style={{ top, height: h }}
                    onClick={(e) => { e.stopPropagation(); if (clickable) onBlockClick(o, col); }}
                  >
                    <div className="occ-top">
                      {glyph && <span className="occ-glyph"><Icon name={glyph} size={12} /></span>}
                      {rank && <span className="occ-rank" title="Team priority">{rank}</span>}
                      {occIsPending(o) && <span className="occ-req-tag">Request</span>}
                      <span className="occ-label">{occLabel(o)}</span>
                      {occIsFirst(o) && <span className="occ-new">NEW</span>}
                      {type && <span className="occ-type">{type}</span>}
                    </div>
                    {sub && <span className="occ-sub">{sub}</span>}
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
