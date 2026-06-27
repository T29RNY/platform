// clubPublicHelpers — pure derivation for the public club page (Epic B, Phase 4).
// No React, no DB. Turns the get_club_public payload into the values the
// presentational components render: hero state, form guide, themed CSS vars.

// ── colour / theming ────────────────────────────────────────────────────────
// Parse a #rgb / #rrggbb string to {r,g,b} (0–255), or null if unparseable.
function parseHex(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// WCAG relative luminance (0 dark → 1 light).
function luminance(rgb) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

// Pick readable text token for a fill colour — ink on pale brands, white on dark.
// Returns a CSS var() reference (never a hex literal) so theming stays token-based.
export function onColour(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return "var(--white)";
  return luminance(rgb) > 0.6 ? "var(--black)" : "var(--white)";
}

// Build the per-club CSS custom properties injected on the page container.
// Missing colours fall back to the stylesheet defaults (gold), so a zero-config
// club still themes deliberately. accent defaults to primary.
export function themeVars(branding) {
  const b = branding || {};
  const vars = {};
  if (b.primary_colour)   vars["--cp-primary"]   = b.primary_colour;
  if (b.secondary_colour) vars["--cp-secondary"] = b.secondary_colour;
  vars["--cp-accent"]     = b.accent_colour || b.primary_colour || "var(--gold)";
  vars["--cp-on-accent"]  = onColour(b.accent_colour || b.primary_colour);
  return vars;
}

// ── fixtures ─────────────────────────────────────────────────────────────────
// Flatten leagues[].fixtures[] into a single list, tagging the league name.
export function allFixtures(leagues) {
  const out = [];
  (leagues || []).forEach((lg) => {
    (lg.fixtures || []).forEach((f) => out.push({ ...f, league_name: lg.name }));
  });
  return out;
}

// W / D / L from our perspective, or null if not a completed scored game.
export function resultOf(f) {
  if (f.status !== "completed" || f.home_score == null || f.away_score == null) return null;
  const ours = f.is_home ? f.home_score : f.away_score;
  const theirs = f.is_home ? f.away_score : f.home_score;
  if (ours > theirs) return "W";
  if (ours < theirs) return "L";
  return "D";
}

function dateVal(f) {
  if (!f.scheduled_date) return null;
  const d = new Date(f.scheduled_date + "T" + (f.kickoff_time || "00:00") + ":00");
  return isNaN(d.getTime()) ? null : d;
}

// Last N completed fixtures, oldest→newest (form reads left to right like a club site).
export function formGuide(fixtures, n = 5) {
  return fixtures
    .filter((f) => resultOf(f))
    .map((f) => ({ f, d: dateVal(f) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d - b.d)
    .slice(-n)
    .map((x) => ({ result: resultOf(x.f), fixture: x.f }));
}

// Derive the hero state from fixtures + now. Pure: `now` is passed in.
//   pre   → nearest upcoming scheduled fixture (countdown)
//   post  → a result landed in the last 3 days and nothing imminent
//   idle  → club has history but nothing upcoming
//   empty → zero fixtures (zero-config) — crest + colours only
export function deriveHero(fixtures, now = new Date()) {
  const dayMs = 86400000;
  const upcoming = fixtures
    .map((f) => ({ f, d: dateVal(f) }))
    .filter((x) => x.d && x.f.status === "scheduled" && x.d.getTime() >= now.getTime() - dayMs)
    .sort((a, b) => a.d - b.d);
  const completed = fixtures
    .map((f) => ({ f, d: dateVal(f) }))
    .filter((x) => x.d && resultOf(x.f))
    .sort((a, b) => b.d - a.d);

  const nextFx = upcoming[0] || null;
  const lastFx = completed[0] || null;
  const daysSince = lastFx ? (now.getTime() - lastFx.d.getTime()) / dayMs : Infinity;
  const daysUntil = nextFx ? (nextFx.d.getTime() - now.getTime()) / dayMs : Infinity;

  if (lastFx && daysSince <= 3 && daysUntil > 1) {
    return { kind: "post", result: lastFx.f, next: nextFx ? nextFx.f : null };
  }
  if (nextFx) return { kind: "pre", fixture: nextFx.f };
  if (fixtures.length > 0) return { kind: "idle", next: null };
  return { kind: "empty" };
}

// ── formatting ───────────────────────────────────────────────────────────────
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function fmtDate(dateStr) {
  if (!dateStr) return { dow: "", dm: "" };
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return { dow: "", dm: "" };
  return { dow: DOW[d.getDay()], dm: `${d.getDate()} ${MON[d.getMonth()]}` };
}

export function relativeAgo(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "TODAY";
  if (days === 1) return "1 DAY AGO";
  if (days < 7) return `${days} DAYS AGO`;
  if (days < 14) return "1 WEEK AGO";
  if (days < 56) return `${Math.floor(days / 7)} WEEKS AGO`;
  return `${Math.floor(days / 30)} MO AGO`;
}

export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function teaser(body, max = 120) {
  if (!body) return "";
  const t = body.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

// Crest "initials" from a club short_name / name for the placeholder crest.
export function crestText(club) {
  if (!club) return "?";
  if (club.short_name) return club.short_name.slice(0, 3).toUpperCase();
  return initials(club.name);
}
