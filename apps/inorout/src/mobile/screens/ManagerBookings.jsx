// ManagerBookings.jsx — the Manager's pitch calendar. REUSES the OperatorBookings
// day-view (shared BookingDayGrid) but scoped to ONE team, driven by the manager-gated
// RPC contract (same as the desktop /sessions surface — app↔desktop sync via the shared
// data contract, not a shared component):
//   read   club_manager_pitch_availability  → pitches + busy[] (own sessions flagged is_own)
//   book   club_manager_book_pitch / _series (single / repeat weekly; direct when free,
//                                             held request on a non-bumpable clash)
//   edit   club_manager_update_session      (retime / re-pitch, occupancy-safe)
//   cancel club_manager_cancel_session      (this one)  /  club_manager_cancel_series (block)
//
// Full-screen overlay (not a bottom sheet) so its own book/edit MobileSheets stack cleanly
// on iOS. Booking a free slot is DIRECT for a club on its own ground; a clash is held as a
// request the venue owner approves (Coach-requests inbox).

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  clubManagerListBookableVenues, clubManagerPitchAvailability,
  clubManagerBookPitch, clubManagerBookPitchSeries,
  clubManagerUpdateSession, clubManagerCancelSession, clubManagerCancelSeries,
  clubManagerWithdrawPitchRequest, clubManagerListUpcomingSessions,
  pitchStatusMeta,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";
import BookingDayGrid, { dayKey, hm, fmtHm, londonHM, londonInstantISO, layout, freeGaps, gridWindow } from "../bookingCalendar.jsx";

const LONDON = "Europe/London";
const DURS = [[60, "1h"], [90, "1½h"], [120, "2h"]];
const BOOK_MINS = 60;

export default function ManagerBookings({ teamId, teamName, clubId, onClose, toast }) {
  const [venues, setVenues] = useState([]);
  const [groundId, setGroundId] = useState("");
  const [selKey, setSelKey] = useState(() => dayKey(new Date()));
  const [avail, setAvail] = useState({ loading: false, pitches: [], busy: [] });
  const [pending, setPending] = useState([]);   // own sessions with pitch_status='requested' (hold no occupancy)
  const [sheet, setSheet] = useState(null);   // null | {book, presetStart} | {edit, session} | {view, session}
  const [groundPick, setGroundPick] = useState(false);

  const window21 = useMemo(() => {
    const days = []; const base = new Date();
    for (let i = 0; i < 21; i++) days.push({ key: dayKey(new Date(base.getTime() + i * 86400000)), date: new Date(base.getTime() + i * 86400000) });
    return days;
  }, []);

  // Bookable grounds for this team's club.
  useEffect(() => {
    if (!teamId) return;
    let off = false;
    clubManagerListBookableVenues(teamId)
      .then((res) => { if (off) return; const vs = Array.isArray(res?.venues) ? res.venues : []; setVenues(vs); setGroundId((g) => g || vs[0]?.venue_id || ""); })
      .catch(() => { if (!off) setVenues([]); });
    return () => { off = true; };
  }, [teamId]);

  const loadAvail = useCallback(async () => {
    if (!teamId || !groundId || !selKey) { setAvail({ loading: false, pitches: [], busy: [] }); setPending([]); return; }
    setAvail((s) => ({ ...s, loading: true }));
    try {
      // Availability (occupancy) + the club's session list in parallel. Pending pitch requests
      // hold no occupancy, so they aren't in busy[] — pull them from the session list so the
      // clash→request booking still shows on the calendar (as "pitch being confirmed").
      const [res, sess] = await Promise.all([
        clubManagerPitchAvailability(teamId, groundId, selKey, selKey),
        clubId ? clubManagerListUpcomingSessions(clubId).catch(() => null) : Promise.resolve(null),
      ]);
      setAvail({ loading: false, pitches: Array.isArray(res?.pitches) ? res.pitches : [], busy: Array.isArray(res?.busy) ? res.busy : [] });
      const rows = Array.isArray(sess?.sessions) ? sess.sessions : Array.isArray(sess) ? sess : [];
      setPending(rows.filter((s) => String(s.team_id) === String(teamId) && s.venue_id === groundId
        && s.pitch_status === "requested" && s.scheduled_at && dayKey(new Date(s.scheduled_at)) === selKey));
    } catch {
      setAvail({ loading: false, pitches: [], busy: [] }); setPending([]);
    }
  }, [teamId, groundId, selKey, clubId]);
  useEffect(() => { loadAvail(); }, [loadAvail]);

  const occBlocks = useMemo(() => (avail.busy || []).map((b) => ({
    id: b.session_id || `${b.playing_area_id}-${b.start}`,
    _start: b.start ? new Date(b.start) : null, _end: b.end ? new Date(b.end) : null,
    is_own: !!b.is_own, label: b.label, title: b.title, session_id: b.session_id, series_id: b.series_id,
    pitch_status: b.pitch_status, playing_area_id: b.playing_area_id, duration_mins: b.duration_mins,
  })).filter((b) => b._start && b._end), [avail.busy]);

  const pendingBlocks = useMemo(() => (pending || []).map((s) => {
    const st = new Date(s.scheduled_at);
    return { id: s.session_id, _start: st, _end: new Date(st.getTime() + (s.duration_mins || 60) * 60000),
      is_own: true, is_pending: true, label: s.title, title: s.title, session_id: s.session_id, series_id: s.series_id, pitch_status: "requested" };
  }).filter((b) => b._start && !isNaN(b._start.getTime())), [pending]);

  const laid = useMemo(() => layout([...occBlocks, ...pendingBlocks]), [occBlocks, pendingBlocks]);
  const { startH, endH } = useMemo(() => gridWindow(laid), [laid]);
  const gaps = useMemo(() => freeGaps(occBlocks, startH, endH), [occBlocks, startH, endH]); // occupancy only — a request reserves nothing
  const nowHM = londonHM(new Date());
  const todayKey = dayKey(new Date());
  const showNow = selKey === todayKey && nowHM > startH && nowHM < endH;

  const idx = window21.findIndex((d) => d.key === selKey);
  const selDate = window21.find((d) => d.key === selKey)?.date || new Date();
  const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" }).format(selDate);
  const ground = venues.find((v) => v.venue_id === groundId);

  const renderBlockInner = (e, height) => {
    // own team → green (tappable); same-club team / home fixture → named, neutral stripe;
    // another operator's hire (no label) → grey "In use".
    const named = !!e.label;
    const stripe = e.is_pending ? "var(--amber)" : e.is_own ? "var(--ok)" : named ? "var(--ink2)" : "var(--ink3)";
    return (
      <>
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: stripe }} />
        <div style={{ fontSize: 11.5, fontWeight: 700, color: named ? "var(--ink)" : "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {e.label || "In use"}
        </div>
        {height > 52 && <div style={{ fontSize: 10, color: e.is_pending ? "var(--amber)" : "var(--ink3)", fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{e.is_pending ? "Pitch being confirmed" : `${hm(e._start)}–${hm(e._end)}`}</div>}
      </>
    );
  };

  const onBlockTap = (e) => { if (e.is_own && e.session_id) setSheet({ view: true, session: e }); };
  const onSlotTap = (from) => setSheet({ book: true, presetStart: from });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--bg)", display: "flex", flexDirection: "column", fontFamily: "var(--m-font)" }}>
      {/* header */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "calc(14px + env(safe-area-inset-top)) 14px 8px", borderBottom: "1px solid var(--hair)" }}>
        <button onClick={onClose} aria-label="Back" style={{ width: 38, height: 38, borderRadius: 11, flex: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s2)", border: "1px solid var(--hair)" }}>
          <MIcon name="chevleft" size={18} color="var(--ink2)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em" }}>Pitch calendar</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{teamName || "Your team"}{ground ? ` · ${ground.venue_name}` : ""}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px calc(24px + env(safe-area-inset-bottom, 0px))", WebkitOverflowScrolling: "touch" }}>
        {/* ground switcher */}
        {venues.length > 1 && (
          <button onClick={() => setGroundPick(true)} style={{ width: "100%", padding: "10px 13px", borderRadius: "var(--r-md)", cursor: "pointer", display: "flex", alignItems: "center", gap: 9, background: "var(--s2)", border: "1px solid var(--hair)", marginBottom: 8 }}>
            <MIcon name="pin" size={16} color="var(--amber)" />
            <span style={{ flex: 1, textAlign: "left", fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{ground?.venue_name || "Choose a ground"}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 600 }}>{venues.length} grounds</span>
            <MIcon name="chevdown" size={14} color="var(--ink3)" />
          </button>
        )}

        {/* day stepper */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, height: 40, background: "var(--s2)", border: "1px solid var(--hair)", borderRadius: 12, padding: "0 4px" }}>
          <button onClick={() => idx > 0 && setSelKey(window21[idx - 1].key)} disabled={idx <= 0} aria-label="Previous day" style={stepBtn(idx <= 0)}><MIcon name="chevleft" size={16} color={idx <= 0 ? "var(--ink4)" : "var(--ink2)"} /></button>
          <span style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <MIcon name="calendar" size={14} color="var(--ink3)" />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{shortDate}</span>
            {selKey === todayKey && <span style={{ height: 18, padding: "0 7px", borderRadius: "var(--r-pill)", background: "var(--ok-soft)", color: "var(--ok-ink)", fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center" }}>TODAY</span>}
          </span>
          <button onClick={() => idx < window21.length - 1 && setSelKey(window21[idx + 1].key)} disabled={idx >= window21.length - 1} aria-label="Next day" style={stepBtn(idx >= window21.length - 1)}><MIcon name="chevron" size={16} color={idx >= window21.length - 1 ? "var(--ink4)" : "var(--ink2)"} /></button>
        </div>

        {/* calendar */}
        <div className="m-card" style={{ padding: "14px 12px 12px", marginTop: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, paddingLeft: 2 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>Day view<span style={{ color: "var(--ink3)", fontWeight: 500 }}> · {laid.length} booking{laid.length === 1 ? "" : "s"}</span></div>
            {gaps.length > 0 && <span style={{ fontSize: 12, color: "var(--ok-ink)", fontWeight: 700 }}>{gaps.length} free</span>}
          </div>
          {avail.loading ? (
            <div style={{ fontSize: 13, color: "var(--ink4)", padding: "24px 2px", textAlign: "center" }}>Loading…</div>
          ) : !groundId ? (
            <div style={{ fontSize: 13, color: "var(--ink4)", padding: "24px 2px", textAlign: "center" }}>No bookable grounds for this club yet.</div>
          ) : (
            <BookingDayGrid startH={startH} endH={endH} gaps={gaps} laid={laid} showNow={showNow} nowHM={nowHM}
              onSlotTap={onSlotTap} onBlockTap={onBlockTap} renderBlockInner={renderBlockInner} />
          )}
          <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 11, display: "flex", alignItems: "center", gap: 7, paddingLeft: 2 }}>
            <span style={{ width: 18, height: 18, borderRadius: 6, border: "1.4px dashed var(--hair2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MIcon name="plus" size={11} color="var(--ok-ink)" /></span>
            Tap a free slot to book · tap your session to edit or cancel
          </div>
        </div>

        <button onClick={() => setSheet({ book: true, presetStart: null })} disabled={!groundId} style={{ width: "100%", marginTop: 16, height: 50, borderRadius: 15, border: "none", cursor: groundId ? "pointer" : "default", background: groundId ? "var(--amber)" : "var(--s3)", color: groundId ? "var(--amber-ink)" : "var(--ink3)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
          <MIcon name="plus" size={19} color={groundId ? "var(--amber-ink)" : "var(--ink3)"} />Book a pitch
        </button>
      </div>

      {/* ground picker */}
      {groundPick && (
        <MobileSheet title="Choose a ground" onClose={() => setGroundPick(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {venues.map((v) => {
              const on = v.venue_id === groundId;
              return (
                <button key={v.venue_id} onClick={() => { setGroundId(v.venue_id); setGroundPick(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", cursor: "pointer", textAlign: "left", background: "var(--s2)", borderRadius: "var(--r-md)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 11, background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MIcon name="pin" size={18} color="var(--amber)" /></div>
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{v.venue_name}</span>
                  {on && <MIcon name="check" size={18} color="var(--amber)" />}
                </button>
              );
            })}
          </div>
        </MobileSheet>
      )}

      {/* book / edit sheet */}
      {sheet && (sheet.book || sheet.edit) && (
        <ManagerBookSheet
          teamId={teamId} venueId={groundId} venueName={ground?.venue_name}
          pitches={avail.pitches} dayKeyStr={selKey}
          dayLabel={new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" }).format(selDate)}
          dayBlocks={occBlocks} startH={startH} endH={endH}
          presetStart={sheet.presetStart} editSession={sheet.edit ? sheet.session : null}
          toast={toast}
          onClose={() => setSheet(null)}
          onDone={async () => { setSheet(null); await loadAvail(); }}
        />
      )}

      {/* own-session detail (edit / cancel this / cancel series) */}
      {sheet && sheet.view && (
        <ManagerSessionSheet session={sheet.session} toast={toast}
          onEdit={() => setSheet({ edit: true, session: sheet.session, presetStart: londonHM(sheet.session._start) })}
          onClose={() => setSheet(null)}
          onDone={async () => { setSheet(null); await loadAvail(); }}
        />
      )}
    </div>
  );
}

// ── book (or edit) a team pitch: pick pitch + duration + free start time, optional weekly repeat ──
function ManagerBookSheet({ teamId, venueId, venueName, pitches, dayKeyStr, dayLabel, dayBlocks, startH, endH, presetStart, editSession, toast, onClose, onDone }) {
  const isEdit = !!editSession;
  const [pitch, setPitch] = useState(editSession?.playing_area_id || (pitches.length === 1 ? pitches[0].id : null));
  const [dur, setDur] = useState(editSession?.duration_mins || BOOK_MINS);
  const [start, setStart] = useState(presetStart != null ? Math.round(presetStart * 2) / 2 : null);
  const [title, setTitle] = useState(editSession?.title || "");
  const [repeat, setRepeat] = useState(false);
  const [toDate, setToDate] = useState("");
  const [busy, setBusy] = useState(false);

  // Free start times for the chosen pitch + duration (exclude the session being edited).
  const startOptions = useMemo(() => {
    if (!pitch) return [];
    const ranges = dayBlocks.filter((b) => b.playing_area_id === pitch && !(isEdit && b.session_id === editSession.session_id))
      .map((b) => ({ s: londonHM(b._start), e: londonHM(b._end) })).filter((b) => b.s != null);
    const durH = dur / 60; const out = [];
    for (let t = startH; t <= endH - durH + 1e-6; t += 0.5) {
      const tEnd = t + durH;
      if (!ranges.some((b) => t < b.e - 1e-6 && tEnd > b.s + 1e-6)) out.push(Math.round(t * 2) / 2);
    }
    return out;
  }, [pitch, dur, dayBlocks, startH, endH, isEdit, editSession]);

  useEffect(() => { if (start != null && !startOptions.includes(start)) setStart(null); }, [startOptions]); // eslint-disable-line

  const pitchName = pitches.find((p) => p.id === pitch)?.name || "";
  const timeLabel = start != null ? `${fmtHm(start)}–${fmtHm(start + dur / 60)}` : "";
  const canSave = pitch && start != null && title.trim().length > 0 && !busy && (!repeat || toDate);
  const dow = new Date(`${dayKeyStr}T00:00:00`).getDay();

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const scheduledAt = londonInstantISO(dayKeyStr, fmtHm(start)); // London wall-clock → correct UTC instant
    try {
      if (isEdit) {
        const res = await clubManagerUpdateSession(editSession.session_id, {
          title: title.trim(), scheduledAt, durationMins: dur, venueId, playingAreaId: pitch,
        });
        if (res?.ok === false && res?.reason === "slot_taken") { toast?.({ icon: "alert", text: "That slot was just taken — pick another." }); setBusy(false); return; }
        toast?.({ icon: "check", text: "Booking updated." });
      } else if (repeat) {
        const res = await clubManagerBookPitchSeries(teamId, { venueId, playingAreaId: pitch, title: title.trim(), dayOfWeek: dow, startTime: fmtHm(start), fromDate: dayKeyStr, toDate, sessionType: "training", durationMins: dur });
        const req = Number(res?.requested_count) || 0;
        toast?.({ icon: "check", text: req ? `Weekly booking added — ${req} week${req > 1 ? "s" : ""} awaiting the venue.` : "Weekly booking added." });
      } else {
        const res = await clubManagerBookPitch(teamId, { venueId, playingAreaId: pitch, scheduledAt, title: title.trim(), sessionType: "training", durationMins: dur });
        toast?.({ icon: "check", text: res?.pitch_status === "requested" ? "Booked — pitch being confirmed." : "Pitch booked." });
      }
      await onDone();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't save — try again." });
      setBusy(false);
    }
  };

  return (
    <MobileSheet title={isEdit ? "Edit booking" : "Book a pitch"} onClose={busy ? undefined : onClose} footer={
      <button onClick={save} disabled={!canSave} style={{ width: "100%", height: 50, borderRadius: 15, border: "none", cursor: canSave ? "pointer" : "default", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: canSave ? "var(--amber)" : "var(--s3)", color: canSave ? "var(--amber-ink)" : "var(--ink3)", opacity: busy ? 0.7 : 1 }}>
        {canSave ? <><MIcon name="check" size={17} color="var(--amber-ink)" />{busy ? "Saving…" : (isEdit ? "Save changes" : "Confirm booking")}</>
          : (!pitch ? "Choose a pitch" : start == null ? "Pick a time" : title.trim().length === 0 ? "Name the session" : "Pick an end date")}
      </button>
    }>
      <FieldLabel>Session name</FieldLabel>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. U9 Training" maxLength={80} style={inp} />

      <FieldLabel>Which pitch</FieldLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pitches.map((p) => {
          const on = pitch === p.id;
          return (
            <button key={p.id} onClick={() => setPitch(p.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 13px", borderRadius: 13, cursor: "pointer", textAlign: "left", background: "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)" }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "var(--s3)", display: "flex", alignItems: "center", justifyContent: "center" }}><MIcon name="grid" size={18} color="var(--ink2)" /></span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{p.name}</span>
              {on && <MIcon name="check" size={18} color="var(--amber)" />}
            </button>
          );
        })}
      </div>

      <FieldLabel>Duration</FieldLabel>
      <div style={{ display: "flex", gap: 8 }}>{DURS.map(([m, l]) => <button key={m} onClick={() => setDur(m)} style={chip(dur === m)}>{l}</button>)}</div>

      <FieldLabel>{pitch ? `Free start times · ${pitchName}` : "Start time"}</FieldLabel>
      {!pitch ? <div style={{ fontSize: 13, color: "var(--ink4)", padding: "8px 2px" }}>Choose a pitch first.</div>
        : startOptions.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{startOptions.map((t) => <button key={t} onClick={() => setStart(t)} style={chip(start === t)}>{fmtHm(t)}</button>)}</div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--ink3)", padding: "10px 2px", display: "flex", alignItems: "center", gap: 8 }}><MIcon name="alert" size={15} color="var(--amber)" />No {DURS.find((d) => d[0] === dur)[1]} window free — try a shorter duration.</div>
        )}

      {!isEdit && (
        <>
          <button onClick={() => setRepeat((r) => !r)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", marginTop: 16, padding: "12px 13px", borderRadius: 13, cursor: "pointer", background: "var(--s2)", border: "1px solid", borderColor: repeat ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)", textAlign: "left" }}>
            <span style={{ width: 23, height: 23, borderRadius: 7, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: repeat ? "var(--amber-soft)" : "transparent", boxShadow: repeat ? "inset 0 0 0 1.5px var(--amber)" : "inset 0 0 0 1.5px var(--hair2)" }}>{repeat && <MIcon name="check" size={14} color="var(--amber)" />}</span>
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Repeat weekly</span>
          </button>
          {repeat && (
            <>
              <FieldLabel>Repeat until</FieldLabel>
              <input type="date" value={toDate} min={dayKeyStr} onChange={(e) => setToDate(e.target.value)} style={inp} />
            </>
          )}
        </>
      )}
    </MobileSheet>
  );
}

// ── own-session detail: Edit · Cancel this · Cancel series ──
function ManagerSessionSheet({ session, toast, onEdit, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // null | 'one' | 'series'
  const meta = pitchStatusMeta(session.pitch_status);
  const dateLabel = session._start ? new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" }).format(session._start) : "—";

  const isPending = session.pitch_status === "requested";

  const doCancel = async (series) => {
    setBusy(true);
    try {
      if (series) await clubManagerCancelSeries(session.session_id, null);
      else await clubManagerCancelSession(session.session_id, null);
      toast?.({ icon: "check", text: series ? "Series cancelled." : "Booking cancelled." });
      await onDone();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't cancel — try again." });
      setBusy(false);
    }
  };

  // A pending request holds no pitch yet — the action is to WITHDRAW it (→ pitch TBC),
  // not reschedule (mig 563). The session + its RSVPs stay.
  const doWithdraw = async () => {
    setBusy(true);
    try {
      await clubManagerWithdrawPitchRequest(session.session_id);
      toast?.({ icon: "check", text: "Pitch request withdrawn." });
      await onDone();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't withdraw — try again." });
      setBusy(false);
    }
  };

  return (
    <MobileSheet title="Booking" onClose={busy ? undefined : onClose} footer={
      confirm ? (
        <div style={{ display: "flex", gap: 9 }}>
          <button onClick={() => setConfirm(null)} disabled={busy} style={{ flex: 1, height: 48, borderRadius: 14, cursor: "pointer", background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15 }}>Keep</button>
          <button onClick={() => doCancel(confirm === "series")} disabled={busy} style={{ flex: 1.5, height: 48, borderRadius: 14, border: "none", cursor: busy ? "default" : "pointer", background: "var(--live-soft)", color: "var(--live-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, opacity: busy ? 0.7 : 1 }}>{busy ? "Cancelling…" : (confirm === "series" ? "Yes, cancel series" : "Yes, cancel this")}</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {isPending ? (
            <button onClick={doWithdraw} disabled={busy} style={{ width: "100%", height: 48, borderRadius: 14, border: "none", cursor: "pointer", background: "var(--amber)", color: "var(--amber-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><MIcon name="x" size={16} color="var(--amber-ink)" />{busy ? "Withdrawing…" : "Withdraw pitch request"}</button>
          ) : (
            <button onClick={onEdit} disabled={busy} style={{ width: "100%", height: 48, borderRadius: 14, border: "none", cursor: "pointer", background: "var(--amber)", color: "var(--amber-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><MIcon name="calendar" size={16} color="var(--amber-ink)" />Edit / reschedule</button>
          )}
          <div style={{ display: "flex", gap: 9 }}>
            <button onClick={() => setConfirm("one")} disabled={busy} style={{ flex: 1, height: 46, borderRadius: 14, cursor: "pointer", background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--live-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 14 }}>Cancel this</button>
            {session.series_id && <button onClick={() => setConfirm("series")} disabled={busy} style={{ flex: 1, height: 46, borderRadius: 14, cursor: "pointer", background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--live-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 14 }}>Cancel series</button>}
          </div>
        </div>
      )
    }>
      <div className="m-card" style={{ padding: "15px", background: "var(--s2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {meta?.label ? <span style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", background: "var(--amber-soft)", color: "var(--amber)", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase" }}>{meta.label}</span> : <span style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", background: "var(--ok-soft)", color: "var(--ok-ink)", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase" }}>Booked</span>}
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{session._start ? `${hm(session._start)}–${session._end ? hm(session._end) : ""}` : ""}</span>
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 12 }}>{session.title || "Training"}</div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 3 }}>{dateLabel}{session.series_id ? " · repeats weekly" : ""}</div>
      </div>
      {confirm === "series" && <div style={{ fontSize: 12.5, color: "var(--ink3)", margin: "13px 4px 2px", lineHeight: 1.4, display: "flex", gap: 8 }}><MIcon name="info" size={15} color="var(--amber)" style={{ flex: "none" }} />This cancels every future session in the weekly block and frees each pitch slot.</div>}
    </MobileSheet>
  );
}

function FieldLabel({ children }) { return <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)", margin: "15px 2px 8px" }}>{children}</div>; }
function stepBtn(disabled) { return { width: 34, height: 34, borderRadius: 9, flex: "none", cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", opacity: disabled ? 0.45 : 1 }; }
function chip(on) { return { height: 38, padding: "0 16px", borderRadius: "var(--r-pill)", cursor: "pointer", fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700, background: on ? "var(--amber)" : "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", color: on ? "var(--amber-ink)" : "var(--ink2)" }; }
const inp = { height: 44, padding: "0 13px", borderRadius: 12, background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 14, outline: "none", boxSizing: "border-box", width: "100%" };
