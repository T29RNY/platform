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

export function fmtDayLabel(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
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

// Colour/intent class for an occupancy block.
export function occClass(o) {
  if (o.source_kind === "maintenance") return "occ-maint";
  if (o.source_kind === "fixture") return "occ-fixture";
  if (o.detail?.status === "requested") return "occ-pending";
  return "occ-confirmed";
}

// Primary label for an occupancy block.
export function occLabel(o) {
  if (o.source_kind === "maintenance") return "Maintenance";
  if (o.source_kind === "fixture") {
    const d = o.detail ?? {};
    return d.home_team ? `${d.home_team} v ${d.away_team ?? "?"}` : "Fixture";
  }
  return o.detail?.team_name || "Booking";
}
