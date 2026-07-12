// pitchStatus.js — pure presentation helper for a club_session's DECOUPLED pitch
// allocation state (club_sessions.pitch_status, migs 558/561; surfaced by the schedule
// readers in mig 562).
//
// A coach-booked or bumped club_session keeps status='scheduled' (so it stays visible
// to players/guardians and keeps its RSVPs — the availability-collection ignition) even
// while its pitch is unconfirmed. pitch_status carries the pitch's real state separately:
//   allocated                 → the pitch is reserved → render as a CONFIRMED booking
//                               (show the slot / venue / pitch as normal).
//   requested                 → a clash-request pending owner approval, OR a bumped
//                               session awaiting the owner's move: the pitch is NOT
//                               theirs yet → "Pitch being confirmed" (hide the stale slot).
//   none / declined / expired → no pitch (owner declined / TTL lapsed / cleared) →
//                               "Pitch TBC" (coach re-picks; hide the stale slot).
//
// Backward-compat: every existing / venue-created row defaults to 'allocated' (mig 558),
// and a missing / null / unknown value is treated as 'allocated' too — so unchanged
// sessions render exactly as before this change.
//
// This helper is intentionally STYLE-FREE: it returns the label + whether to show the
// confirmed slot; each surface (apps/inorout desktop, apps/inorout mobile, apps/venue)
// applies its own chip styling. Shared logic, per-app presentation.

export function pitchStatusMeta(pitchStatus) {
  switch (pitchStatus) {
    case "requested":
      return { state: "pending", label: "Pitch being confirmed", showSlot: false };
    case "none":
    case "declined":
    case "expired":
      return { state: "tbc", label: "Pitch TBC", showSlot: false };
    case "allocated":
    default:
      return { state: "confirmed", label: null, showSlot: true };
  }
}

// Convenience: is the pitch unconfirmed (pending OR tbc)? True → suppress the (stale)
// venue / slot presentation and show the label instead.
export function isPitchUnconfirmed(pitchStatus) {
  return !pitchStatusMeta(pitchStatus).showSlot;
}
