// OperatorBookings.jsx — Operator track, screen 2 ("Bookings"), mounted at /hub
// for an operator role (owner | manager | staff), tab "bookings".
//
// Faithful mobile re-presentation of the prototype Bookings screen
// (design_handoff_guardian_app/m-views.jsx Bookings() + m-booking.jsx sheets):
//   • ground switcher (multi-venue operators)
//   • day strip
//   • "Show on calendar" kind filter + resource-lane filter
//   • a VERTICAL TIME-GRID CALENDAR — hour lines, blocks positioned by time,
//     overlapping blocks squashed side-by-side into columns, a live "now" line,
//     and tappable FREE SLOTS that open the new-booking flow
//   • a Requests section with SWIPE-to-approve / swipe-to-decline
//   • a New-booking button → progressive NewBookingSheet (one-off pitch hire)
//
// Data: getVenueResourceOccupancy(venue_id, from, to) → get_venue_resource_occupancy
// (mig 419) returns occupancy + lanes for EVERY venue the operator's company runs
// (drives the ground switcher). Auth: the operator passes their venue_id as the
// credential; resolve_venue_caller stage 1b authenticates via auth.uid() against
// venue_admins. No new RPC.
//
// Writes reuse existing operator RPCs: venueConfirmBooking / venueDeclineBooking
// (requests) and venueCreateBooking (new one-off hire). Weekly blocks / academy
// (venue_create_booking_series is team-only) and room-hire confirm (needs a price)
// remain follow-ups.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  getVenueResourceOccupancy, venueConfirmBooking, venueDeclineBooking,
  venueCreateBooking, venueListCustomersPeople,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const LONDON = "Europe/London";
const PXH = 62;            // pixels per hour on the calendar grid
const DAY_START = 8, DAY_END = 22; // default bookable window (expands to fit blocks)

function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function dayKey(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function hm(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
function fmtHm(frac) {
  const h = Math.floor(frac), m = Math.round((frac - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function londonHM(d) {
  if (!d) return null;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  let h = +p.find((x) => x.type === "hour").value;
  const m = +p.find((x) => x.type === "minute").value;
  if (h === 24) h = 0;
  return h + m / 60;
}
function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

const LANES = [
  { key: "pitch",   label: "Pitches",  icon: "grid" },
  { key: "room",    label: "Rooms",    icon: "door" },
  { key: "trainer", label: "Trainers", icon: "figure" },
];

// "Show on calendar" kind filter buckets (mirrors the prototype FILTER_DEFS).
const KIND_FILTERS = [
  { key: "fixtures",    label: "Fixtures" },
  { key: "confirmed",   label: "Confirmed" },
  { key: "requests",    label: "Requests" },
  { key: "classes",     label: "Classes & rooms" },
  { key: "maintenance", label: "Maintenance" },
  { key: "free",        label: "Free slots" },
];
function bucketOf(o) {
  if (o.source_kind === "maintenance") return "maintenance";
  if (isPitchRequest(o)) return "requests";
  if (["fixture", "club_fixture", "club_session"].includes(o.source_kind)) return "fixtures";
  if (o.source_kind === "booking") return "confirmed";
  return "classes"; // room_hire / class / appointment
}

const KIND_META = {
  booking:      { icon: "grid",    word: "Hire" },
  fixture:      { icon: "whistle", word: "Fixture" },
  club_session: { icon: "whistle", word: "Training" },
  club_fixture: { icon: "whistle", word: "Match" },
  maintenance:  { icon: "cog",     word: "Closed" },
  room_hire:    { icon: "door",    word: "Room hire" },
  class:        { icon: "users",   word: "Class" },
  appointment:  { icon: "figure",  word: "PT" },
};

function isPitchRequest(o) {
  return o.source_kind === "booking" && (o.detail?.status === "requested");
}
function toneFor(o) {
  if (o.source_kind === "maintenance") return { stripe: "var(--ink3)", hatch: true };
  if (isPitchRequest(o)) return { stripe: "var(--amber)" };
  if (["fixture", "club_fixture", "club_session"].includes(o.source_kind)) return { stripe: "var(--amber)" };
  if (o.source_kind === "booking") return { stripe: "var(--ok)" };
  return { stripe: "var(--info)" };
}
function blockTitle(o) {
  const d = o.detail || {};
  switch (o.source_kind) {
    case "booking":      return d.team_name || "Pitch hire";
    case "fixture":      return `${d.home_team || "Home"} v ${d.away_team || "Away"}`;
    case "club_session": return d.title || d.team_name || "Training";
    case "club_fixture": return `${d.our_team || "Our team"} v ${d.opponent || "TBC"}`;
    case "room_hire":    return d.booker || d.purpose || "Room hire";
    case "class":        return d.class_name || "Class";
    case "appointment":  return d.member_name || d.trainer_name || "Appointment";
    case "maintenance":  return "Pitch closed";
    default:             return "Booking";
  }
}
function resTag(name) {
  const s = String(name || "").trim();
  return s.length > 11 ? s.slice(0, 10) + "…" : s || "—";
}

// Column-squash overlapping blocks (port of the prototype combineEvents()).
function layout(items) {
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
// Free windows (any pitch free) across the bookable day — drives free slots + new-booking start times.
function freeGaps(pitchBlocks, startH, endH) {
  const busy = pitchBlocks
    .map((b) => ({ s: londonHM(b._start), e: londonHM(b._end) }))
    .filter((b) => b.s != null && b.e != null).sort((a, b) => a.s - b.s);
  const out = []; let c = startH;
  for (const b of busy) { if (b.s - c > 0.34) out.push({ from: c, to: b.s }); c = Math.max(c, b.e); }
  if (endH - c > 0.34) out.push({ from: c, to: endH });
  return out;
}

export default function OperatorBookings({ venueId, venueName, toast }) {
  const [state, setState] = useState({ loading: true, error: false, venues: [] });
  const [groundId, setGroundId] = useState(venueId);
  const [selKey, setSelKey] = useState(() => dayKey(new Date()));
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState({});
  const [lanesOff, setLanesOff] = useState(() => new Set());
  const [kindsOff, setKindsOff] = useState(() => new Set());
  const [sheet, setSheet] = useState(null); // null | 'kinds' | 'ground' | {create}

  const window14 = useMemo(() => {
    const days = []; const base = new Date();
    for (let i = 0; i < 14; i++) days.push({ key: dayKey(new Date(base.getTime() + i * 86400000)), date: new Date(base.getTime() + i * 86400000) });
    return days;
  }, []);

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, venues: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await getVenueResourceOccupancy(venueId, window14[0].key, window14[window14.length - 1].key);
      const venues = res?.venues || [];
      setState({ loading: false, error: false, venues });
      setGroundId((g) => (venues.some((v) => v.venue_id === g) ? g : (venues.find((v) => v.is_self) || venues[0])?.venue_id || venueId));
    } catch {
      setState({ loading: false, error: true, venues: [] });
    }
  }, [venueId, window14]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, venues } = state;
  const venue = venues.find((v) => v.venue_id === groundId) || venues.find((v) => v.is_self) || venues[0] || null;

  const blocks = useMemo(() => {
    const occ = venue?.occupancy || [];
    return occ.map((o) => {
      const start = o.start ? new Date(o.start) : null;
      const end = o.end ? new Date(o.end) : null;
      return { ...o, _key: start ? dayKey(start) : null, _start: start, _end: end, _lane: o.resource_type || "pitch" };
    }).filter((o) => o._key && o._start && o._end);
  }, [venue]);

  const byDay = useMemo(() => {
    const m = {};
    for (const b of blocks) { (m[b._key] ||= { count: 0, requests: 0 }); m[b._key].count += 1; if (isPitchRequest(b)) m[b._key].requests += 1; }
    return m;
  }, [blocks]);

  const presentLanes = useMemo(() => venue ? LANES.filter((ln) =>
    (ln.key === "pitch" && (venue.pitches || []).length) ||
    (ln.key === "room" && (venue.rooms || []).length) ||
    (ln.key === "trainer" && (venue.trainers || []).length)) : [], [venue]);

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Bookings</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading the calendar for {venueName || "your venue"}…</p>
      </div>
    );
  }
  if (error || !venue) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Bookings</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load the calendar right now.</p>
        <button onClick={load} style={{ marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5 }}>Try again</button>
      </div>
    );
  }

  const todayKey = dayKey(new Date());
  const dayAll = blocks.filter((b) => b._key === selKey);
  const dayShown = dayAll.filter((b) => !lanesOff.has(b._lane) && !kindsOff.has(bucketOf(b)));
  const dayRequests = dayAll.filter(isPitchRequest).sort((a, b) => a._start - b._start);
  const laid = layout(dayShown);

  // Calendar vertical window: bookable day, expanded to fit any out-of-hours blocks.
  let startH = DAY_START, endH = DAY_END;
  if (laid.length) {
    startH = Math.min(DAY_START, Math.floor(Math.min(...laid.map((e) => e._s))));
    endH = Math.max(DAY_END, Math.ceil(Math.max(...laid.map((e) => e._e))));
  }
  startH = Math.max(0, startH); endH = Math.min(24, endH);
  const hours = []; for (let h = startH; h <= endH; h++) hours.push(h);
  const gridH = (endH - startH) * PXH;
  const nowHM = londonHM(new Date());
  const showNow = selKey === todayKey && nowHM > startH && nowHM < endH;

  // Free slots (any pitch free) — only when the 'free' filter is on and pitches shown.
  const showFree = !kindsOff.has("free") && !lanesOff.has("pitch") && (venue.pitches || []).length > 0;
  const pitchDayBlocks = dayAll.filter((b) => b._lane === "pitch" && b.source_kind !== "maintenance");
  const gaps = showFree ? freeGaps(pitchDayBlocks, startH, endH) : [];

  const toggleLane = (key) => setLanesOff((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : (n.size < presentLanes.length - 1 && n.add(key)); return n; });
  const toggleKind = (key) => setKindsOff((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const hiddenKinds = kindsOff.size;

  const decide = async (o, confirm) => {
    if (busy[o.source_id]) return;
    setBusy((s) => ({ ...s, [o.source_id]: true }));
    try {
      if (confirm) await venueConfirmBooking(groundId, o.source_id);
      else await venueDeclineBooking(groundId, o.source_id);
      toast?.({ icon: confirm ? "check" : "x", text: `${blockTitle(o)} ${confirm ? "confirmed" : "declined"}`, sub: `${o.resource_name || "Pitch"} · ${o._start ? hm(o._start) : ""}` });
      setDetail(null);
      await load();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't update — try again" });
    } finally {
      setBusy((s) => ({ ...s, [o.source_id]: false }));
    }
  };

  const openCreate = (presetPitch = null, presetStart = null) =>
    setSheet({ create: true, presetPitch, presetStart });

  const selDate = window14.find((d) => d.key === selKey)?.date || new Date();
  const multiGround = venues.length > 1;

  return (
    <div>
      {/* ground switcher */}
      {multiGround && (
        <button onClick={() => setSheet("ground")} style={{
          width: "100%", marginTop: 8, padding: "10px 13px", borderRadius: "var(--r-md)", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 9, background: "var(--s2)", border: "1px solid var(--hair)", fontFamily: "var(--m-font)",
        }}>
          <MIcon name="pin" size={16} color="var(--amber)" />
          <span style={{ flex: 1, textAlign: "left", fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{venue.venue_name}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 600 }}>{venues.length} grounds</span>
          <MIcon name="chevdown" size={14} color="var(--ink3)" />
        </button>
      )}

      {/* day strip */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "8px 0 4px", scrollbarWidth: "none" }}>
        {window14.map((d) => {
          const on = d.key === selKey; const info = byDay[d.key]; const isToday = d.key === todayKey;
          const wd = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short" }).format(d.date);
          const dn = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, day: "numeric" }).format(d.date);
          return (
            <button key={d.key} onClick={() => setSelKey(d.key)} style={{
              flex: "none", width: 52, padding: "9px 0 8px", borderRadius: 14, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: on ? "var(--amber)" : "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)",
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: on ? "var(--amber-ink)" : "var(--ink3)" }}>{isToday ? "Today" : wd}</span>
              <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: on ? "var(--amber-ink)" : "var(--ink)" }}>{dn}</span>
              <span style={{ height: 6, display: "flex", alignItems: "center" }}>
                {info?.requests ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: on ? "var(--amber-ink)" : "var(--live)" }} />
                  : info?.count ? <span style={{ width: 5, height: 5, borderRadius: "50%", background: on ? "var(--amber-ink)" : "var(--ink4)" }} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      {/* heading + filter + new */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 2px 0", gap: 8 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
          {new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" }).format(selDate)}
        </h2>
        <button onClick={() => setSheet("kinds")} aria-label="Filter" style={{
          flex: "none", height: 34, minWidth: 34, padding: hiddenKinds ? "0 11px 0 9px" : "0", borderRadius: 11, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
          background: hiddenKinds ? "var(--amber)" : "var(--s2)", border: "1px solid", borderColor: hiddenKinds ? "var(--amber)" : "var(--hair)",
        }}>
          <MIcon name="list" size={17} color={hiddenKinds ? "var(--amber-ink)" : "var(--ink2)"} />
          {hiddenKinds > 0 && <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--amber-ink)" }}>{hiddenKinds}</span>}
        </button>
        <button onClick={() => openCreate()} aria-label="New booking" style={{
          flex: "none", width: 34, height: 34, borderRadius: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--amber)", border: "none",
        }}><MIcon name="plus" size={18} color="var(--amber-ink)" /></button>
      </div>

      {/* resource lanes */}
      {presentLanes.length > 1 && (
        <div style={{ display: "flex", gap: 7, margin: "11px 2px 0", flexWrap: "wrap" }}>
          {presentLanes.map((ln) => {
            const on = !lanesOff.has(ln.key);
            return (
              <button key={ln.key} onClick={() => toggleLane(ln.key)} style={{
                height: 30, padding: "0 12px", borderRadius: "var(--r-pill)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700,
                background: on ? "var(--amber-soft)" : "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber-glow)" : "var(--hair)", color: on ? "var(--amber)" : "var(--ink3)",
              }}><MIcon name={ln.icon} size={14} color={on ? "var(--amber)" : "var(--ink3)"} />{ln.label}</button>
            );
          })}
        </div>
      )}

      {/* calendar */}
      <div className="m-card" style={{ padding: "14px 12px 12px", marginTop: 13, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12, paddingLeft: 2 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>Day view
            <span style={{ color: "var(--ink3)", fontWeight: 500 }}> · {dayShown.length} booking{dayShown.length === 1 ? "" : "s"}</span>
          </div>
          {gaps.length > 0 && <span style={{ fontSize: 12, color: "var(--ok-ink)", fontWeight: 700, flex: "none" }}>{gaps.length} free</span>}
        </div>

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
                <button key={"f" + i} onClick={() => openCreate(null, g.from)} style={{
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
                const tone = toneFor(e); const w = 100 / e._cols; const tight = e._cols > 1; const title = blockTitle(e);
                return (
                  <button key={e.id} onClick={() => setDetail(e)} style={{
                    position: "absolute", top, height, left: `${e._col * w}%`, width: `calc(${w}% - 4px)`, pointerEvents: "auto",
                    borderRadius: 13, overflow: "hidden", cursor: "pointer", textAlign: "left", padding: "6px 8px 6px 13px", border: "1px solid var(--hair2)",
                    background: tone.hatch ? "repeating-linear-gradient(45deg, var(--s3), var(--s3) 7px, var(--s2) 7px, var(--s2) 14px)" : "var(--s2)",
                    fontFamily: "var(--m-font)", boxShadow: "var(--shadow-card)",
                  }}>
                    <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tone.stripe }} />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--ink2)", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{resTag(e.resource_name)}</span>
                      {e.detail?.status === "in_progress"
                        ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--live)", flex: "none" }} />
                        : <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone.stripe, flex: "none" }} />}
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{tight ? title.split(" v ")[0] : title}</div>
                    {height > 52 && <div style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{hm(e._start)}–{hm(e._end)}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 11, display: "flex", alignItems: "center", gap: 7, paddingLeft: 2 }}>
          <span style={{ width: 18, height: 18, borderRadius: 6, border: "1.4px dashed var(--hair2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MIcon name="plus" size={11} color="var(--ok-ink)" /></span>
          Tap a free slot to book · overlaps sit side by side
        </div>
      </div>

      {/* requests — swipe to approve/decline */}
      {dayRequests.length > 0 && (
        <>
          <div className="m-eyebrow" style={{ margin: "20px 2px 9px" }}>Requests · {dayRequests.length} pending · swipe</div>
          {dayRequests.map((o) => (
            <SwipeRow key={o.id} disabled={!!busy[o.source_id]}
              onApprove={() => decide(o, true)} onDecline={() => decide(o, false)}>
              <div onClick={() => setDetail(o)} role="button" className="m-card" style={{
                width: "100%", textAlign: "left", cursor: "pointer", padding: "13px 14px", display: "flex", alignItems: "center", gap: 12,
              }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MIcon name="clock" size={19} color="var(--amber)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{blockTitle(o)}</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[o.resource_name, o._start ? `${hm(o._start)}–${o._end ? hm(o._end) : ""}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7, flex: "none" }}>
                  <IconAction icon="x" tone="live" busy={!!busy[o.source_id]} onClick={(ev) => { ev.stopPropagation(); decide(o, false); }} aria="Decline" />
                  <IconAction icon="check" tone="ok" busy={!!busy[o.source_id]} onClick={(ev) => { ev.stopPropagation(); decide(o, true); }} aria="Confirm" />
                </div>
              </div>
            </SwipeRow>
          ))}
        </>
      )}

      {/* bottom new-booking button */}
      <button onClick={() => openCreate()} style={{
        width: "100%", marginTop: 16, height: 50, borderRadius: 15, border: "none", cursor: "pointer",
        background: "var(--amber)", color: "var(--amber-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15.5,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
      }}><MIcon name="plus" size={19} color="var(--amber-ink)" />New booking</button>

      {/* sheets */}
      {detail && (
        <BookingDetailSheet o={detail} busy={!!busy[detail.source_id]} onClose={() => setDetail(null)}
          onConfirm={() => decide(detail, true)} onDecline={() => decide(detail, false)} />
      )}
      {sheet === "ground" && (
        <GroundSheet venues={venues} current={groundId} onPick={(id) => { setGroundId(id); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
      {sheet === "kinds" && (
        <KindFilterSheet off={kindsOff} onToggle={toggleKind} onAll={() => setKindsOff(new Set())} onClose={() => setSheet(null)} />
      )}
      {sheet && sheet.create && (
        <NewBookingSheet
          venueId={groundId}
          pitches={venue.pitches || []}
          dayKeyStr={selKey}
          dayLabel={new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" }).format(selDate)}
          dayBlocks={pitchDayBlocks}
          startH={startH} endH={endH}
          presetPitch={sheet.presetPitch} presetStart={sheet.presetStart}
          toast={toast}
          onClose={() => setSheet(null)}
          onDone={async () => { setSheet(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── swipe-to-approve/decline row (port of the prototype SwipeRow) ──
function SwipeRow({ children, onApprove, onDecline, disabled }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const start = useRef(null);
  const TH = 84;
  const down = (e) => { if (disabled) return; start.current = e.touches ? e.touches[0].clientX : e.clientX; };
  const move = (e) => { if (start.current == null) return; const x = e.touches ? e.touches[0].clientX : e.clientX; setDx(x - start.current); };
  const up = () => {
    if (start.current == null) return;
    if (dx > TH) finish(true); else if (dx < -TH) finish(false); else setDx(0);
    start.current = null;
  };
  const finish = (approve) => { setGone(true); setDx(approve ? 420 : -420); setTimeout(() => (approve ? onApprove() : onDecline()), 220); };
  const prog = Math.min(1, Math.abs(dx) / TH);
  const side = dx > 0 ? "approve" : "decline";
  return (
    <div style={{ position: "relative", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: gone ? 0 : 10, height: gone ? 0 : "auto", transition: gone ? "height .24s ease .1s, margin .24s ease .1s" : "none" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: side === "approve" ? "flex-start" : "flex-end", padding: "0 22px", background: side === "approve" ? "var(--ok-soft)" : "var(--live-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: side === "approve" ? "var(--ok-ink)" : "var(--live-ink)", fontWeight: 700, fontSize: 14, transform: `scale(${0.8 + prog * 0.3})`, opacity: prog }}>
          <MIcon name={side === "approve" ? "check" : "x"} size={20} color={side === "approve" ? "var(--ok-ink)" : "var(--live-ink)"} />{side === "approve" ? "Approve" : "Decline"}
        </div>
      </div>
      <div onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}
        style={{ position: "relative", transform: `translateX(${dx}px)`, transition: start.current == null ? "transform .32s cubic-bezier(.2,.9,.3,1.2)" : "none", touchAction: "pan-y" }}>
        {children}
      </div>
    </div>
  );
}

function GroundSheet({ venues, current, onPick, onClose }) {
  return (
    <MobileSheet title="Switch ground" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {venues.map((v) => {
          const on = v.venue_id === current;
          return (
            <button key={v.venue_id} onClick={() => onPick(v.venue_id)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", cursor: "pointer", textAlign: "left",
              background: "var(--s2)", borderRadius: "var(--r-md)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MIcon name="pin" size={18} color="var(--amber)" /></div>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.venue_name}{v.is_self ? "" : ""}</span>
                {v.venue_address && <span style={{ fontSize: 12, color: "var(--ink3)", display: "block", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.venue_address}</span>}
              </span>
              {on && <MIcon name="check" size={18} color="var(--amber)" />}
            </button>
          );
        })}
      </div>
    </MobileSheet>
  );
}

function KindFilterSheet({ off, onToggle, onAll, onClose }) {
  return (
    <MobileSheet title="Show on calendar" onClose={onClose}>
      <div className="m-card" style={{ padding: 0, overflow: "hidden", background: "var(--s2)" }}>
        {KIND_FILTERS.map((k, i) => {
          const on = !off.has(k.key);
          return (
            <button key={k.key} onClick={() => onToggle(k.key)} style={{
              display: "flex", alignItems: "center", gap: 13, width: "100%", padding: "14px 15px", cursor: "pointer", textAlign: "left",
              background: on ? "rgba(255,255,255,0.03)" : "transparent", border: "none", borderTop: i > 0 ? "1px solid var(--hair)" : "none", fontFamily: "var(--m-font)",
            }}>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{k.label}</span>
              <span style={{ width: 23, height: 23, borderRadius: 7, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                background: on ? "var(--amber-soft)" : "transparent", boxShadow: on ? "inset 0 0 0 1.5px var(--amber)" : "inset 0 0 0 1.5px var(--hair2)" }}>
                {on && <MIcon name="check" size={14} color="var(--amber)" />}
              </span>
            </button>
          );
        })}
      </div>
      <button onClick={onAll} style={{ width: "100%", marginTop: 12, padding: "10px", borderRadius: "var(--r-pill)", cursor: "pointer",
        background: "transparent", border: "1px solid var(--hair2)", color: "var(--ink2)", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13.5 }}>Show all</button>
    </MobileSheet>
  );
}

// ── progressive new-booking flow (one-off pitch hire via venue_create_booking) ──
const DURS = [[60, "1h"], [90, "1½h"], [120, "2h"]];

function NewBookingSheet({ venueId, pitches, dayKeyStr, dayLabel, dayBlocks, startH, endH, presetPitch, presetStart, toast, onClose, onDone }) {
  const [pitch, setPitch] = useState(presetPitch || (pitches.length === 1 ? pitches[0].id : null));
  const [dur, setDur] = useState(60);
  const [start, setStart] = useState(presetStart != null ? Math.round(presetStart * 2) / 2 : null);
  const [who, setWho] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);

  // Lazy-load existing people for the lookup.
  useEffect(() => {
    let cancel = false;
    venueListCustomersPeople(venueId).then((rows) => { if (!cancel) setPeople(rows || []); }).catch(() => { if (!cancel) setPeople([]); });
    return () => { cancel = true; };
  }, [venueId]);

  // Free start times for the chosen pitch + duration.
  const startOptions = useMemo(() => {
    if (!pitch) return [];
    const busyRanges = dayBlocks.filter((b) => b.resource_id === pitch)
      .map((b) => ({ s: londonHM(b._start), e: londonHM(b._end) })).filter((b) => b.s != null);
    const durH = dur / 60; const out = [];
    for (let t = startH; t <= endH - durH + 1e-6; t += 0.5) {
      const tEnd = t + durH;
      const clash = busyRanges.some((b) => t < b.e - 1e-6 && tEnd > b.s + 1e-6);
      if (!clash) out.push(Math.round(t * 2) / 2);
    }
    return out;
  }, [pitch, dur, dayBlocks, startH, endH]);

  useEffect(() => { if (start != null && !startOptions.includes(start)) setStart(null); }, [startOptions]); // eslint-disable-line

  const q = query.trim().toLowerCase();
  const matches = (people || []).filter((p) => {
    const name = `${p.first_name || ""} ${p.last_name || ""}`.trim().toLowerCase();
    return q ? name.includes(q) : true;
  }).slice(0, 6);

  const phoneOk = phone.replace(/[^0-9]/g, "").length >= 7;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const contactOk = phoneOk && emailOk;
  const canBook = pitch && start != null && who.trim().length > 0 && contactOk && !busy;
  const pitchName = pitches.find((p) => p.id === pitch)?.name || "";
  const timeLabel = start != null ? `${fmtHm(start)}–${fmtHm(start + dur / 60)}` : "";

  const book = async () => {
    if (!canBook) return;
    setBusy(true);
    try {
      const res = await venueCreateBooking(venueId, pitch, dayKeyStr, fmtHm(start), dur, null, who.trim(), email.trim() || null, phone.trim() || null);
      if (res?.ok === false) throw new Error(res.reason || "failed");
      toast?.({ icon: "check", text: `${who.trim()} booked`, sub: `${pitchName} · ${dayLabel} · ${timeLabel}` });
      await onDone();
    } catch (e) {
      const msg = String(e?.message || e?.reason || "");
      toast?.({ icon: "alert", text: msg.includes("slot_unavailable") ? "That slot was just taken" : "Couldn't book — try again" });
      setBusy(false);
    }
  };

  const pickPerson = (p) => {
    setWho(`${p.first_name || ""} ${p.last_name || ""}`.trim());
    if (p.phone) setPhone(p.phone);
    if (p.email) setEmail(p.email);
    setQuery("");
  };

  return (
    <MobileSheet title="New booking" onClose={busy ? undefined : onClose} footer={
      <button onClick={book} disabled={!canBook} style={{
        width: "100%", height: 50, borderRadius: 15, border: "none", cursor: canBook ? "pointer" : "default",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: canBook ? "var(--amber)" : "var(--s3)", color: canBook ? "var(--amber-ink)" : "var(--ink3)", opacity: busy ? 0.7 : 1,
      }}>
        {canBook ? <><MIcon name="check" size={17} color="var(--amber-ink)" />{busy ? "Booking…" : "Confirm booking"}</>
          : (!pitch ? "Choose a pitch" : start == null ? "Pick a time" : who.trim().length === 0 ? "Add who it's for" : "Add a phone and email")}
      </button>
    }>
      {/* summary chips */}
      {(pitch || start != null) && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "2px 0 14px" }}>
          {pitch && <Chip icon="grid" text={pitchName} />}
          {start != null && <Chip icon="clock" text={timeLabel} />}
          <Chip icon="calendar" text={dayLabel} />
        </div>
      )}

      {/* 1 · pitch */}
      <FieldLabel>Which pitch</FieldLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pitches.map((p) => {
          const on = pitch === p.id;
          return (
            <button key={p.id} onClick={() => setPitch(p.id)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 13px", borderRadius: 13, cursor: "pointer", textAlign: "left",
              background: "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)",
            }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "var(--s3)", display: "flex", alignItems: "center", justifyContent: "center" }}><MIcon name="grid" size={18} color="var(--ink2)" /></span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{p.name}</span>
              {on && <MIcon name="check" size={18} color="var(--amber)" />}
            </button>
          );
        })}
      </div>

      {/* 2 · when */}
      <FieldLabel>Duration</FieldLabel>
      <div style={{ display: "flex", gap: 8 }}>
        {DURS.map(([m, l]) => (
          <button key={m} onClick={() => setDur(m)} style={chip(dur === m)}>{l}</button>
        ))}
      </div>
      <FieldLabel>{pitch ? `Free start times · ${pitchName}` : "Start time"}</FieldLabel>
      {!pitch ? (
        <div style={{ fontSize: 13, color: "var(--ink4)", padding: "8px 2px" }}>Choose a pitch first.</div>
      ) : startOptions.length ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {startOptions.map((t) => <button key={t} onClick={() => setStart(t)} style={chip(start === t)}>{fmtHm(t)}</button>)}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--ink3)", padding: "10px 2px", display: "flex", alignItems: "center", gap: 8 }}>
          <MIcon name="alert" size={15} color="var(--amber)" />No {DURS.find((d) => d[0] === dur)[1]} window free — try a shorter duration.
        </div>
      )}

      {/* 3 · who */}
      <FieldLabel>Who's it for</FieldLabel>
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 13px", height: 46, background: "var(--s2)", border: "1px solid var(--hair)" }}>
        <MIcon name="search" size={17} color="var(--ink3)" />
        <input value={who || query} onChange={(e) => { setQuery(e.target.value); setWho(e.target.value); }} placeholder="Search members or type a name"
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15 }} />
      </div>
      {q.length > 0 && matches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9, maxHeight: 200, overflowY: "auto", scrollbarWidth: "none" }}>
          {matches.map((p) => {
            const name = `${p.first_name || ""} ${p.last_name || ""}`.trim();
            return (
              <button key={p.id} onClick={() => pickPerson(p)} style={{
                display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                background: "var(--s2)", border: "1px solid var(--hair)", fontFamily: "var(--m-font)",
              }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, color: "var(--ink2)" }}>{initials(name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                  {(p.email || p.phone) && <span style={{ fontSize: 12, color: "var(--ink3)", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.email || p.phone}</span>}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink4)", flex: "none" }}>On file</span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: contactOk ? "var(--ink4)" : "var(--amber)", margin: "11px 2px 7px", fontWeight: 600 }}>
        Contact · phone and email required
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel"
          style={{ ...inp, borderColor: phone && !phoneOk ? "var(--amber-glow)" : "var(--hair)" }} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" inputMode="email"
          style={{ ...inp, borderColor: email && !emailOk ? "var(--amber-glow)" : "var(--hair)" }} />
      </div>
    </MobileSheet>
  );
}

function Chip({ icon, text }) {
  return (
    <span style={{ height: 28, padding: "0 11px", borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink2)", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700 }}>
      <MIcon name={icon} size={13} color="var(--amber)" />{text}
    </span>
  );
}
function FieldLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)", margin: "15px 2px 8px" }}>{children}</div>;
}
function chip(on) {
  return {
    height: 38, padding: "0 16px", borderRadius: "var(--r-pill)", cursor: "pointer", fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
    background: on ? "var(--amber)" : "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", color: on ? "var(--amber-ink)" : "var(--ink2)",
  };
}
const inp = {
  height: 44, padding: "0 13px", borderRadius: 12, background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 14, outline: "none", boxSizing: "border-box", width: "100%",
};

// ── booking detail ──
function statusPill(o) {
  const d = o.detail || {};
  if (isPitchRequest(o)) return { text: "Awaiting confirmation", tone: "amber" };
  if (o.source_kind === "maintenance") return { text: "Pitch closed", tone: "ink" };
  if (o.source_kind === "fixture" && d.status === "in_progress") return { text: "Live now", tone: "live" };
  if (d.owed) return { text: "Balance due", tone: "amber" };
  if (d.status === "confirmed" || o.source_kind === "booking") return { text: "Confirmed", tone: "ok" };
  if (d.status) return { text: d.status, tone: "ok" };
  return { text: "Booked", tone: "ok" };
}
function StatusChip({ pill }) {
  const map = { amber: ["var(--amber-soft)", "var(--amber)"], ok: ["var(--ok-soft)", "var(--ok-ink)"], live: ["var(--live-soft)", "var(--live-ink)"], ink: ["var(--s3)", "var(--ink3)"] };
  const [bg, fg] = map[pill.tone] || map.ok;
  return <span style={{ flex: "none", height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", background: bg, color: fg, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase" }}>{pill.text}</span>;
}
function IconAction({ icon, tone, busy, onClick, aria }) {
  const soft = tone === "ok" ? "var(--ok-soft)" : "var(--live-soft)";
  const ink = tone === "ok" ? "var(--ok-ink)" : "var(--live-ink)";
  return (
    <button onClick={onClick} disabled={busy} aria-label={aria} style={{ width: 34, height: 34, borderRadius: 10, flex: "none", cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: soft, border: "none", opacity: busy ? 0.5 : 1 }}>
      <MIcon name={icon} size={16} color={ink} />
    </button>
  );
}
function BookingDetailSheet({ o, busy, onClose, onConfirm, onDecline }) {
  const d = o.detail || {};
  const meta = KIND_META[o.source_kind] || KIND_META.booking;
  const pill = statusPill(o);
  const request = isPitchRequest(o);
  const dateLabel = o._start ? new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" }).format(o._start) : "—";
  return (
    <MobileSheet title="Booking" onClose={busy ? undefined : onClose} footer={request ? (
      <div style={{ display: "flex", gap: 9 }}>
        <button onClick={onDecline} disabled={busy} style={{ flex: 1, height: 48, borderRadius: 14, cursor: busy ? "default" : "pointer", background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--live-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, opacity: busy ? 0.6 : 1 }}>Decline</button>
        <button onClick={onConfirm} disabled={busy} style={{ flex: 1.5, height: 48, borderRadius: 14, border: "none", cursor: busy ? "default" : "pointer", background: "var(--amber)", color: "var(--amber-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, opacity: busy ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <MIcon name="check" size={17} color="var(--amber-ink)" />{busy ? "Confirming…" : "Confirm booking"}
        </button>
      </div>
    ) : null}>
      <div className="m-card" style={{ padding: "15px 15px", background: "var(--s2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <StatusChip pill={pill} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{o._start ? `${hm(o._start)}–${o._end ? hm(o._end) : ""}` : ""}</span>
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 12 }}>{blockTitle(o)}</div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 3 }}>{meta.word}</div>
      </div>
      <div className="m-card" style={{ padding: "2px 15px", marginTop: 11, background: "var(--s2)" }}>
        <InfoRow icon={meta.icon} k="Resource" v={o.resource_name || "—"} />
        <InfoRow icon="calendar" k="Date" v={dateLabel} />
        {d.kind && <InfoRow icon="grid" k="Type" v={d.kind === "block" ? "Weekly block" : "One-off hire"} />}
        {o.source_kind === "fixture" && <InfoRow icon="whistle" k="Fixture" v={`${d.home_team || "Home"} v ${d.away_team || "Away"}`} />}
        {o.source_kind === "class" && d.instructor && <InfoRow icon="figure" k="Instructor" v={d.instructor} />}
        {o.source_kind === "appointment" && d.trainer_name && <InfoRow icon="figure" k="Trainer" v={d.trainer_name} />}
        {typeof d.attendee_count === "number" && <InfoRow icon="users" k="Attendees" v={String(d.attendee_count)} />}
        <InfoRow icon="pound" k="Payment" v={request ? "Due on confirmation" : d.owed ? "Balance due" : (o.source_kind === "booking" || d.status === "confirmed") ? "Settled" : "—"} warn={!!d.owed || request} last />
      </div>
      {request && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink3)", margin: "14px 4px 2px", lineHeight: 1.4 }}>
          <MIcon name="info" size={15} color="var(--amber)" style={{ flex: "none" }} />Confirming raises the charge and books the slot. Declining frees it up.
        </div>
      )}
    </MobileSheet>
  );
}
function InfoRow({ icon, k, v, warn, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: last ? "none" : "1px solid var(--hair)" }}>
      <MIcon name={icon} size={17} color="var(--ink3)" style={{ flex: "none" }} />
      <span style={{ fontSize: 13.5, color: "var(--ink3)", flex: "none" }}>{k}</span>
      <span style={{ flex: 1, textAlign: "right", fontSize: 14, fontWeight: 600, color: warn ? "var(--amber)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
    </div>
  );
}
