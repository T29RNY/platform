// Shared presentational helpers for the v2 venue dashboard. Ported from the
// design bundle's data.jsx helper set, made pure/ESM. Display-only — no data
// access. Money values from the backend are integer pence.

export function getInitials(name) {
  if (!name) return "—";
  const parts = String(name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// £x.xx — exact, for charge amounts.
export function poundsFromPence(p) {
  return "£" + ((p || 0) / 100).toFixed(2);
}

// £x,xxx — rounded, for headline totals.
export function poundsRound(p) {
  return "£" + Math.round((p || 0) / 100).toLocaleString("en-GB");
}

// "15 JUN" from an ISO date (yyyy-mm-dd).
export function shortDate(d) {
  if (!d) return "TBC";
  try {
    return new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
  } catch { return d; }
}

// "MON" weekday from an ISO date.
export function dayLabel(d) {
  if (!d) return "";
  try {
    return new Date(d + "T00:00").toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
  } catch { return ""; }
}

// "Sat 7 Jun" — longer next-fixture date.
export function longDate(d) {
  if (!d) return "TBC";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch { return d; }
}

// Relative time from an ISO timestamp ("3h ago", "2d ago", then a date).
export function relativeFrom(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Deterministic crest colours when a team hasn't set its own. The design draws
// a diagonal-split gradient from c1→c2; fall back to a hash-picked pair.
const PALETTE = [
  ["#60A0FF", "#2F6BFF"], ["#FF6060", "#C0392B"], ["#36E3A0", "#12B981"],
  ["#FFC83A", "#F59E0B"], ["#A855F7", "#7C3AED"], ["#3B82F6", "#1D4ED8"],
  ["#EC4899", "#BE185D"], ["#14B8A6", "#0D9488"],
];
export function crestColours(c1, c2, seed = "") {
  if (c1 && c2) return [c1, c2];
  if (c1) return [c1, c1];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
