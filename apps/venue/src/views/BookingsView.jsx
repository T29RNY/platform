import React, { useState, useMemo, useEffect } from "react";
import RequestsInbox from "./RequestsInbox.jsx";
import ScheduleGrid from "./ScheduleGrid.jsx";
import DayAgenda from "./DayAgenda.jsx";
import WalkInModal from "./WalkInModal.jsx";
import BookingSettings from "./BookingSettings.jsx";
import BookingDetailModal from "./BookingDetailModal.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
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
  const pitches = useMemo(() => (state.pitches ?? []).filter((p) => p.active), [state.pitches]);
  const isMobile = useIsMobile();

  const [date, setDate] = useState(todayIso());
  const [mobilePitchId, setMobilePitchId] = useState(null);
  const [walkIn, setWalkIn] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);

  useEffect(() => {
    if (!mobilePitchId && pitches.length) setMobilePitchId(pitches[0].id);
  }, [pitches, mobilePitchId]);

  const pendingGroups = useMemo(() => buildPendingGroups(occupancy), [occupancy]);
  const dayOcc = useMemo(() => occupancy.filter((o) => isOnDate(o.start, date)), [occupancy, date]);

  const afterWrite = () => { onRefreshOccupancy?.(); };
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
            {isMobile ? (
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
          </div>
        )}
      </section>

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
    </div>
  );
}
