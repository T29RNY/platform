// featureRelevance — discipline axis (axis C) for the venue rail.
//
// Venue OS nav Phase 2. This is the SECOND of two orthogonal rail gates, kept
// deliberately separate from the purchased-feature flag (mig 399/400):
//   • flag      = did this venue/club PURCHASE the feature?  (featureOn)
//   • discipline = is the feature RELEVANT to the club's sport? (here)
// A rail item shows only when BOTH pass. Discipline never blocks a write — it
// only declutters nav; the server guards key off flags alone.
//
// Mirrors disciplineLabels semantics (apps/inorout/src/lib/disciplineLabels.js)
// — the same vocabulary lives there; we only need the relevance grouping here,
// so it's a small local mirror rather than importing the member-facing copy
// (same pattern as MembershipsView's GRADING_/FIGHT_RECORD_DISCIPLINES sets).
//
// Operator-locked relevance (DECISIONS s179):
//   • football never sees Classes / Trainers.
//   • gym (and other non-team disciplines) never sees Leagues / Standings /
//     Fixtures / Cups.
// Everything else (unknown / 'other') fails OPEN — shown — so a typo or a new
// discipline can never silently hide a working surface.

const PT_CLASS_DISCIPLINES  = new Set(["gym", "boxing", "martial_arts", "fitness", "yoga", "dance"]);
const TEAM_SPORT_DISCIPLINES = new Set(["football"]);
const KNOWN = new Set([...PT_CLASS_DISCIPLINES, ...TEAM_SPORT_DISCIPLINES]);

// Each discipline-gated rail item belongs to a "kind"; items not listed are
// never discipline-gated (facility items, People, Memberships, Club sessions…).
const ITEM_KIND = {
  classes:  "classes",
  trainers: "classes",
  fixtures: "competition",
  league:   "competition",
  table:    "competition",
  cups:     "competition",
};

// Does a single discipline make this kind relevant? Unknown/'other' → true.
function disciplineMatchesKind(d, kind) {
  if (!d || !KNOWN.has(d)) return true;                 // fail-open
  if (kind === "classes")     return PT_CLASS_DISCIPLINES.has(d);
  if (kind === "competition") return TEAM_SPORT_DISCIPLINES.has(d);
  return true;
}

// Rail-item gate: relevant if ANY discipline present at the venue matches the
// item's kind (union semantics — a venue with both a football club and a gym
// keeps Competition AND Classes). No clubs (pure-facility venue) → show.
export function itemDisciplineRelevant(disciplines, itemId) {
  const kind = ITEM_KIND[itemId];
  if (!kind) return true;                               // not discipline-gated
  const ds = (Array.isArray(disciplines) ? disciplines : []).filter(Boolean);
  if (ds.length === 0) return true;                     // facility-only / loading
  return ds.some((d) => disciplineMatchesKind(d, kind));
}
