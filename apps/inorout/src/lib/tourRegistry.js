// tourRegistry — the catalogue of context-aware guided tours (multi-context nav,
// Phase 2). One tour per (context type, screen), keyed by a namespaced storage
// key so each fires at most once per device and never collides with another.
//
// Each tour: { key, steps: [{ target, title, body }] }
//   target — a CSS selector for the element to spotlight. We reuse the existing
//            `data-gaffer-target` markers where they exist and add `data-tour`
//            markers elsewhere, so the engine never depends on fragile structural
//            selectors or className internals.
//   title  — short Bebas-style heading (the engine styles it).
//   body   — ONE short sentence. Keep it to a single line of guidance.
//
// The engine resolves each target with poll-until-mounted and SKIPS a step whose
// target never appears (e.g. the competition cards between seasons, or the guest
// control when the squad is full) — so a tour degrades gracefully, never blocks.
//
// Keys mirror the locked plan's registry table. `tourKeyFor(type, screen)` maps a
// deriveContext().type + a screen id onto the right key.

export const TOURS = {
  // ── Casual squad ──────────────────────────────────────────────────────────
  io_tour_casual_myview: {
    key: "io_tour_casual_myview",
    steps: [
      { target: '[data-gaffer-target="status-buttons"]', title: "IN OR OUT",
        body: "Tap your status — it saves instantly. If the squad fills up, your In becomes Reserve automatically." },
      { target: '[data-gaffer-target="add-plus-one"]', title: "BRING A MATE",
        body: "Add a +1 here. Your organiser approves guests before they take a spot." },
      { target: '[data-tour="injured-toggle"]', title: "MARK INJURED",
        body: "Crocked? Mark yourself injured and you'll be skipped until you're back." },
      { target: '[data-tour="my-squads-toggle"]', title: "YOUR SQUADS",
        body: "Tap here to jump between the teams you play for." },
      { target: '[data-tour="header-avatar"]', title: "YOU",
        body: "Your avatar opens your profile — and the switcher when you're in more than one place." },
    ],
  },
  io_tour_casual_stats: {
    key: "io_tour_casual_stats",
    steps: [
      { target: '[data-tour="stats-league-table"]', title: "YOUR STATS",
        body: "Everyone's ranked here. Tap a player to see your head-to-head record against them." },
    ],
  },

  // ── Competitive squad ─────────────────────────────────────────────────────
  io_tour_comp_myview: {
    key: "io_tour_comp_myview",
    steps: [
      { target: '[data-tour="standings-card"]', title: "LEAGUE POSITION",
        body: "Your live league standing sits here once the competition is running." },
      { target: '[data-tour="fixtures-card"]', title: "NEXT FIXTURES",
        body: "Upcoming matches show here — tap In or Out as soon as they're announced." },
    ],
  },
  io_tour_comp_stats: {
    key: "io_tour_comp_stats",
    steps: [
      { target: '[data-tour="stats-league-table"]', title: "LEAGUE TABLE",
        body: "The full table lives here. Tap any player for your head-to-head record." },
    ],
  },

  // ── Admin dashboard (casual + competitive) ─────────────────────────────────
  // Live-toggle is deliberately excluded — its in-context coachmark covers that
  // one-off (the future weeks open automatically).
  io_tour_admin_dash: {
    key: "io_tour_admin_dash",
    advanceOnTap: false, // tiles navigate away on tap → walk via Next, not tap
    steps: [
      { target: '[data-tour="match-settings"]', title: "SET UP YOUR MATCH",
        body: "Start here: set your day, kickoff, venue, squad size and price." },
      { target: '[data-tour="make-teams"]', title: "PICK TEAMS",
        body: "Split the confirmed squad into A and B with one tap." },
      { target: '[data-tour="input-result"]', title: "LOG THE RESULT",
        body: "After the game, add the score, scorers and POTM — this drives everyone's stats." },
      { target: '[data-tour="payments"]', title: "MONEY & INSIGHT",
        body: "Check who's paid under Payments. IO Intelligence builds itself from every game." },
    ],
  },

  // ── Club membership ────────────────────────────────────────────────────────
  io_tour_club_sessions: {
    key: "io_tour_club_sessions",
    steps: [
      { target: '[data-tour="session-card"]', title: "RSVP & WHO'S GOING",
        body: "Tap a session to set In, Maybe or Out — and see who else is coming along." },
    ],
  },
  io_tour_club_classes: {
    key: "io_tour_club_classes",
    steps: [
      { target: '[data-tour="class-book"]', title: "BOOK A CLASS",
        body: "Book a spot, join the waitlist if it's full, and track your passes here." },
    ],
  },
  io_tour_club_pass: {
    key: "io_tour_club_pass",
    steps: [
      { target: '[data-tour="qr-code"]', title: "SHOW AT THE DOOR",
        body: "Scan this at reception to check in. It's your membership pass." },
      { target: '[data-tour="membership-perks"]', title: "MEMBERSHIP & PERKS",
        body: "Your tier, renewal and member perks all live on this card." },
    ],
  },
  io_tour_club_profile: {
    key: "io_tour_club_profile",
    steps: [
      { target: '[data-tour="profile-personal"]', title: "YOUR ACCOUNT",
        body: "Manage your details, any children you look after, and your consents here." },
    ],
  },

  // ── Guardian ────────────────────────────────────────────────────────────────
  io_tour_guardian_home: {
    key: "io_tour_guardian_home",
    steps: [
      { target: '[data-tour="follow-live-link"]', title: "FOLLOW YOUR CHILDREN",
        body: "Set their availability for training and matches, and follow games live from here." },
    ],
  },

  // ── Cross-context switcher (fires when the user has >1 context) ──────────────
  io_tour_switcher: {
    key: "io_tour_switcher",
    steps: [
      { target: '[data-tour="header-avatar"]', title: "SWITCH ANYTIME",
        body: "Tap your avatar to move between your squads, clubs and memberships." },
    ],
  },
};

export function getTour(key) {
  return TOURS[key] || null;
}

// Squad tours gate on the per-team multi_context_nav flag. Club/guardian routes
// have no squad team loaded, so until a club-level flag exists their tours gate
// on this localStorage preview switch — default OFF, so the whole Phase 2
// experience still ships DARK and can be enabled per device for testing or by
// the operator. (Recommended gating; confirm with operator — locked plan §6.)
export function clubToursEnabled() {
  try { return localStorage.getItem("ioo_tours_preview") === "1"; }
  catch { return false; }
}

// Map a context type + screen id onto the right tour key. Returns null when no
// tour is registered for that pair.
export function tourKeyFor(type, screen) {
  switch (`${type}:${screen}`) {
    case "casual_squad:myview":      return "io_tour_casual_myview";
    case "casual_squad:stats":       return "io_tour_casual_stats";
    case "competitive_squad:myview": return "io_tour_comp_myview";
    case "competitive_squad:stats":  return "io_tour_comp_stats";
    case "club_membership:sessions": return "io_tour_club_sessions";
    case "club_membership:classes":  return "io_tour_club_classes";
    case "club_membership:pass":     return "io_tour_club_pass";
    case "club_membership:profile":  return "io_tour_club_profile";
    case "guardian:home":            return "io_tour_guardian_home";
    default:                         return null;
  }
}
