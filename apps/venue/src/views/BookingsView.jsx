import React, { useState, useMemo, useEffect, useCallback } from "react";
import { getOperatorPitchOccupancy, venueListPitchReservedWindows, venueListBumpProposals } from "@platform/core";
import RequestsInbox from "./RequestsInbox.jsx";
import BumpProposalsBanner from "./BumpProposalsBanner.jsx";
import ScheduleGrid from "./ScheduleGrid.jsx";
import AllGroundsGrid from "./AllGroundsGrid.jsx";
import DayAgenda from "./DayAgenda.jsx";
import WalkInModal from "./WalkInModal.jsx";
import BookingSettings from "./BookingSettings.jsx";
import BookingDetailModal from "./BookingDetailModal.jsx";
import CancellationsLog from "./CancellationsLog.jsx";
import CalendarFilters from "./CalendarFilters.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { todayIso, addDays, fmtDayLabel, isOnDate, occLabel, occTypeKey, occIsFirst, occBounds } from "../bookingUtil.js";

const EMPTY_FILTERS = { paid: false, owed: false, oneoff: false, block: false, league: false, training: false, match: false, maint: false, pending: false, isnew: false, free: false };

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

  const afterWrite = () => { onRefreshOccupancy?.(); loadOperator(); loadBumps(); setCancelKey((k) => k + 1); };
  const addBooking = () => setWalkIn({ pitchId: pitches[0]?.id, time: "19:00" });

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

      <section style={{ marginBottom: "var(--gap-3)" }}>
        <SectionHead label="Requests" count={pendingGroups.length}>
          <button className="btn btn-sm btn-ghost" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={14} /> Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={addBooking} disabled={!pitches.length || !isSelf}>
            <Icon name="plus" size={14} /> Add booking
          </button>
        </SectionHead>
        <RequestsInbox groups={pendingGroups} venueToken={venueToken} onChanged={afterWrite} />
      </section>

      <section>
        <SectionHead label="Schedule">
          {date !== todayIso() && (
            <button className="btn btn-sm" onClick={() => setDate(todayIso())}>Jump to today</button>
          )}
        </SectionHead>
        {activePitches.length === 0 ? (
          <EmptyState title="No active pitches" body={isSelf ? "Add a pitch in Operations first." : "This site has no active pitches."} />
        ) : (
          <div className="schedule">
            <div className="schedule-head">
              <span className="nav">
                <button className="btn btn-xs btn-icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><Icon name="chevron_l" size={14} /></button>
                <button className="btn btn-xs btn-icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><Icon name="chevron_r" size={14} /></button>
              </span>
              <span className="date">{fmtDayLabel(date)}</span>
              <span style={{ flex: 1 }} />
              {hasMultiVenue && (
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
            {!isSelf && !isAll && (
              <div className="banner banner-info ground-readonly">
                Viewing <strong>{selectedVenue?.venue_name}</strong> — read-only. Switch to this site's console to book.
              </div>
            )}
            {isAll && (
              <div className="banner banner-info ground-readonly">
                Showing <strong>all your grounds</strong> on one calendar. Other sites are view-only — book from each site's own console.
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
          </div>
        )}
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

      <CancellationsLog venueToken={venueToken} refreshKey={cancelKey} />
    </div>
  );
}
