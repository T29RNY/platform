// bookingCalendar.jsx — the shared vertical time-grid calendar, extracted from
// OperatorBookings so the operator (venue hire) and manager (team booking) surfaces
// render the SAME day-view (operator ask: reuse the calendar, don't duplicate it).
//
// Pure geometry only. Callers compute their own blocks + free gaps (via layout()/
// freeGaps() below) and pass a renderBlockInner(block) for the block's inner content —
// positioning, hour lines, free-slot buttons and the now-line are shared here.

import MIcon from "./icons.jsx";

export const LONDON = "Europe/London";
export const PXH = 62;                       // pixels per hour on the grid
export const DAY_START = 8, DAY_END = 22;    // default bookable window (expands to fit blocks)

export function dayKey(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function hm(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
export function fmtHm(frac) {
  const h = Math.floor(frac), m = Math.round((frac - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function londonHM(d) {
  if (!d) return null;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  let h = +p.find((x) => x.type === "hour").value;
  const m = +p.find((x) => x.type === "minute").value;
  if (h === 24) h = 0;
  return h + m / 60;
}

// Convert a Europe/London WALL-CLOCK (dayKey 'YYYY-MM-DD' + 'HH:MM') into a correct UTC
// instant ISO string. The DB stores timestamptz and the PostgREST session runs in UTC, so
// a naive local string (…T17:00:00, no offset) is read as 17:00 UTC and then rendered back
// in London — drifting by the BST offset (+1h in summer). Anchor the picked wall-time to
// London before sending. (One-pass offset correction; a DST-transition hour is negligible
// for pitch bookings.) Use this for every single-instant scheduled_at we POST.
export function londonInstantISO(dayKeyStr, hhmm) {
  const [y, mo, d] = String(dayKeyStr).split("-").map(Number);
  const [h, mi] = String(hhmm).split(":").map(Number);
  const guess = Date.UTC(y, (mo || 1) - 1, d, h || 0, mi || 0, 0);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const p = {}; parts.forEach((x) => { p[x.type] = x.value; });
  let ph = +p.hour; if (ph === 24) ph = 0;
  const asLondon = Date.UTC(+p.year, +p.month - 1, +p.day, ph, +p.minute, 0);
  const offMin = Math.round((asLondon - guess) / 60000);
  return new Date(guess - offMin * 60000).toISOString();
}

// Column-squash overlapping blocks (port of the prototype combineEvents()).
// Each item must carry _start/_end Dates; returns items with _s/_e/_col/_cols set.
export function layout(items) {
  const evs = items
    .map((o) => ({ ...o, _s: londonHM(o._start), _e: londonHM(o._end) }))
    .filter((o) => o._s != null && o._e != null && o._e > o._s)
    .sort((a, b) => a._s - b._s || a._e - b._e);
  let cluster = [], clusterEnd = 0;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    cluster.forEach((ev) => {
      let c = 0;
      while (c < colEnds.length && colEnds[c] > ev._s + 0.001) c++;
      ev._col = c; colEnds[c] = ev._e;
    });
    const n = colEnds.length;
    cluster.forEach((ev) => (ev._cols = n));
    cluster = [];
  };
  evs.forEach((ev) => {
    if (cluster.length && ev._s >= clusterEnd - 0.001) flush();
    cluster.push(ev);
    clusterEnd = cluster.length === 1 ? ev._e : Math.max(clusterEnd, ev._e);
  });
  flush();
  return evs;
}

// Free windows (any pitch free) across the bookable day — drives free slots + start times.
export function freeGaps(pitchBlocks, startH, endH) {
  const busy = pitchBlocks
    .map((b) => ({ s: londonHM(b._start), e: londonHM(b._end) }))
    .filter((b) => b.s != null && b.e != null).sort((a, b) => a.s - b.s);
  const out = []; let c = startH;
  for (const b of busy) { if (b.s - c > 0.34) out.push({ from: c, to: b.s }); c = Math.max(c, b.e); }
  if (endH - c > 0.34) out.push({ from: c, to: endH });
  return out;
}

// Vertical window: bookable day, expanded to fit any out-of-hours blocks.
export function gridWindow(laid) {
  let startH = DAY_START, endH = DAY_END;
  if (laid.length) {
    startH = Math.min(DAY_START, Math.floor(Math.min(...laid.map((e) => e._s))));
    endH = Math.max(DAY_END, Math.ceil(Math.max(...laid.map((e) => e._e))));
  }
  return { startH: Math.max(0, startH), endH: Math.min(24, endH) };
}

// The shared scrollable time-grid. Callers wrap it with their own card/header.
export default function BookingDayGrid({
  startH, endH, gaps = [], laid = [], showNow = false, nowHM = 0,
  onSlotTap, onBlockTap, renderBlockInner,
}) {
  const gridH = (endH - startH) * PXH;
  const hours = []; for (let h = startH; h <= endH; h++) hours.push(h);
  return (
    <div style={{ maxHeight: 440, overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "relative", height: gridH }}>
        {hours.map((h) => (
          <div key={h}>
            <div style={{ position: "absolute", left: 46, right: 0, top: (h - startH) * PXH, borderTop: "1px dashed var(--hair)" }} />
            <div style={{ position: "absolute", left: 0, width: 38, textAlign: "right", top: (h - startH) * PXH, transform: "translateY(-7px)", fontSize: 10.5, fontWeight: 700, color: "var(--ink4)", fontVariantNumeric: "tabular-nums" }}>{String(h).padStart(2, "0")}:00</div>
          </div>
        ))}

        {/* free slots */}
        {gaps.map((g, i) => {
          const h = (g.to - g.from) * PXH;
          return (
            <button key={"f" + i} onClick={() => onSlotTap?.(g.from)} style={{
              position: "absolute", left: 52, right: 2, top: (g.from - startH) * PXH + 3, height: h - 6, borderRadius: 11, cursor: "pointer",
              border: "1.4px dashed var(--hair2)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 13px",
              fontFamily: "var(--m-font)",
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink3)" }}>{h > 42 ? "Free" : ""}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 600, color: "var(--ink4)", fontVariantNumeric: "tabular-nums" }}>
                {fmtHm(g.from)}–{fmtHm(g.to)}
                <span style={{ width: 22, height: 22, borderRadius: 7, background: "var(--ok-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><MIcon name="plus" size={14} color="var(--ok-ink)" /></span>
              </span>
            </button>
          );
        })}

        {showNow && (
          <div style={{ position: "absolute", left: 46, right: 0, top: (nowHM - startH) * PXH, height: 2, background: "var(--live)", zIndex: 6, boxShadow: "0 0 8px var(--live)" }}>
            <span style={{ position: "absolute", left: -4, top: -3, width: 8, height: 8, borderRadius: "50%", background: "var(--live)" }} />
          </div>
        )}

        {/* blocks */}
        <div style={{ position: "absolute", left: 52, right: 2, top: 0, bottom: 0, pointerEvents: "none" }}>
          {laid.map((e) => {
            const top = (e._s - startH) * PXH + 3;
            const height = Math.max(40, (e._e - e._s) * PXH - 6);
            const w = 100 / e._cols;
            return (
              <button key={e.id} onClick={() => onBlockTap?.(e)} style={{
                position: "absolute", top, height, left: `${e._col * w}%`, width: `calc(${w}% - 4px)`, pointerEvents: "auto",
                borderRadius: 13, overflow: "hidden", cursor: "pointer", textAlign: "left", padding: "6px 8px 6px 13px", border: "1px solid var(--hair2)",
                background: "var(--s2)", fontFamily: "var(--m-font)", boxShadow: "var(--shadow-card)",
              }}>
                {renderBlockInner?.(e, height)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
