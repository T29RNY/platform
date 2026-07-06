// Venue setup-hub registry + progress logic — presentation-agnostic.
//
// ONE source of truth for "what are the setup steps and what's done", shared by:
//   - apps/venue        SetupHub       (dark Broadcast-Gallery web skin)
//   - apps/inorout /hub OperatorSetup  (native amber [data-surface="mobile"] skin)
// Each app renders its own cards/icons; this file owns the step set, the
// completion predicates, the two honest progress numbers (Decision #3), the
// feature-tailoring filter (Decision #11) and the dismissal-aware "first
// incomplete step" selector. No React, no imports, no DOM — pure data + functions.
//
// Completion is DERIVED from real venue state (never a stored "done" flag), so it
// can't drift and is resumable for free. Dismissals ("skip for now") ARE stored
// (Decision #2) and passed in via ctx.dismissed.
//
// The step registry is config-driven (Decision #7 / FUTURE-PROOF): club & gym
// self-serve (parent epic PR5/PR6) reuse this by tagging steps with `verticals`
// and adding config rows — not by rebuilding the hub.

// ── ctx shape (assembled by each app from the venue's real state) ──────────────
//   {
//     venue,          // venue_get_state().venue (has logo_url, verification_status,
//                     //   origin, opening_hours?)
//     pitchesCount,   // venue_get_state().pitches.length
//     spacesCount,    // venueListSpaces().length
//     leaguesCount,   // venue_get_state().leagues.length
//     seasonsCount,   // venue_get_state().seasons.length
//     adminsCount,    // venueListAdmins().length (owner + co-admins)
//     hasStripe,      // venueGetBillingStatus().stripe.config.charges_enabled
//     dismissed,      // venue.setup_dismissed_steps (string[]; default [])
//   }

// Merged feature flags fail OPEN (a missing flag reads as on) — mirrors the venue
// console Rail's navItemVisible so the hub and the nav agree on what's offered.
export function featureOn(features, flag) {
  if (!features) return true;
  return features[flag] !== false;
}

// The opener — "what does your venue offer?". Writes the real venue facility
// flags via venueSetVenueFeature, which accepts ONLY these four (mig 400). Club-
// level offerings (leagues/memberships) need a club_id and are surfaced via the
// merged getVenueFeatureFlags read (fail-open) rather than toggled here in v1.
export const OFFER_OPTIONS = [
  { id: 'bookings',  feature: 'bookings',  label: 'Pitch / court hire', icon: 'pitch' },
  { id: 'room_hire', feature: 'room_hire', label: 'Room hire',          icon: 'roomhire' },
  { id: 'equipment', feature: 'equipment', label: 'Equipment hire',     icon: 'equipment' },
];

// The setup steps. `view` is a logical target each app maps to its own action
// (a rail view id on web, a native screen id on /hub). Optional cards for
// booking-rules / memberships land as extra registry rows in a later phase.
export const SETUP_STEPS = [
  {
    id: 'details',
    label: 'Venue details & branding',
    blurb: 'Name, address, contact, logo and colours.',
    icon: 'settings',
    required: true,
    view: 'details',
    verticals: ['venue', 'club', 'gym'],
    showIf: () => true,
    // "Details confirmed" = the owner has filled the core operational detail (an
    // address). A self-serve venue is created with a name but no address, so this
    // is the honest deliberate-action signal (PR-W3; was logo_url in W1). Logo/
    // colours stay optional branding inside the same form.
    isComplete: (ctx) => {
      const a = ctx && ctx.venue && ctx.venue.address;
      return !!(a && String(a).trim());
    },
  },
  {
    id: 'spaces',
    label: 'Pitches & bookable spaces',
    blurb: 'Add at least one pitch, court or bookable space.',
    icon: 'spaces',
    required: true,
    view: 'rooms',
    verticals: ['venue', 'club', 'gym'],
    showIf: (f) => featureOn(f, 'bookings') || featureOn(f, 'spaces'),
    isComplete: (ctx) => ((ctx && ctx.pitchesCount) || 0) + ((ctx && ctx.spacesCount) || 0) >= 1,
  },
  {
    id: 'hours',
    label: 'Opening hours',
    blurb: 'When your venue is open — independent of pitch times.',
    icon: 'clock',
    required: false,
    view: 'hours',
    verticals: ['venue', 'club', 'gym'],
    showIf: () => true,
    isComplete: (ctx) =>
      Array.isArray(ctx && ctx.venue && ctx.venue.opening_hours) &&
      ctx.venue.opening_hours.length > 0,
  },
  {
    id: 'leagues',
    label: 'Leagues & competitions',
    blurb: 'Run adult / open leagues (minors deferred).',
    icon: 'league',
    required: false,
    view: 'league',
    verticals: ['venue', 'club'],
    showIf: (f) => featureOn(f, 'competition') || featureOn(f, 'club_leagues'),
    isComplete: (ctx) => ((ctx && ctx.leaguesCount) || 0) + ((ctx && ctx.seasonsCount) || 0) >= 1,
  },
  {
    id: 'staff',
    label: 'Invite staff & co-admins',
    blurb: 'A single-owner venue is a single point of failure — add a backup.',
    icon: 'staff',
    required: false,
    nudge: true,
    view: 'access',
    verticals: ['venue', 'club', 'gym'],
    showIf: () => true,
    isComplete: (ctx) => ((ctx && ctx.adminsCount) || 0) >= 2,
  },
  {
    id: 'payments',
    label: 'Stripe Connect payouts',
    blurb: 'Needed only to take card payments.',
    icon: 'pound',
    required: false,
    gate: 'money',
    view: 'integrations',
    verticals: ['venue', 'club', 'gym'],
    showIf: (f) => featureOn(f, 'bookings'),
    isComplete: (ctx) => !!(ctx && ctx.hasStripe),
  },
];

export function stepVisible(step, features) {
  return typeof step.showIf === 'function' ? step.showIf(features) : true;
}

// Verification status, defaulting to 'verified' when absent (mig 485 not yet
// applied, or a pre-484 venue) — so the hub degrades by DERIVED state, never by a
// missing field (Decision #8).
export function venueVerification(venue) {
  return (venue && venue.verification_status) || 'verified';
}

// The two honest progress numbers + step states + first-incomplete selector.
export function computeSetupState(ctx, features) {
  const dismissedArr = (ctx && Array.isArray(ctx.dismissed)) ? ctx.dismissed : [];
  const dismissed = new Set(dismissedArr);

  const steps = SETUP_STEPS.map((s) => {
    const visible = stepVisible(s, features);
    return {
      id: s.id,
      label: s.label,
      blurb: s.blurb,
      icon: s.icon,
      required: !!s.required,
      nudge: !!s.nudge,
      gate: s.gate || null,
      view: s.view,
      visible,
      complete: visible ? !!s.isComplete(ctx) : false,
      dismissed: dismissed.has(s.id),
    };
  });

  const visibleSteps = steps.filter((s) => s.visible);
  const requiredSteps = visibleSteps.filter((s) => s.required);

  const goLiveDone = requiredSteps.filter((s) => s.complete).length;
  const goLiveTotal = requiredSteps.length;
  const ready = goLiveTotal > 0 && goLiveDone === goLiveTotal;

  // Completeness spans all visible steps EXCEPT optionals the owner dismissed
  // (a deliberate "skip for now" shouldn't drag the denominator).
  const countable = visibleSteps.filter((s) => s.required || !s.dismissed);
  const completeDone = countable.filter((s) => s.complete).length;
  const completeTotal = countable.length;

  // Required-incomplete first; then any non-dismissed optional.
  const firstIncomplete =
    requiredSteps.find((s) => !s.complete) ||
    visibleSteps.find((s) => !s.complete && !s.dismissed) ||
    null;

  return {
    steps,
    visibleSteps,
    goLive: { done: goLiveDone, total: goLiveTotal, ready },
    completeness: { done: completeDone, total: completeTotal },
    firstIncomplete: firstIncomplete ? firstIncomplete.id : null,
  };
}

// Should the hub auto-open / show the "finish setting up" reminder? True while the
// venue is pending OR the required go-live set is not yet complete.
export function needsSetupAttention(ctx, features) {
  const st = computeSetupState(ctx, features);
  return venueVerification(ctx && ctx.venue) === 'pending' || !st.goLive.ready;
}
