// OperatorBookings.jsx — Operator track, screen 2 ("Bookings"), mounted at /hub
// for an operator role (owner | manager | staff), tab "bookings".
//
// Honest mobile re-presentation of the laptop venue calendar
// (apps/venue/src/views/ResourceCalendar.jsx / ResourceAgenda.jsx) in the scoped
// amber theme. ALL data comes from one existing call —
// getVenueResourceOccupancy(venue_id, from, to) → get_venue_resource_occupancy
// (mig 419): one normalised occupancy[] across pitches + rooms (room hires ∪
// classes) + trainers, plus the resource lanes. No new reader.
//
// AUTH: identical to OperationsTonight — the operator passes their venue_id as the
// credential; resolve_venue_caller stage 1b authenticates via auth.uid() against
// venue_admins. No token, no new RPC.
//
// Request approvals reuse existing writers: venueConfirmBooking /
// venueDeclineBooking (pitch booking requests). Room-hire confirmation needs a
// price (a fuller flow, deferred), and new-booking CREATE (the prototype's
// progressive NewBookingSheet) is deferred to its own cycle — the "+" surfaces a
// "coming soon" toast. Fixtures / classes / club sessions / PT appointments are
// read-only here, faithful to the laptop block modal.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getVenueResourceOccupancy, venueConfirmBooking, venueDeclineBooking,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const LONDON = "Europe/London";

function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Local YYYY-MM-DD key for a Date in the venue's timezone.
function dayKey(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function hm(d) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

// Lane metadata: order + label + icon for the three resource lanes.
const LANES = [
  { key: "pitch",   label: "Pitches",  icon: "grid" },
  { key: "room",    label: "Rooms",    icon: "door" },
  { key: "trainer", label: "Trainers", icon: "figure" },
];

// source_kind → glyph + a short human label for the block.
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

// A pitch booking awaiting operator confirmation — the only inline-actionable kind.
function isPitchRequest(o) {
  return o.source_kind === "booking" && (o.detail?.status === "requested");
}

export default function OperatorBookings({ venueId, venueName, toast }) {
  const [state, setState] = useState({ loading: true, error: false, venue: null });
  const [selKey, setSelKey] = useState(() => dayKey(new Date()));
  const [detail, setDetail] = useState(null);          // occupancy item or null
  const [busy, setBusy] = useState({});                // source_id → bool

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
      return {
        ...o,
        _key: start ? dayKey(start) : null,
        _start: start, _end: end,
        _lane: o.resource_type || "pitch",
      };
    }).filter((o) => o._key);
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
  const dayBlocks = blocks.filter((b) => b._key === selKey).sort((a, b) => (a._start - b._start));
  const dayRequests = dayBlocks.filter(isPitchRequest);
  const laneGroups = LANES.map((ln) => ({
    ...ln, items: dayBlocks.filter((b) => b._lane === ln.key && !isPitchRequest(b)),
  })).filter((g) => g.items.length);

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
              border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)",
              fontFamily: "var(--m-font)",
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

      {/* ── selected-day heading ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "16px 2px 4px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)" }}>
          {new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" }).format(window14.find((d) => d.key === selKey)?.date || new Date())}
        </h2>
        <button onClick={() => toast?.({ icon: "plus", text: "New booking — coming soon", sub: "Use the venue dashboard for now" })}
          aria-label="New booking" style={{
            flex: "none", width: 34, height: 34, borderRadius: 11, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--amber-soft)", border: "1px solid var(--amber-glow)",
          }}><MIcon name="plus" size={18} color="var(--amber)" /></button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 600, margin: "0 2px 4px" }}>
        {dayBlocks.length ? `${dayBlocks.length} booking${dayBlocks.length === 1 ? "" : "s"}` : "No bookings"}
        {dayRequests.length ? ` · ${dayRequests.length} awaiting confirmation` : ""}
      </div>

      {/* ── requests ── */}
      {dayRequests.length > 0 && (
        <>
          <div className="m-eyebrow" style={{ margin: "16px 2px 9px" }}>Awaiting confirmation</div>
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

      {/* ── lanes ── */}
      {laneGroups.map((g) => (
        <div key={g.key}>
          <div className="m-eyebrow" style={{ margin: "18px 2px 9px", display: "flex", alignItems: "center", gap: 7 }}>
            <MIcon name={g.icon} size={14} color="var(--ink3)" />{g.label}
            <span style={{ color: "var(--ink4)", fontWeight: 700 }}>{g.items.length}</span>
          </div>
          {g.items.map((o) => (
            <BlockCard key={o.id} o={o} onOpen={() => setDetail(o)} />
          ))}
        </div>
      ))}

      {/* ── empty ── */}
      {dayBlocks.length === 0 && (
        <div className="m-card" style={{ padding: "28px 18px", textAlign: "center", marginTop: 8 }}>
          <MIcon name="calendar" size={28} color="var(--ink3)" />
          <div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 10, color: "var(--ink2)" }}>Nothing booked</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 3 }}>No pitches, rooms or trainers are booked this day.</div>
        </div>
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

// Status pill text + tone for a block.
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

function BlockCard({ o, onOpen }) {
  const meta = KIND_META[o.source_kind] || KIND_META.booking;
  const pill = statusPill(o);
  return (
    <button onClick={onOpen} className="m-card" style={{
      width: "100%", textAlign: "left", cursor: "pointer", padding: "12px 14px", marginBottom: 10,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ width: 46, flex: "none", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--ink)" }}>{o._start ? hm(o._start) : "—"}</div>
        <div style={{ fontSize: 11, color: "var(--ink4)", marginTop: 1 }}>{o._end ? hm(o._end) : ""}</div>
      </div>
      <div style={{ width: 34, height: 34, borderRadius: 10, flex: "none", background: "var(--s3)",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        <MIcon name={meta.icon} size={17} color="var(--ink2)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{blockTitle(o)}</div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[meta.word, o.resource_name].filter(Boolean).join(" · ")}
        </div>
      </div>
      <StatusChip pill={pill} />
    </button>
  );
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
