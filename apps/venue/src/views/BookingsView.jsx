import React, { useState, useMemo, useEffect, useCallback } from "react";
import { getOperatorPitchOccupancy, getVenueResourceOccupancy, getEquipmentAvailability, venueListPitchReservedWindows, venueListBumpProposals, venueListCoachRequests, venueListClassTypes, venueListAdmins, venueListMembers, venueListTrainers } from "@platform/core";
import RequestsInbox from "./RequestsInbox.jsx";
import CoachRequestsInbox from "./CoachRequestsInbox.jsx";
import BumpProposalsBanner from "./BumpProposalsBanner.jsx";
import ScheduleGrid from "./ScheduleGrid.jsx";
import AllGroundsGrid from "./AllGroundsGrid.jsx";
import ResourceCalendar from "./ResourceCalendar.jsx";
import ResourceAgenda from "./ResourceAgenda.jsx";
import EquipmentStrip from "./EquipmentStrip.jsx";
import ResourceBlockModal from "./ResourceBlockModal.jsx";
import { CreateSessionModal as ClassSessionModal } from "./ClassesView.jsx";
import Modal from "./Modal.jsx";
import RoomHireModal from "./RoomHireModal.jsx";
import AppointmentModal from "./AppointmentModal.jsx";
import DayAgenda from "./DayAgenda.jsx";
import WalkInModal from "./WalkInModal.jsx";
import BookingSettings from "./BookingSettings.jsx";
import BookingDetailModal from "./BookingDetailModal.jsx";
import CancellationsLog from "./CancellationsLog.jsx";
import CalendarFilters from "./CalendarFilters.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { todayIso, addDays, fmtDayLabel, isOnDate, occLabel, occTypeKey, occIsFirst, occBounds, parseHHMM, minsOfDay } from "../bookingUtil.js";

const EMPTY_FILTERS = { paid: false, owed: false, oneoff: false, block: false, league: false, training: false, match: false, maint: false, pending: false, isnew: false, free: false, room: false, class: false, pt: false };

// Which resource lanes the "Show" switcher exposes on the unified calendar.
const RESOURCE_MODES = [
  { key: "pitches", label: "Pitches", types: ["pitch"] },
  { key: "rooms", label: "Rooms", types: ["room"] },
  { key: "trainers", label: "Trainers", types: ["trainer"] },
  { key: "all", label: "All", types: ["pitch", "room", "trainer"] },
];

// Does a unified-calendar block pass the active resource filters (search + Room/Class/PT chips)?
function resourcePasses(o, f, q) {
  const query = q.trim().toLowerCase();
  if (query && !occLabel(o).toLowerCase().includes(query)) return false;
  if (f.room || f.class || f.pt) {
    const key = occTypeKey(o);
    const match = (f.room && key === "room") || (f.class && key === "class") || (f.pt && key === "pt");
    if (!match) return false;
  }
  return true;
}

// Does an occupancy block pass the active calendar filters? (q = search, hidden = pitch hide.)
function occPasses(o, f, q, hidden) {
  if (hidden.has(o.playing_area_id)) return false;
  const query = q.trim().toLowerCase();
  if (query && !occLabel(o).toLowerCase().includes(query)) return false;

  const owed = !!o.detail?.owed;
  const pending = o.detail?.status === "requested";
  const key = occTypeKey(o);

  if (f.paid || f.owed) {
    const matchPay = (f.paid && !owed && o.source_kind !== "maintenance") || (f.owed && owed);
    if (!matchPay) return false;
  }
  if (f.oneoff || f.block || f.league || f.training || f.match || f.maint) {
    const matchType = (f.oneoff && key === "oneoff") || (f.block && key === "block")
      || (f.league && key === "league") || (f.training && key === "training")
      || (f.match && key === "match") || (f.maint && key === "maint");
    if (!matchType) return false;
  }
  if (f.pending && !pending) return false;
  if (f.isnew && !occIsFirst(o)) return false;
  return true;
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

// Group pending booking occupancy rows into inbox items (a weekly block = one item).
function buildPendingGroups(occupancy) {
  const groups = new Map();
  for (const o of occupancy) {
    if (o.source_kind !== "booking" || o.detail?.status !== "requested") continue;
    const key = o.detail.series_id ? `s:${o.detail.series_id}` : `b:${o.source_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        seriesId: o.detail.series_id || null,
        kind: o.detail.kind,
        teamName: o.detail.team_name || "Walk-in",
        pitchName: o.pitch_name,
        bookingIds: [],
        starts: [],
      });
    }
    const g = groups.get(key);
    g.bookingIds.push(o.source_id);
    g.starts.push(o.start);
  }
  return [...groups.values()].map((g) => ({ ...g, starts: g.starts.sort() }))
    .sort((a, b) => a.starts[0]?.localeCompare(b.starts[0] ?? "") ?? 0);
}

export default function BookingsView({ state, venueToken, occupancy = [], bookingIns = {}, onRefresh, onRefreshOccupancy }) {
  const venue = state.venue ?? {};
  const enabled = !!venue.bookings_enabled;
  const pitches = useMemo(() => (state.pitches ?? []).filter((p) => p.active), [state.pitches]);
  const isMobile = useIsMobile();
  const selfVenueId = venue.id ?? state.venue?.id;

  // ── Cross-site: occupancy + pitches for EVERY venue this operator runs ──────
  // A ground switcher lets the operator view any of their sites' calendars on one
  // screen. The home venue stays fully interactive; other sites are view-only
  // (booking needs that venue's own console/token).
  const [operatorVenues, setOperatorVenues] = useState([]);
  const [selectedVenueId, setSelectedVenueId] = useState(null);
  const loadOperator = useCallback(async () => {
    try {
      const res = await getOperatorPitchOccupancy(venueToken, todayIso(), addDays(todayIso(), 90));
      setOperatorVenues(Array.isArray(res?.venues) ? res.venues : []);
    } catch (err) {
      console.error("get_operator_pitch_occupancy failed", err);
      setOperatorVenues([]);
    }
  }, [venueToken]);
  useEffect(() => { loadOperator(); }, [loadOperator]);

  // ── Reserved windows (pitch priority Phase 1): one company-scoped read → a
  // pitchId→[window] map that shades both grids and feeds the settings editor.
  // Advisory only — these hold no pitch, block nothing (enforcement is Phase 2).
  const [reservedByPitch, setReservedByPitch] = useState(() => new Map());
  const loadReserved = useCallback(async () => {
    try {
      const res = await venueListPitchReservedWindows(venueToken);
      const map = new Map();
      for (const w of (res?.windows ?? [])) {
        if (!map.has(w.playing_area_id)) map.set(w.playing_area_id, []);
        map.get(w.playing_area_id).push(w);
      }
      setReservedByPitch(map);
    } catch (err) {
      console.error("venue_list_pitch_reserved_windows failed", err);
      setReservedByPitch(new Map());
    }
  }, [venueToken]);
  useEffect(() => { loadReserved(); }, [loadReserved]);

  // ── Bump proposals (pitch priority Phase 3): pending suggested relocations for any
  // club team bumped off a contested slot across this operator's grounds. The operator
  // can Accept (move the event onto the suggested slot) or Decline on the team's behalf.
  const [bumpProposals, setBumpProposals] = useState([]);
  const loadBumps = useCallback(async () => {
    try {
      const res = await venueListBumpProposals(venueToken);
      setBumpProposals(Array.isArray(res?.proposals) ? res.proposals : []);
    } catch (err) {
      console.error("venue_list_bump_proposals failed", err);
      setBumpProposals([]);
    }
  }, [venueToken]);
  useEffect(() => { loadBumps(); }, [loadBumps]);
  // Accepting moves the event (occupancy changes); always refetch the calendar too.
  const onBumpResolved = useCallback((opts) => {
    loadBumps();
    if (!opts?.soft) { onRefreshOccupancy?.(); loadOperator(); }
  }, [loadBumps, onRefreshOccupancy, loadOperator]);

  // ── Coach pitch requests (PR #5): club coaches who booked a pitch and hit a
  // non-bumpable clash are held as pitch_status='requested' (no occupancy → not on the
  // grid). The owner Approves (re-reserve) or Declines them from a dedicated inbox lane.
  const [coachRequests, setCoachRequests] = useState([]);
  const loadCoachRequests = useCallback(async () => {
    try {
      const res = await venueListCoachRequests(venueToken);
      setCoachRequests(Array.isArray(res?.requests) ? res.requests : []);
    } catch (err) {
      console.error("venue_list_coach_requests failed", err);
      setCoachRequests([]);
    }
  }, [venueToken]);
  useEffect(() => { loadCoachRequests(); }, [loadCoachRequests]);
  // Approve reserves occupancy (or bumps) → refetch the calendar too.
  const onCoachRequestResolved = useCallback(() => {
    loadCoachRequests(); onRefreshOccupancy?.(); loadOperator(); loadBumps();
  }, [loadCoachRequests, onRefreshOccupancy, loadOperator, loadBumps]);

  // ── Unified resource calendar (Phase 1, read-only): one "Show" switcher lays
  // pitches / rooms / trainers (and an equipment strip) across EVERY operator venue.
  // Pitch mode keeps the existing pitch console untouched; the other modes render the
  // read-only ResourceCalendar fed by get_venue_resource_occupancy.
  const [resourceMode, setResourceMode] = useState("pitches");
  const isUnified = resourceMode !== "pitches";
  const activeTypes = useMemo(() => RESOURCE_MODES.find((m) => m.key === resourceMode)?.types ?? ["pitch"], [resourceMode]);

  const [resourceVenues, setResourceVenues] = useState([]);
  const loadResources = useCallback(async () => {
    try {
      const res = await getVenueResourceOccupancy(venueToken, todayIso(), addDays(todayIso(), 90));
      setResourceVenues(Array.isArray(res?.venues) ? res.venues : []);
    } catch (err) {
      console.error("get_venue_resource_occupancy failed", err);
      setResourceVenues([]);
    }
  }, [venueToken]);
  useEffect(() => { if (isUnified) loadResources(); }, [isUnified, loadResources]);

  // Reference data for the calendar tap-to-book modals (reuses existing screens). Class types
  // + instructors power the class-session create; members + trainers power the Phase-2b room
  // hire + appointment create. Loaded once when the unified calendar is open.
  const [classTypes, setClassTypes] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [members, setMembers] = useState([]);
  const [trainers, setTrainers] = useState([]);
  useEffect(() => {
    if (!isUnified) return;
    let cancelled = false;
    (async () => {
      try {
        const [tps, ad, mem, trn] = await Promise.all([
          venueListClassTypes(venueToken), venueListAdmins(venueToken),
          venueListMembers(venueToken), venueListTrainers(venueToken),
        ]);
        if (cancelled) return;
        setClassTypes((Array.isArray(tps) ? tps : []).filter((t) => t.is_active));
        setInstructors((ad?.admins ?? []).filter((a) => a.status === "active"));
        setMembers(Array.isArray(mem) ? mem : []);
        setTrainers((trn?.trainers ?? []).filter((t) => t.active));
      } catch (err) {
        console.error("load refs for calendar booking failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, [isUnified, venueToken]);
  // Calendar tap-to-book targets. Room tap → a chooser (class | hire); trainer tap → appointment.
  const [classCreate, setClassCreate] = useState(null);   // { spaceId, startsAt }
  const [roomChoice, setRoomChoice] = useState(null);     // { spaceId, startsAt } — chooser open
  const [roomHireCreate, setRoomHireCreate] = useState(null); // { spaceId, startsAt }
  const [apptCreate, setApptCreate] = useState(null);     // { trainerId, startsAt }

  const [equipment, setEquipment] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);

  // View preference (Grid = time-aligned calendar / Agenda = denser per-resource list),
  // persisted so the operator's choice sticks. Mobile always uses Agenda (columns can't fit).
  const [calendarView, setCalendarView] = useState(() => {
    try { return localStorage.getItem("venueCalView") || "grid"; } catch { return "grid"; }
  });
  const setView = (v) => { setCalendarView(v); try { localStorage.setItem("venueCalView", v); } catch { /* ignore */ } };
  // Grid hides resources with no booking that day by default; this reveals every lane.
  const [showAllResources, setShowAllResources] = useState(false);
  // Unified modes give the calendar the screen; this reveals the Requests inbox +
  // Cancellations log on demand (they're always shown in pitch mode).
  const [showAdmin, setShowAdmin] = useState(false);

  const hasMultiVenue = operatorVenues.length > 1;
  const ALL_GROUNDS = "__all__";
  const isAll = selectedVenueId === ALL_GROUNDS;
  const isSelf = !isAll && (!selectedVenueId || selectedVenueId === selfVenueId);
  const selectedVenue = isAll ? null : operatorVenues.find((v) => v.venue_id === selectedVenueId) || null;

  // All-grounds: flatten every operator venue's pitches + occupancy so the existing
  // filter / day-window / no-match math operates across all sites unchanged.
  const allVenuePitches = useMemo(() => operatorVenues.flatMap((v) => v.pitches ?? []), [operatorVenues]);
  const allVenueOcc = useMemo(() => operatorVenues.flatMap((v) => v.occupancy ?? []), [operatorVenues]);

  const activePitches = useMemo(
    () => (isAll ? allVenuePitches : isSelf ? pitches : (selectedVenue?.pitches ?? [])),
    [isAll, allVenuePitches, isSelf, pitches, selectedVenue],
  );
  const activeOccupancy = isAll ? allVenueOcc : isSelf ? occupancy : (selectedVenue?.occupancy ?? []);
  const canBookHere = enabled && isSelf;

  const [date, setDate] = useState(todayIso());
  const [mobilePitchId, setMobilePitchId] = useState(null);
  const [walkIn, setWalkIn] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [cancelKey, setCancelKey] = useState(0); // bump to reload the cancellations log

  // Equipment availability for the visible day (unified mode only) — quantity strip.
  useEffect(() => {
    if (!isUnified) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getEquipmentAvailability(venueToken, `${date}T00:00:00`, `${addDays(date, 1)}T00:00:00`);
        if (!cancelled) setEquipment(Array.isArray(res?.equipment) ? res.equipment : []);
      } catch (err) {
        console.error("get_equipment_availability failed", err);
        if (!cancelled) setEquipment([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isUnified, venueToken, date]);

  useEffect(() => {
    if (!mobilePitchId && activePitches.length) setMobilePitchId(activePitches[0].id);
  }, [activePitches, mobilePitchId]);
  // Reset the mobile pitch picker when switching grounds.
  useEffect(() => { setMobilePitchId(null); }, [selectedVenueId]);

  // ── calendar filters ──────────────────────────────────────────────────────
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterQ, setFilterQ] = useState("");
  const [hiddenPitches, setHiddenPitches] = useState(() => new Set());
  const toggleFilter = (k) => setFilters((s) => ({ ...s, [k]: !s[k] }));
  const togglePitch = (id) => setHiddenPitches((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setFilterQ(""); setHiddenPitches(new Set()); };

  const pendingGroups = useMemo(() => buildPendingGroups(occupancy), [occupancy]);
  const dayOcc = useMemo(() => activeOccupancy.filter((o) => isOnDate(o.start, date)), [activeOccupancy, date]);
  const visibleOcc = useMemo(
    () => dayOcc.filter((o) => occPasses(o, filters, filterQ, hiddenPitches)),
    [dayOcc, filters, filterQ, hiddenPitches],
  );
  const visiblePitches = useMemo(() => activePitches.filter((p) => !hiddenPitches.has(p.id)), [activePitches, hiddenPitches]);
  // All-grounds: each venue with its non-hidden pitches; venues with none drop out.
  const visibleVenues = useMemo(
    () => operatorVenues
      .map((v) => ({ ...v, pitches: (v.pitches ?? []).filter((p) => !hiddenPitches.has(p.id)) }))
      .filter((v) => v.pitches.length > 0),
    [operatorVenues, hiddenPitches],
  );

  // Free-slots mode shows availability (booked blocks stripped); any content chip
  // (payment/type/pending/new/search) collapses the calendar to just the matches.
  const freeMode = filters.free;
  const contentActive = filters.paid || filters.owed || filters.oneoff || filters.block
    || filters.league || filters.training || filters.match || filters.maint || filters.pending || filters.isnew || !!filterQ.trim();
  const pitchOcc = useMemo(() => dayOcc.filter((o) => !hiddenPitches.has(o.playing_area_id)), [dayOcc, hiddenPitches]);
  const gridOcc = freeMode ? pitchOcc : visibleOcc;           // free mode needs real bookings for gap calc
  const windowOverride = useMemo(
    () => (!freeMode && contentActive ? occBounds(visibleOcc) : null),
    [freeMode, contentActive, visibleOcc],
  );
  const noMatches = !freeMode && contentActive && visibleOcc.length === 0;

  // ── Unified resource calendar derived state ───────────────────────────────
  const resourceDayOcc = useMemo(() => {
    const out = [];
    for (const v of resourceVenues) {
      for (const o of (v.occupancy ?? [])) {
        if (!activeTypes.includes(o.resource_type)) continue;
        if (!isOnDate(o.start, date)) continue;
        if (!resourcePasses(o, filters, filterQ)) continue;
        out.push(o);
      }
    }
    return out;
  }, [resourceVenues, activeTypes, date, filters, filterQ]);
  const resourceContentActive = filters.room || filters.class || filters.pt || !!filterQ.trim();
  // Drop venues with no active-type lanes so empty bands don't render.
  const resourceVisibleVenues = useMemo(
    () => resourceVenues.filter((v) =>
      activeTypes.some((t) => ((t === "pitch" ? v.pitches : t === "room" ? v.rooms : v.trainers) ?? []).length > 0)),
    [resourceVenues, activeTypes],
  );

  // Mobile can't fit calendar columns → always Agenda. Desktop honours the saved choice.
  const viewMode = isMobile ? "agenda" : calendarView;

  // CONSTANT day window (minutes) for the grid — derived from the venue's pitch opening
  // hours, never from the selected day's bookings, so the calendar is the SAME height every
  // day and under every filter (no more resizing). Floors to whole hours, min 07:00–23:00.
  const resourceWindow = useMemo(() => {
    let lo = 7 * 60, hi = 23 * 60;
    for (const p of (state.pitches ?? [])) {
      for (const w of (p.booking_windows ?? [])) {
        lo = Math.min(lo, parseHHMM(w.open_time));
        hi = Math.max(hi, parseHHMM(w.close_time));
      }
    }
    return { startMin: Math.floor(lo / 60) * 60, endMin: Math.ceil(hi / 60) * 60 };
  }, [state.pitches]);

  // Now-line position (minutes) when the selected day is today and within the window.
  const nowMin = useMemo(() => {
    if (date !== todayIso()) return null;
    const m = minsOfDay(new Date().toISOString());
    return m >= resourceWindow.startMin && m <= resourceWindow.endMin ? m : null;
  }, [date, resourceWindow]);

  // Grid: hide resources with no booking this day unless "Show all" is on.
  const bookedIds = useMemo(() => new Set(resourceDayOcc.map((o) => o.resource_id)), [resourceDayOcc]);
  const resourceGridVenues = useMemo(() => {
    if (showAllResources) return resourceVisibleVenues;
    return resourceVisibleVenues
      .map((v) => ({
        ...v,
        pitches: (v.pitches ?? []).filter((p) => bookedIds.has(p.id)),
        rooms: (v.rooms ?? []).filter((r) => bookedIds.has(r.id)),
        trainers: (v.trainers ?? []).filter((t) => bookedIds.has(t.id)),
      }))
      .filter((v) => (v.pitches.length + v.rooms.length + v.trainers.length) > 0);
  }, [resourceVisibleVenues, showAllResources, bookedIds]);

  const afterWrite = () => { onRefreshOccupancy?.(); loadOperator(); loadBumps(); loadCoachRequests(); setCancelKey((k) => k + 1); };
  const addBooking = () => setWalkIn({ pitchId: pitches[0]?.id, time: "19:00" });

  // Own-site rooms (id + name) for the room-hire modal's room picker.
  const selfRooms = useMemo(
    () => resourceVenues.filter((v) => v.is_self).flatMap((v) => v.rooms ?? []),
    [resourceVenues],
  );

  // Unified-calendar tap-to-book: route an empty-slot tap to the right flow per lane. Only
  // own-site pitch/room/trainer lanes are bookable, so foreign lanes never reach here.
  //   pitch → WalkInModal; room → chooser (class | hire); trainer → AppointmentModal.
  const onResourceBook = (resourceType, resourceId, hhmm) => {
    if (resourceType === "pitch") {
      setWalkIn({ pitchId: resourceId, time: hhmm || "19:00" });
    } else if (resourceType === "room") {
      setRoomChoice({ spaceId: resourceId, startsAt: `${date}T${hhmm || "18:00"}` });
    } else if (resourceType === "trainer") {
      setApptCreate({ trainerId: resourceId, startsAt: `${date}T${hhmm || "10:00"}` });
    }
  };

  return (
    <div className="bookings">
      {!enabled && (
        <div className="banner banner-warn">
          <strong>Bookings are off.</strong> Casual teams can't find or request this venue.
          <span className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={() => setSettingsOpen(true)}>Turn on bookings</button>
        </div>
      )}

      <BumpProposalsBanner venueToken={venueToken} proposals={bumpProposals} onResolved={onBumpResolved} />

      {(!isUnified || showAdmin) && (
      <section style={{ marginBottom: "var(--gap-3)" }}>
        <SectionHead label="Requests" count={pendingGroups.length + coachRequests.length}>
          <button className="btn btn-sm btn-ghost" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={14} /> Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={addBooking} disabled={!pitches.length || !isSelf}>
            <Icon name="plus" size={14} /> Add booking
          </button>
        </SectionHead>
        {coachRequests.length > 0 && (
          <CoachRequestsInbox requests={coachRequests} venueToken={venueToken} onChanged={onCoachRequestResolved} />
        )}
        <RequestsInbox groups={pendingGroups} venueToken={venueToken} onChanged={afterWrite} />
      </section>
      )}

      <section>
        <SectionHead label="Schedule">
          {date !== todayIso() && (
            <button className="btn btn-sm" onClick={() => setDate(todayIso())}>Jump to today</button>
          )}
        </SectionHead>
        <div className="schedule">
            <div className="schedule-head">
              <span className="nav">
                <button className="btn btn-xs btn-icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><Icon name="chevron_l" size={14} /></button>
                <button className="btn btn-xs btn-icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><Icon name="chevron_r" size={14} /></button>
              </span>
              <span className="date">{fmtDayLabel(date)}</span>
              <span style={{ flex: 1 }} />
              <span className="res-switch" role="group" aria-label="Show resource type">
                {RESOURCE_MODES.map((m) => (
                  <button key={m.key} className={"btn btn-xs" + (resourceMode === m.key ? " btn-primary" : "")} onClick={() => setResourceMode(m.key)}>{m.label}</button>
                ))}
              </span>
              {isUnified && !isMobile && (
                <span className="res-switch" role="group" aria-label="Calendar view">
                  <button className={"btn btn-xs" + (calendarView === "grid" ? " btn-primary" : "")} onClick={() => setView("grid")} title="Time-aligned calendar">Grid</button>
                  <button className={"btn btn-xs" + (calendarView === "agenda" ? " btn-primary" : "")} onClick={() => setView("agenda")} title="Compact per-resource list">Agenda</button>
                </span>
              )}
              {isUnified && (
                <button
                  className={"btn btn-xs" + (showAdmin ? " btn-primary" : "")}
                  onClick={() => setShowAdmin((s) => !s)}
                  aria-pressed={showAdmin}
                  title="Show the requests inbox and cancellations log"
                >
                  <Icon name="bell" size={13} /> Requests &amp; cancellations{(pendingGroups.length + coachRequests.length) ? ` (${pendingGroups.length + coachRequests.length})` : ""}
                </button>
              )}
              {!isUnified && hasMultiVenue && (
                <span className="ground-switch" title="View another of your grounds">
                  <Icon name="spaces" size={14} />
                  <select
                    value={selectedVenueId ?? selfVenueId ?? ""}
                    onChange={(e) => setSelectedVenueId(e.target.value)}
                    aria-label="Choose ground"
                  >
                    <option value={ALL_GROUNDS}>All grounds</option>
                    {operatorVenues.map((v) => (
                      <option key={v.venue_id} value={v.venue_id}>
                        {v.venue_name}{v.is_self ? " (this site)" : ""}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </div>
            {isUnified ? (
              <>
                <div className="banner banner-info ground-readonly">
                  Showing <strong>all your resources</strong> across every site. Tap an empty slot on this site's pitches or rooms to book; other sites are view-only.
                </div>
                <CalendarFilters
                  resourceChips
                  pitches={[]}
                  hiddenPitches={hiddenPitches}
                  onTogglePitch={togglePitch}
                  q={filterQ}
                  onQ={setFilterQ}
                  f={filters}
                  onToggle={toggleFilter}
                  onClear={clearFilters}
                  isMobile={isMobile}
                />
                {resourceVisibleVenues.length === 0 ? (
                  <EmptyState title="Nothing to show yet" body="No rooms, classes or trainers are set up for your venues." />
                ) : resourceContentActive && resourceDayOcc.length === 0 ? (
                  <EmptyState title="No matches" body="Nothing on this day fits the current filters." />
                ) : viewMode === "agenda" ? (
                  resourceDayOcc.length === 0 ? (
                    <EmptyState title="Nothing booked" body="No bookings on this day. Switch to Grid to see empty lanes." />
                  ) : (
                    <ResourceAgenda
                      venues={resourceVisibleVenues}
                      dayOcc={resourceDayOcc}
                      activeTypes={activeTypes}
                      onSelectBlock={setSelectedBlock}
                      onBook={onResourceBook}
                    />
                  )
                ) : (
                  <>
                    <div className="cal-toolbar">
                      <button
                        className={"cal-chip" + (showAllResources ? " is-active" : "")}
                        onClick={() => setShowAllResources((s) => !s)}
                        aria-pressed={showAllResources}
                      >
                        {showAllResources ? "Showing all lanes" : "Show all resources"}
                      </button>
                    </div>
                    {resourceGridVenues.length === 0 ? (
                      <EmptyState title="Nothing booked" body="No bookings on this day. Tap “Show all resources” to see every empty lane." />
                    ) : (
                      <ResourceCalendar
                        date={date}
                        venues={resourceGridVenues}
                        dayOcc={resourceDayOcc}
                        activeTypes={activeTypes}
                        windowOverride={resourceWindow}
                        nowMin={nowMin}
                        fixedHeight
                        onSelectBlock={setSelectedBlock}
                        onBook={onResourceBook}
                      />
                    )}
                  </>
                )}
                <EquipmentStrip items={equipment} dayLabel={fmtDayLabel(date)} pinned />
              </>
            ) : activePitches.length === 0 ? (
              <EmptyState title="No active pitches" body={isSelf ? "Add a pitch in Operations first." : "This site has no active pitches."} />
            ) : (
              <>
            {!isSelf && !isAll && (
              <div className="banner banner-info ground-readonly">
                Viewing <strong>{selectedVenue?.venue_name}</strong> — view-only for now. You can add bookings on your own ground.
              </div>
            )}
            {isAll && (
              <div className="banner banner-info ground-readonly">
                <strong>All your grounds</strong> on one calendar. You can add bookings on your own ground here; other grounds are view-only for now.
              </div>
            )}
            <CalendarFilters
              pitches={activePitches}
              hiddenPitches={hiddenPitches}
              onTogglePitch={togglePitch}
              q={filterQ}
              onQ={setFilterQ}
              f={filters}
              onToggle={toggleFilter}
              onClear={clearFilters}
              isMobile={isMobile}
            />
            {isAll ? (
              noMatches ? (
                <EmptyState title="No bookings match" body="Nothing on this day fits the current filters." />
              ) : visibleVenues.length === 0 ? (
                <EmptyState title="No pitches shown" body="All pitches are hidden by the filter." />
              ) : (
                <AllGroundsGrid
                  date={date}
                  venues={visibleVenues}
                  dayOcc={gridOcc}
                  bookingIns={bookingIns}
                  canBookSelf={enabled}
                  windowOverride={windowOverride}
                  freeMode={freeMode}
                  reservedByPitch={reservedByPitch}
                  onTapEmpty={(pitchId, time) => setWalkIn({ pitchId, time })}
                  onSelectBooking={setSelectedBooking}
                />
              )
            ) : isMobile ? (
              <DayAgenda
                date={date}
                pitches={activePitches}
                pitchId={mobilePitchId}
                onPitchChange={setMobilePitchId}
                dayOcc={gridOcc}
                bookingIns={bookingIns}
                canBook={canBookHere}
                windowOverride={windowOverride}
                freeMode={freeMode}
                onTapEmpty={(pitchId, time) => setWalkIn({ pitchId, time })}
                onSelectBooking={setSelectedBooking}
              />
            ) : visiblePitches.length === 0 ? (
              <EmptyState title="No pitches shown" body="All pitches are hidden by the filter." />
            ) : noMatches ? (
              <EmptyState title="No bookings match" body="Nothing on this day fits the current filters." />
            ) : (
              <ScheduleGrid
                date={date}
                pitches={visiblePitches}
                dayOcc={gridOcc}
                bookingIns={bookingIns}
                canBook={canBookHere}
                windowOverride={windowOverride}
                freeMode={freeMode}
                reservedByPitch={reservedByPitch}
                onTapEmpty={(pitchId, time) => setWalkIn({ pitchId, time })}
                onSelectBooking={setSelectedBooking}
              />
            )}
              </>
            )}
          </div>
      </section>

      <WalkInModal
        open={!!walkIn}
        onClose={() => setWalkIn(null)}
        venueToken={venueToken}
        venueId={venue?.id ?? state.venue?.id}
        date={date}
        pitches={pitches}
        teams={state.teams ?? {}}
        prefill={walkIn}
        reservedByPitch={reservedByPitch}
        onCreated={() => { setWalkIn(null); afterWrite(); }}
      />
      <BookingSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        venueToken={venueToken}
        venue={venue}
        pitches={state.pitches ?? []}
        reservedByPitch={reservedByPitch}
        onReservedSaved={loadReserved}
        onSaved={() => { onRefresh?.(); }}
      />
      <BookingDetailModal
        open={!!selectedBooking}
        occ={selectedBooking}
        venue={venue}
        ins={selectedBooking ? bookingIns[selectedBooking.source_id] : null}
        venueToken={venueToken}
        onClose={() => setSelectedBooking(null)}
        onChanged={() => { setSelectedBooking(null); afterWrite(); }}
      />
      <ResourceBlockModal
        open={!!selectedBlock}
        occ={selectedBlock}
        onClose={() => setSelectedBlock(null)}
      />
      {classCreate && (
        <ClassSessionModal
          venueToken={venueToken}
          types={classTypes.filter((t) => t.space_id === classCreate.spaceId)}
          instructors={instructors}
          initialStartsAt={classCreate.startsAt}
          onClose={() => setClassCreate(null)}
          onDone={() => { setClassCreate(null); loadResources(); afterWrite(); }}
        />
      )}

      {/* Room tap → pick what to put in the slot: a scheduled class or an ad-hoc room hire. */}
      <Modal
        open={!!roomChoice}
        onClose={() => setRoomChoice(null)}
        title="Book this room"
      >
        <p className="bk-modal-note">What would you like to add to this slot?</p>
        <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={() => { setClassCreate(roomChoice); setRoomChoice(null); }}>
            Schedule a class
          </button>
          <button className="btn btn-primary" onClick={() => { setRoomHireCreate(roomChoice); setRoomChoice(null); }}>
            Create a room hire
          </button>
        </div>
      </Modal>

      <RoomHireModal
        open={!!roomHireCreate}
        onClose={() => setRoomHireCreate(null)}
        venueToken={venueToken}
        spaces={selfRooms}
        members={members}
        prefill={roomHireCreate}
        onCreated={() => { setRoomHireCreate(null); loadResources(); afterWrite(); }}
      />

      <AppointmentModal
        open={!!apptCreate}
        onClose={() => setApptCreate(null)}
        venueToken={venueToken}
        trainers={trainers}
        members={members}
        prefill={apptCreate}
        onCreated={() => { setApptCreate(null); loadResources(); afterWrite(); }}
      />

      {(!isUnified || showAdmin) && <CancellationsLog venueToken={venueToken} refreshKey={cancelKey} />}
    </div>
  );
}
