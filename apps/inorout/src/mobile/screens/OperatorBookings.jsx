// OperatorBookings.jsx — Operator track, screen 2 ("Bookings"), mounted at /hub
// for an operator role (owner | manager | staff), tab "bookings".
//
// Faithful mobile re-presentation of the prototype Bookings screen
// (design_handoff_guardian_app/m-views.jsx — Bookings()): a VERTICAL TIME-GRID
// CALENDAR (hour lines + hour labels, blocks positioned by time, overlapping
// blocks squashed side-by-side into columns, a live "now" line) with a day
// stepper / strip, a resource-lane filter, and a Requests section below.
//
// Data: getVenueResourceOccupancy(venue_id, from, to) → get_venue_resource_occupancy
// (mig 419): one normalised occupancy[] across pitches + rooms (room hires ∪ classes)
// + trainers, plus the resource lanes. No new reader.
//
// AUTH: identical to OperationsTonight — the operator passes their venue_id as the
// credential; resolve_venue_caller stage 1b authenticates via auth.uid() against
// venue_admins. No token, no new RPC.
//
// Request approvals reuse existing writers: venueConfirmBooking / venueDeclineBooking
// (pitch booking requests). Room-hire confirmation (needs a price) and new-booking
// CREATE (the prototype's progressive NewBookingSheet — tap a free slot / the "+")
// are deferred to their own cycle — the "+" surfaces a "coming soon" toast.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getVenueResourceOccupancy, venueConfirmBooking, venueDeclineBooking,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const LONDON = "Europe/London";
const PXH = 62;            // pixels per hour on the calendar grid
const GAP_MIN = 6;         // px subtracted from block height for breathing room

function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// Local YYYY-MM-DD key for a Date in the venue's timezone.
function dayKey(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function hm(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
// Fractional London hour (e.g. 19.5 for 19:30) — drives the vertical position.
function londonHM(d) {
  if (!d) return null;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  let h = +p.find((x) => x.type === "hour").value;
  const m = +p.find((x) => x.type === "minute").value;
  if (h === 24) h = 0;
  return h + m / 60;
}

// Resource lanes shown by the filter (only those the venue actually has appear).
const LANES = [
  { key: "pitch",   label: "Pitches",  icon: "grid" },
  { key: "room",    label: "Rooms",    icon: "door" },
  { key: "trainer", label: "Trainers", icon: "figure" },
];

// source_kind → glyph + a short human label for the block / detail.
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

// A pitch booking awaiting operator confirmation — the only inline-actionable kind.
function isPitchRequest(o) {
  return o.source_kind === "booking" && (o.detail?.status === "requested");
}

// Coloured left-stripe tone per block, mirroring the prototype evtTone.
function toneFor(o) {
  if (o.source_kind === "maintenance") return { stripe: "var(--ink3)", soft: "var(--s3)", hatch: true };
  if (isPitchRequest(o)) return { stripe: "var(--amber)", soft: "var(--amber-soft)" };
  if (["fixture", "club_fixture", "club_session"].includes(o.source_kind)) return { stripe: "var(--amber)", soft: "var(--amber-soft)" };
  if (o.source_kind === "booking") return { stripe: "var(--ok)", soft: "var(--ok-soft)" };
  return { stripe: "var(--info)", soft: "var(--info-soft)" }; // room_hire / class / appointment
}

// Human title for an occupancy block, from its source_kind + detail.
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
// Short resource tag for the block corner (e.g. "Main", "Studio 1").
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

export default function OperatorBookings({ venueId, venueName, toast }) {
  const [state, setState] = useState({ loading: true, error: false, venue: null });
  const [selKey, setSelKey] = useState(() => dayKey(new Date()));
  const [detail, setDetail] = useState(null);          // occupancy item or null
  const [busy, setBusy] = useState({});                // source_id → bool
  const [lanesOff, setLanesOff] = useState(() => new Set()); // resource_types hidden

  // 14-day window: today .. +13, fetched once.
  const window14 = useMemo(() => {
    const days = [];
    const base = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      days.push({ key: dayKey(d), date: d });
    }
    return days;
  }, []);

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, venue: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const from = window14[0].key;
      const to = window14[window14.length - 1].key;
      const res = await getVenueResourceOccupancy(venueId, from, to);
      const venues = res?.venues || [];
      const venue = venues.find((v) => v.is_self) || venues[0] || null;
      setState({ loading: false, error: false, venue });
    } catch {
      setState({ loading: false, error: true, venue: null });
    }
  }, [venueId, window14]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, venue } = state;

  // Normalise every occupancy block once: attach dayKey, start/end Date, lane.
  const blocks = useMemo(() => {
    const occ = venue?.occupancy || [];
    return occ.map((o) => {
      const start = o.start ? new Date(o.start) : null;
      const end = o.end ? new Date(o.end) : null;
      return { ...o, _key: start ? dayKey(start) : null, _start: start, _end: end, _lane: o.resource_type || "pitch" };
    }).filter((o) => o._key && o._start && o._end);
  }, [venue]);

  // Per-day index → drives the day-strip dots / request badges.
  const byDay = useMemo(() => {
    const m = {};
    for (const b of blocks) {
      (m[b._key] ||= { count: 0, requests: 0 });
      m[b._key].count += 1;
      if (isPitchRequest(b)) m[b._key].requests += 1;
    }
    return m;
  }, [blocks]);

  // Which lanes the venue actually has (drives the filter row).
  const presentLanes = useMemo(() => {
    if (!venue) return [];
    return LANES.filter((ln) =>
      (ln.key === "pitch" && (venue.pitches || []).length) ||
      (ln.key === "room" && (venue.rooms || []).length) ||
      (ln.key === "trainer" && (venue.trainers || []).length)
    );
  }, [venue]);

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
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  const todayKey = dayKey(new Date());
  const dayAll = blocks.filter((b) => b._key === selKey);
  const dayShown = dayAll.filter((b) => !lanesOff.has(b._lane));
  const dayRequests = dayAll.filter(isPitchRequest).sort((a, b) => a._start - b._start);
  const laid = layout(dayShown);

  // Calendar vertical window: snap to the day's blocks, min 5h span.
  let startH = 9, endH = 22;
  if (laid.length) {
    startH = Math.floor(Math.min(...laid.map((e) => e._s)));
    endH = Math.ceil(Math.max(...laid.map((e) => e._e)));
    if (endH - startH < 5) endH = startH + 5;
    if (startH < 0) startH = 0;
    if (endH > 24) endH = 24;
  }
  const hours = [];
  for (let h = startH; h <= endH; h++) hours.push(h);
  const gridH = (endH - startH) * PXH;
  const nowHM = londonHM(new Date());
  const showNow = selKey === todayKey && nowHM > startH && nowHM < endH;

  const toggleLane = (key) => {
    setLanesOff((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else if (n.size < presentLanes.length - 1) n.add(key); // keep at least one lane on
      return n;
    });
  };

  // ── pitch-booking request confirm / decline ──
  const decide = async (o, confirm) => {
    if (busy[o.source_id]) return;
    setBusy((s) => ({ ...s, [o.source_id]: true }));
    try {
      if (confirm) await venueConfirmBooking(venueId, o.source_id);
      else await venueDeclineBooking(venueId, o.source_id);
      toast?.({
        icon: confirm ? "check" : "x",
        text: `${blockTitle(o)} ${confirm ? "confirmed" : "declined"}`,
        sub: `${o.resource_name || "Pitch"} · ${o._start ? hm(o._start) : ""}`,
      });
      setDetail(null);
      await load();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't update — try again" });
    } finally {
      setBusy((s) => ({ ...s, [o.source_id]: false }));
    }
  };

  const selDate = window14.find((d) => d.key === selKey)?.date || new Date();

  return (
    <div>
      {/* ── day strip ── */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "8px 0 4px", scrollbarWidth: "none" }}>
        {window14.map((d) => {
          const on = d.key === selKey;
          const info = byDay[d.key];
          const isToday = d.key === todayKey;
          const wd = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short" }).format(d.date);
          const dn = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, day: "numeric" }).format(d.date);
          return (
            <button key={d.key} onClick={() => setSelKey(d.key)} style={{
              flex: "none", width: 52, padding: "9px 0 8px", borderRadius: 14, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: on ? "var(--amber)" : "var(--s2)",
              border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)",
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                color: on ? "var(--amber-ink)" : "var(--ink3)" }}>{isToday ? "Today" : wd}</span>
              <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums",
                color: on ? "var(--amber-ink)" : "var(--ink)" }}>{dn}</span>
              <span style={{ height: 6, display: "flex", alignItems: "center", gap: 3 }}>
                {info?.requests ? (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: on ? "var(--amber-ink)" : "var(--live)" }} />
                ) : info?.count ? (
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: on ? "var(--amber-ink)" : "var(--ink4)" }} />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── heading + lane filter + new ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 2px 0", gap: 10 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" }).format(selDate)}
        </h2>
        <button onClick={() => toast?.({ icon: "plus", text: "New booking — coming soon", sub: "Use the venue dashboard for now" })}
          aria-label="New booking" style={{
            flex: "none", width: 34, height: 34, borderRadius: 11, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--amber)", border: "none",
          }}><MIcon name="plus" size={18} color="var(--amber-ink)" /></button>
      </div>

      {presentLanes.length > 1 && (
        <div style={{ display: "flex", gap: 7, margin: "11px 2px 0", flexWrap: "wrap" }}>
          {presentLanes.map((ln) => {
            const on = !lanesOff.has(ln.key);
            return (
              <button key={ln.key} onClick={() => toggleLane(ln.key)} style={{
                height: 30, padding: "0 12px", borderRadius: "var(--r-pill)", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--m-font)",
                fontSize: 12.5, fontWeight: 700,
                background: on ? "var(--amber-soft)" : "var(--s2)",
                border: "1px solid", borderColor: on ? "var(--amber-glow)" : "var(--hair)",
                color: on ? "var(--amber)" : "var(--ink3)",
              }}>
                <MIcon name={ln.icon} size={14} color={on ? "var(--amber)" : "var(--ink3)"} />{ln.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── the calendar ── */}
      <div className="m-card" style={{ padding: "14px 12px 12px", marginTop: 13, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12, paddingLeft: 2 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>Day view
            <span style={{ color: "var(--ink3)", fontWeight: 500 }}> · {dayShown.length} booking{dayShown.length === 1 ? "" : "s"}</span>
          </div>
          {dayRequests.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700, flex: "none" }}>{dayRequests.length} to confirm</span>
          )}
        </div>

        {dayShown.length === 0 ? (
          <div style={{ padding: "26px 14px", textAlign: "center" }}>
            <MIcon name="calendar" size={26} color="var(--ink3)" />
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 9, color: "var(--ink2)" }}>Nothing booked</div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 3 }}>
              {dayAll.length ? "All lanes hidden by the filter." : "No pitches, rooms or trainers booked this day."}
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
            <div style={{ position: "relative", height: gridH }}>
              {/* hour lines + labels */}
              {hours.map((h) => (
                <div key={h}>
                  <div style={{ position: "absolute", left: 46, right: 0, top: (h - startH) * PXH, borderTop: "1px dashed var(--hair)" }} />
                  <div style={{ position: "absolute", left: 0, width: 38, textAlign: "right", top: (h - startH) * PXH, transform: "translateY(-7px)",
                    fontSize: 10.5, fontWeight: 700, color: "var(--ink4)", fontVariantNumeric: "tabular-nums" }}>{String(h).padStart(2, "0")}:00</div>
                </div>
              ))}

              {/* now line */}
              {showNow && (
                <div style={{ position: "absolute", left: 46, right: 0, top: (nowHM - startH) * PXH, height: 2, background: "var(--live)", zIndex: 6, boxShadow: "0 0 8px var(--live)" }}>
                  <span style={{ position: "absolute", left: -4, top: -3, width: 8, height: 8, borderRadius: "50%", background: "var(--live)" }} />
                </div>
              )}

              {/* blocks */}
              <div style={{ position: "absolute", left: 52, right: 2, top: 0, bottom: 0 }}>
                {laid.map((e) => {
                  const top = (e._s - startH) * PXH + 3;
                  const height = Math.max(40, (e._e - e._s) * PXH - GAP_MIN);
                  const tone = toneFor(e);
                  const w = 100 / e._cols;
                  const tight = e._cols > 1;
                  const title = blockTitle(e);
                  return (
                    <button key={e.id} onClick={() => setDetail(e)} style={{
                      position: "absolute", top, height, left: `${e._col * w}%`, width: `calc(${w}% - 4px)`,
                      borderRadius: 13, overflow: "hidden", cursor: "pointer", textAlign: "left",
                      padding: "6px 8px 6px 13px", border: "1px solid var(--hair2)",
                      background: tone.hatch
                        ? "repeating-linear-gradient(45deg, var(--s3), var(--s3) 7px, var(--s2) 7px, var(--s2) 14px)"
                        : "var(--s2)",
                      fontFamily: "var(--m-font)", boxShadow: "var(--shadow-card)",
                    }}>
                      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tone.stripe }} />
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: "var(--ink2)", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{resTag(e.resource_name)}</span>
                        {e.detail?.status === "in_progress"
                          ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--live)", flex: "none" }} />
                          : <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone.stripe, flex: "none" }} />}
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                        {tight ? title.split(" v ")[0] : title}
                      </div>
                      {height > 52 && (
                        <div style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                          {hm(e._start)}–{hm(e._end)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 11, display: "flex", alignItems: "center", gap: 7, paddingLeft: 2 }}>
          <MIcon name="info" size={13} color="var(--ink4)" style={{ flex: "none" }} />
          Overlapping bookings sit side by side · tap one for detail
        </div>
      </div>

      {/* ── requests ── */}
      {dayRequests.length > 0 && (
        <>
          <div className="m-eyebrow" style={{ margin: "20px 2px 9px" }}>Requests · {dayRequests.length} pending</div>
          {dayRequests.map((o) => {
            const b = !!busy[o.source_id];
            return (
              <div key={o.id} className="m-card" style={{ padding: "13px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--amber-soft)",
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MIcon name="clock" size={19} color="var(--amber)" />
                </div>
                <button onClick={() => setDetail(o)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--m-font)", padding: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{blockTitle(o)}</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[o.resource_name, o._start ? `${hm(o._start)}–${o._end ? hm(o._end) : ""}` : null].filter(Boolean).join(" · ")}
                  </div>
                </button>
                <div style={{ display: "flex", gap: 7, flex: "none" }}>
                  <IconAction icon="x" tone="live" busy={b} onClick={() => decide(o, false)} aria="Decline" />
                  <IconAction icon="check" tone="ok" busy={b} onClick={() => decide(o, true)} aria="Confirm" />
                </div>
              </div>
            );
          })}
        </>
      )}

      {detail && (
        <BookingDetailSheet
          o={detail}
          busy={!!busy[detail.source_id]}
          onClose={() => setDetail(null)}
          onConfirm={() => decide(detail, true)}
          onDecline={() => decide(detail, false)}
        />
      )}
    </div>
  );
}

// Status pill text + tone for a block / detail sheet.
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
  const map = {
    amber: ["var(--amber-soft)", "var(--amber)"],
    ok:    ["var(--ok-soft)", "var(--ok-ink)"],
    live:  ["var(--live-soft)", "var(--live-ink)"],
    ink:   ["var(--s3)", "var(--ink3)"],
  };
  const [bg, fg] = map[pill.tone] || map.ok;
  return (
    <span style={{
      flex: "none", height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center",
      background: bg, color: fg, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase",
    }}>{pill.text}</span>
  );
}

function IconAction({ icon, tone, busy, onClick, aria }) {
  const soft = tone === "ok" ? "var(--ok-soft)" : "var(--live-soft)";
  const ink = tone === "ok" ? "var(--ok-ink)" : "var(--live-ink)";
  return (
    <button onClick={onClick} disabled={busy} aria-label={aria} style={{
      width: 34, height: 34, borderRadius: 10, flex: "none", cursor: busy ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: soft, border: "none", opacity: busy ? 0.5 : 1,
    }}><MIcon name={icon} size={16} color={ink} /></button>
  );
}

function BookingDetailSheet({ o, busy, onClose, onConfirm, onDecline }) {
  const d = o.detail || {};
  const meta = KIND_META[o.source_kind] || KIND_META.booking;
  const pill = statusPill(o);
  const request = isPitchRequest(o);
  const dateLabel = o._start
    ? new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" }).format(o._start)
    : "—";

  return (
    <MobileSheet title="Booking" onClose={busy ? undefined : onClose} footer={request ? (
      <div style={{ display: "flex", gap: 9 }}>
        <button onClick={onDecline} disabled={busy} style={{
          flex: 1, height: 48, borderRadius: 14, cursor: busy ? "default" : "pointer",
          background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--live-ink)",
          fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, opacity: busy ? 0.6 : 1,
        }}>Decline</button>
        <button onClick={onConfirm} disabled={busy} style={{
          flex: 1.5, height: 48, borderRadius: 14, border: "none", cursor: busy ? "default" : "pointer",
          background: "var(--amber)", color: "var(--amber-ink)",
          fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, opacity: busy ? 0.7 : 1,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}><MIcon name="check" size={17} color="var(--amber-ink)" />{busy ? "Confirming…" : "Confirm booking"}</button>
      </div>
    ) : null}>
      {/* hero */}
      <div className="m-card" style={{ padding: "15px 15px", background: "var(--s2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <StatusChip pill={pill} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>
            {o._start ? `${hm(o._start)}–${o._end ? hm(o._end) : ""}` : ""}
          </span>
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 12 }}>{blockTitle(o)}</div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 3 }}>{meta.word}</div>
      </div>

      {/* info rows */}
      <div className="m-card" style={{ padding: "2px 15px", marginTop: 11, background: "var(--s2)" }}>
        <InfoRow icon={meta.icon} k="Resource" v={o.resource_name || "—"} />
        <InfoRow icon="calendar" k="Date" v={dateLabel} />
        {d.kind && <InfoRow icon="grid" k="Type" v={d.kind === "block" ? "Weekly block" : "One-off hire"} />}
        {o.source_kind === "fixture" && <InfoRow icon="whistle" k="Fixture" v={`${d.home_team || "Home"} v ${d.away_team || "Away"}`} />}
        {o.source_kind === "class" && d.instructor && <InfoRow icon="figure" k="Instructor" v={d.instructor} />}
        {o.source_kind === "appointment" && d.trainer_name && <InfoRow icon="figure" k="Trainer" v={d.trainer_name} />}
        {typeof d.attendee_count === "number" && <InfoRow icon="users" k="Attendees" v={String(d.attendee_count)} />}
        <InfoRow icon="pound" k="Payment"
          v={request ? "Due on confirmation" : d.owed ? "Balance due" : (o.source_kind === "booking" || d.status === "confirmed") ? "Settled" : "—"}
          warn={!!d.owed || request} last />
      </div>

      {request && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink3)", margin: "14px 4px 2px", lineHeight: 1.4 }}>
          <MIcon name="info" size={15} color="var(--amber)" style={{ flex: "none" }} />
          Confirming raises the charge and books the slot. Declining frees it up.
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
