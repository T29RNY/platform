import React, { useState, useMemo, useEffect } from "react";
import RequestsInbox from "./RequestsInbox.jsx";
import ScheduleGrid from "./ScheduleGrid.jsx";
import DayAgenda from "./DayAgenda.jsx";
import WalkInModal from "./WalkInModal.jsx";
import BookingSettings from "./BookingSettings.jsx";
import BookingDetailModal from "./BookingDetailModal.jsx";
import CancellationsLog from "./CancellationsLog.jsx";
import CalendarFilters from "./CalendarFilters.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { todayIso, addDays, fmtDayLabel, isOnDate, occLabel, occTypeKey, occIsFirst, occBounds } from "../bookingUtil.js";

const EMPTY_FILTERS = { paid: false, owed: false, oneoff: false, block: false, league: false, maint: false, pending: false, isnew: false, free: false };

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
  if (f.oneoff || f.block || f.league || f.maint) {
    const matchType = (f.oneoff && key === "oneoff") || (f.block && key === "block")
      || (f.league && key === "league") || (f.maint && key === "maint");
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

  const [date, setDate] = useState(todayIso());
  const [mobilePitchId, setMobilePitchId] = useState(null);
  const [walkIn, setWalkIn] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [cancelKey, setCancelKey] = useState(0); // bump to reload the cancellations log

  useEffect(() => {
    if (!mobilePitchId && pitches.length) setMobilePitchId(pitches[0].id);
  }, [pitches, mobilePitchId]);

  // ── calendar filters ──────────────────────────────────────────────────────
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterQ, setFilterQ] = useState("");
  const [hiddenPitches, setHiddenPitches] = useState(() => new Set());
  const toggleFilter = (k) => setFilters((s) => ({ ...s, [k]: !s[k] }));
  const togglePitch = (id) => setHiddenPitches((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setFilterQ(""); setHiddenPitches(new Set()); };

  const pendingGroups = useMemo(() => buildPendingGroups(occupancy), [occupancy]);
  const dayOcc = useMemo(() => occupancy.filter((o) => isOnDate(o.start, date)), [occupancy, date]);
  const visibleOcc = useMemo(
    () => dayOcc.filter((o) => occPasses(o, filters, filterQ, hiddenPitches)),
    [dayOcc, filters, filterQ, hiddenPitches],
  );
  const visiblePitches = useMemo(() => pitches.filter((p) => !hiddenPitches.has(p.id)), [pitches, hiddenPitches]);

  // Free-slots mode shows availability (booked blocks stripped); any content chip
  // (payment/type/pending/new/search) collapses the calendar to just the matches.
  const freeMode = filters.free;
  const contentActive = filters.paid || filters.owed || filters.oneoff || filters.block
    || filters.league || filters.maint || filters.pending || filters.isnew || !!filterQ.trim();
  const pitchOcc = useMemo(() => dayOcc.filter((o) => !hiddenPitches.has(o.playing_area_id)), [dayOcc, hiddenPitches]);
  const gridOcc = freeMode ? pitchOcc : visibleOcc;           // free mode needs real bookings for gap calc
  const windowOverride = useMemo(
    () => (!freeMode && contentActive ? occBounds(visibleOcc) : null),
    [freeMode, contentActive, visibleOcc],
  );
  const noMatches = !freeMode && contentActive && visibleOcc.length === 0;

  const afterWrite = () => { onRefreshOccupancy?.(); setCancelKey((k) => k + 1); };
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

      <section style={{ marginBottom: "var(--gap-3)" }}>
        <SectionHead label="Requests" count={pendingGroups.length}>
          <button className="btn btn-sm btn-ghost" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={14} /> Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={addBooking} disabled={!pitches.length}>
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
        {pitches.length === 0 ? (
          <EmptyState title="No active pitches" body="Add a pitch in Operations first." />
        ) : (
          <div className="schedule">
            <div className="schedule-head">
              <span className="nav">
                <button className="btn btn-xs btn-icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><Icon name="chevron_l" size={14} /></button>
                <button className="btn btn-xs btn-icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><Icon name="chevron_r" size={14} /></button>
              </span>
              <span className="date">{fmtDayLabel(date)}</span>
              <span style={{ flex: 1 }} />
            </div>
            <CalendarFilters
              pitches={pitches}
              hiddenPitches={hiddenPitches}
              onTogglePitch={togglePitch}
              q={filterQ}
              onQ={setFilterQ}
              f={filters}
              onToggle={toggleFilter}
              onClear={clearFilters}
              isMobile={isMobile}
            />
            {isMobile ? (
              <DayAgenda
                date={date}
                pitches={pitches}
                pitchId={mobilePitchId}
                onPitchChange={setMobilePitchId}
                dayOcc={gridOcc}
                bookingIns={bookingIns}
                canBook={enabled}
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
                canBook={enabled}
                windowOverride={windowOverride}
                freeMode={freeMode}
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
        onCreated={() => { setWalkIn(null); afterWrite(); }}
      />
      <BookingSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        venueToken={venueToken}
        venue={venue}
        pitches={state.pitches ?? []}
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
