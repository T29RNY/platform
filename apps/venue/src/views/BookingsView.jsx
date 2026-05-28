import React, { useState, useMemo, useEffect } from "react";
import RequestsInbox from "./RequestsInbox.jsx";
import ScheduleGrid from "./ScheduleGrid.jsx";
import DayAgenda from "./DayAgenda.jsx";
import WalkInModal from "./WalkInModal.jsx";
import BookingSettings from "./BookingSettings.jsx";
import BookingDetailModal from "./BookingDetailModal.jsx";
import { todayIso, addDays, fmtDayLabel, isOnDate } from "../bookingUtil.js";

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

export default function BookingsView({ state, venueToken, occupancy = [], onRefresh, onRefreshOccupancy }) {
  const venue = state.venue ?? {};
  const enabled = !!venue.bookings_enabled;
  const pitches = useMemo(
    () => (state.pitches ?? []).filter((p) => p.active),
    [state.pitches],
  );
  const isMobile = useIsMobile();

  const [date, setDate] = useState(todayIso());
  const [mobilePitchId, setMobilePitchId] = useState(null);
  const [walkIn, setWalkIn] = useState(null); // {pitchId, time} | null
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null); // occupancy row | null

  useEffect(() => {
    if (!mobilePitchId && pitches.length) setMobilePitchId(pitches[0].id);
  }, [pitches, mobilePitchId]);

  const pendingGroups = useMemo(() => buildPendingGroups(occupancy), [occupancy]);
  const dayOcc = useMemo(() => occupancy.filter((o) => isOnDate(o.start, date)), [occupancy, date]);

  const afterWrite = () => { onRefreshOccupancy?.(); };

  return (
    <main className="content bookings">
      <div className="bk-head">
        <div className="bk-datenav">
          <button className="bk-navbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <div className="bk-date">
            <span className="bk-date-label">{fmtDayLabel(date)}</span>
            {date !== todayIso() && (
              <button className="btn-link bk-today" onClick={() => setDate(todayIso())}>Jump to today</button>
            )}
          </div>
          <button className="bk-navbtn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
        </div>
        <div className="bk-head-actions">
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>

      {!enabled && (
        <div className="bk-banner">
          <div>
            <strong>Bookings are turned off.</strong>
            <span> Casual teams can't find or request this venue, and walk-ins are read-only.</span>
          </div>
          <button className="btn-accent" onClick={() => setSettingsOpen(true)}>Turn on bookings</button>
        </div>
      )}

      <div className="bk-grid">
        <section className="panel bk-inbox-panel">
          <h2>Requests {pendingGroups.length > 0 && <span className="panel-count">{pendingGroups.length}</span>}</h2>
          <RequestsInbox
            groups={pendingGroups}
            venueToken={venueToken}
            onChanged={afterWrite}
          />
        </section>

        <section className="panel bk-schedule-panel">
          <h2>Schedule</h2>
          {pitches.length === 0 ? (
            <p className="muted">No active pitches. Add a pitch in Operations first.</p>
          ) : isMobile ? (
            <DayAgenda
              date={date}
              pitches={pitches}
              pitchId={mobilePitchId}
              onPitchChange={setMobilePitchId}
              dayOcc={dayOcc}
              canBook={enabled}
              onTapEmpty={(pitchId, time) => setWalkIn({ pitchId, time })}
              onSelectBooking={setSelectedBooking}
            />
          ) : (
            <ScheduleGrid
              date={date}
              pitches={pitches}
              dayOcc={dayOcc}
              canBook={enabled}
              onTapEmpty={(pitchId, time) => setWalkIn({ pitchId, time })}
              onSelectBooking={setSelectedBooking}
            />
          )}
        </section>
      </div>

      <WalkInModal
        open={!!walkIn}
        onClose={() => setWalkIn(null)}
        venueToken={venueToken}
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
        venueToken={venueToken}
        onClose={() => setSelectedBooking(null)}
        onChanged={() => { setSelectedBooking(null); afterWrite(); }}
      />
    </main>
  );
}
