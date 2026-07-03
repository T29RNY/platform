// formatDistance — the single shared distance formatter for every match-fitness surface.
// Storage + RPCs stay in metres (SI, unit-neutral); ALL display goes through here, so a
// future per-user km/mi toggle is a one-function change (LOCKED DECISION #9).
//
// Miles, ~1 dp, "mi" (metres / 1609.34). Returns null on no distance (0/null/undefined)
// so indoor detection (no distance AND no route → indoor) keeps working — callers coalesce
// to their own empty text.
const METRES_PER_MILE = 1609.34;

export function formatDistance(metres) {
  if (!metres) return null;
  return `${(metres / METRES_PER_MILE).toFixed(1)} mi`;
}
