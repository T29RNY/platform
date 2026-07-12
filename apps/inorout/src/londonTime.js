// londonTime.js — shared, dependency-free time anchor used by BOTH the mobile booking
// calendar and the desktop SessionsScreen so app↔desktop write identical instants.
//
// The DB stores timestamptz and the PostgREST session runs in UTC, so a naive local
// string ("2026-07-15T18:00", no offset) is read as 18:00 UTC and rendered back in
// Europe/London — drifting by the BST offset (+1h in summer). Anchor the picked London
// wall-clock to a correct UTC instant before POSTing. (One-pass offset correction; a
// DST-transition hour is negligible for pitch bookings.)

const LONDON = "Europe/London";

// dayKey 'YYYY-MM-DD' + hhmm 'HH:MM' (London wall-clock) → UTC ISO instant string.
export function londonInstantISO(dayKeyStr, hhmm) {
  const [y, mo, d] = String(dayKeyStr).split("-").map(Number);
  const [h, mi] = String(hhmm).split(":").map(Number);
  const guess = Date.UTC(y, (mo || 1) - 1, d, h || 0, mi || 0, 0);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON, hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const p = {}; parts.forEach((x) => { p[x.type] = x.value; });
  let ph = +p.hour; if (ph === 24) ph = 0;
  const asLondon = Date.UTC(+p.year, +p.month - 1, +p.day, ph, +p.minute, 0);
  const offMin = Math.round((asLondon - guess) / 60000);
  return new Date(guess - offMin * 60000).toISOString();
}
