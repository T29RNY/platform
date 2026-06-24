// Shared time/date helpers for the venue booking UI. All venue-local (Europe/London),
// matching the server (get_pitch_occupancy returns Europe/London tstz strings).
const TZ = "Europe/London";

const pad = (n) => String(n).padStart(2, "0");

export function isoDate(d) {
  // YYYY-MM-DD from LOCAL components (never toISOString — that converts to UTC
  // and shifts the date in non-UTC zones, silently cancelling addDays).
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00"); // local noon — DST-safe
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // en-CA → YYYY-MM-DD
}

export function dowOf(iso) {
  // 0=Sun..6=Sat for a YYYY-MM-DD, matching booking_windows.day_of_week.
  return new Date(iso + "T12:00:00").getDay();
}

// Day label from a YYYY-MM-DD date string (e.g. the calendar's selected date).
export function fmtDayLabel(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });
}

// Day label from a full tstz ISO string (e.g. occupancy.start), venue-local.
export function fmtDayShort(tstz) {
  return new Date(tstz).toLocaleDateString("en-GB", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short",
  });
}

// Minutes-from-midnight (venue-local) for an ISO tstz string.
export function minsOfDay(tstz) {
  const s = new Date(tstz).toLocaleTimeString("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function fmtTime(tstz) {
  return new Date(tstz).toLocaleTimeString("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// "HH:MM" from minutes-from-midnight.
export function hhmm(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "HH:MM" → minutes.
export function parseHHMM(s) {
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + (m || 0);
}

// True if the occupancy/booking ISO falls on the given local date.
export function isOnDate(tstz, iso) {
  return new Date(tstz).toLocaleDateString("en-CA", { timeZone: TZ }) === iso;
}

// The visible time window (minutes-from-midnight) for a calendar day: the union of
// every pitch's booking_windows on that weekday, padded to whole hours. Falls back
// to 08:00–22:00 when no windows are configured. Always widened to cover any
// occupancy passed in so a fixture/booking can't fall off the top or bottom.
export function dayWindow(pitches, iso, dayOcc = []) {
  const dow = dowOf(iso);
  let lo = Infinity, hi = -Infinity;
  for (const p of pitches) {
    for (const w of p.booking_windows ?? []) {
      if (Number(w.day_of_week) !== dow) continue;
      lo = Math.min(lo, parseHHMM(w.open_time));
      hi = Math.max(hi, parseHHMM(w.close_time));
    }
  }
  for (const o of dayOcc) {
    lo = Math.min(lo, minsOfDay(o.start));
    hi = Math.max(hi, minsOfDay(o.end));
  }
  if (lo === Infinity) { lo = 8 * 60; hi = 22 * 60; }
  lo = Math.floor(lo / 60) * 60;
  hi = Math.ceil(hi / 60) * 60;
  if (hi <= lo) hi = lo + 60;
  return { startMin: lo, endMin: hi };
}

// Colour class for an occupancy block. Colour now means PAYMENT:
//   green  = paid / nothing owed     (occ-paid)
//   amber  = money owed              (occ-owed)
//   dashed = a request to action     (occ-pending — not yet a confirmed booking)
//   striped= maintenance             (occ-maint)
// Booking TYPE (one-off/block/league/training/match) is conveyed by occType() + occIcon(),
// not by colour alone (accessibility).
export function occClass(o) {
  if (o.source_kind === "maintenance") return "occ-maint";
  if (o.source_kind === "club_session") return "occ-training";
  if (o.source_kind === "club_fixture") return "occ-match";
  if (o.detail?.status === "requested") return "occ-pending";
  return o.detail?.owed ? "occ-owed" : "occ-paid";
}

// Word tag for the booking TYPE — League | Block | One-off | Training | Match (null = maintenance).
export function occType(o) {
  if (o.source_kind === "maintenance") return null;
  if (o.source_kind === "fixture") return "League";
  if (o.source_kind === "club_session") return "Training";
  if (o.source_kind === "club_fixture") return "Match";
  return o.detail?.kind === "block" ? "Block" : "One-off";
}

// Machine key for the booking TYPE — used by the calendar filters.
export function occTypeKey(o) {
  if (o.source_kind === "maintenance") return "maint";
  if (o.source_kind === "fixture") return "league";
  if (o.source_kind === "club_session") return "training";
  if (o.source_kind === "club_fixture") return "match";
  return o.detail?.kind === "block" ? "block" : "oneoff";
}

// Icon glyph name (Icon.jsx registry) for the block — a shape, not just a colour, so
// Training vs Match reads at a glance. null = no glyph (ordinary bookings/maintenance).
export function occIcon(o) {
  if (o.source_kind === "club_session") return "teams";
  if (o.source_kind === "club_fixture") return "whistle";
  return null;
}

// Manager initials carried on club activity blocks (null for non-club / no manager).
export function occInitials(o) {
  return o.detail?.manager_initials || null;
}

// Tight time bounds (minutes, padded to whole hours) of a set of occupancy blocks.
// Used to collapse the calendar to just the filtered results. null when empty.
export function occBounds(occ) {
  if (!occ.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const o of occ) { lo = Math.min(lo, minsOfDay(o.start)); hi = Math.max(hi, minsOfDay(o.end)); }
  lo = Math.floor(lo / 60) * 60;
  hi = Math.ceil(hi / 60) * 60;
  if (hi <= lo) hi = lo + 60;
  return { startMin: lo, endMin: hi };
}

// Free (unoccupied) intervals within [startMin,endMin] given a pitch's blocks.
export function freeGaps(occ, startMin, endMin) {
  const spans = occ.map((o) => [minsOfDay(o.start), minsOfDay(o.end)]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = startMin;
  for (const [s, e] of spans) {
    if (s > cursor) gaps.push([cursor, Math.min(s, endMin)]);
    cursor = Math.max(cursor, e);
    if (cursor >= endMin) break;
  }
  if (cursor < endMin) gaps.push([cursor, endMin]);
  return gaps;
}

// Short audience label for a reserved window (calendar tint + editor summary).
export function reservedLabel(w) {
  if (w.audience === "team") return w.club_team_name || "Team";
  if (w.audience === "min_rank") return `Rank ≤ ${w.min_rank}`;
  return "Club";
}

// Reserved bands (minutes-from-midnight) for one pitch on a given calendar date.
// Advisory shading only — these write no occupancy. Filters a pitch's reserved
// windows to the date's weekday and converts each to a [startMin,endMin] band.
export function reservedBands(windows, iso) {
  const dow = dowOf(iso);
  return (windows ?? [])
    .filter((w) => Number(w.day_of_week) === dow)
    .map((w) => ({
      startMin: parseHHMM(w.start_time),
      endMin: parseHHMM(w.end_time),
      label: reservedLabel(w),
      audience: w.audience,
    }));
}

// The reserved band covering a given start time (minutes-from-midnight) on a date, or null.
// Used by the operator walk-in flow to warn before booking over the club's own reserved time
// (operator can still override — the server returns warning:'reserved', it does not block).
export function reservedHitAt(windows, iso, startMin) {
  return reservedBands(windows, iso).find((b) => startMin >= b.startMin && startMin < b.endMin) || null;
}

// True when this is the booker's first-ever booking at the venue (bookings only).
export function occIsFirst(o) {
  return o.source_kind === "booking" && o.detail?.is_first === true;
}

// Primary label for an occupancy block.
export function occLabel(o) {
  if (o.source_kind === "maintenance") return "Maintenance";
  if (o.source_kind === "fixture") {
    const d = o.detail ?? {};
    return d.home_team ? `${d.home_team} v ${d.away_team ?? "?"}` : "Fixture";
  }
  if (o.source_kind === "club_session") {
    const d = o.detail ?? {};
    return d.title || d.team_name || "Training";
  }
  if (o.source_kind === "club_fixture") {
    const d = o.detail ?? {};
    const our = d.our_team || "Our team";
    return d.opponent ? `${our} v ${d.opponent}` : our;
  }
  return o.detail?.team_name || "Booking";
}
