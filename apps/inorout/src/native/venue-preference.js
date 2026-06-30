// Indoor/outdoor preference per recurring game (Match Workout Tracking PR #7).
//
// Drives the Phase-2 watchOS auto-start: the watch reads this preference to decide
// whether to auto-start an indoor or outdoor Soccer workout at the team's usual game
// time. Harmless and DARK until the watchOS app is built.
//
// Storage: localStorage key `venue_pref_<teamId>` = "indoor" | "outdoor".
// Written by PerMatchFitnessCard after a workout is attached (inferred from the
// workout's own indoor flag). Keyed by team_id for casual; league preference is a
// Phase-2 extension.

export function getVenuePreference(teamId) {
  if (!teamId) return null;
  try {
    return localStorage.getItem(`venue_pref_${teamId}`) || null;
  } catch (e) {
    console.error("[venue-pref] read failed", e);
    return null;
  }
}

export function setVenuePreference(teamId, indoor) {
  if (!teamId) return;
  try {
    localStorage.setItem(`venue_pref_${teamId}`, indoor ? "indoor" : "outdoor");
  } catch (e) {
    console.error("[venue-pref] write failed", e);
  }
}
