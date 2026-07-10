// nav.js — real role + tab resolution for the multi-role mobile shell.
//
// Replaces the prototype's faked ROLES/tabsFor()/role-switcher (m-data.jsx) with
// functions driven by the live get_my_world() resolver (mig 372). There is NO
// role switcher in production — a person's hats come straight from the server:
//
//   venue_admin (admin_roles[].type) → operator   (role = owner|manager|staff;
//     a venueless club-shell venue emits none — its club is a club_admin hat instead)
//   admin_clubs[] (mig 522)          → club_admin  (EVERY club the operator runs,
//     deduped across venues/locations — the phone twin of the desktop club lens,
//     Decision 10; generic across club/gym-org/league verticals)
//   coaching[]                       → team_manager (club grassroots team)
//   guardian_of[]                    → guardian
//   ref_assignments[]                → referee     (match official; league + casual)
//   club_memberships[]               → member      (adult CLUB player, self-serve /hub)
//
// EXCLUDED on purpose (owned by existing views, not this epic): the CASUAL player
// and internal-league "Member" surfaces (team_players / league squad member).
// team_admin (a league/casual squad admin) is therefore NOT surfaced here. The
// `member` role added below is the CLUB member (club_memberships) — a distinct
// concept from the excluded casual/internal-league member (Club Console PR #6).

// ── Role rank, mirrors the design handoff for ordering/default selection. ──
export const ROLE_RANK = {
  club_admin_owner: 3,   // club-shell owner: defaults over coach/guardian, like an operator owner
  club_admin_manager: 2,
  club_admin_staff: 1,
  operator_owner: 3,
  operator_manager: 2,
  operator_staff: 1,
  team_manager: 1,
  referee: 0,        // above guardian, below operator/manager — never hijacks an operator's default
  guardian: -1,
  member: -2,        // lowest — an adult who is also a coach/guardian defaults to that hat, not member
};

// Resolve every mobile hat the signed-in person holds, highest-priority first.
// world = the get_my_world() payload (already loaded into App.jsx `myWorld`).
// Returns [] for squad-only / anon users → the shell simply does not mount.
export function resolveRoles(world) {
  if (!world || world.ok !== true) return [];
  const roles = [];

  const venue = (world.admin_roles || []).filter((r) => r.type === "venue_admin");
  for (const v of venue) {
    // A DEDICATED CLUB-SHELL venue (mig 518 self_serve_create_club: origin
    // 'self_serve' + exactly one linked club, surfaced by get_my_world mig 520 as
    // origin + club_id) runs NO facility, so it emits no operator hat — its club is
    // surfaced as a club_admin hat via world.admin_clubs below. Every other
    // venue_admin (real facility, multi-club, superadmin) keeps its operator hat and
    // behaves byte-identically to before.
    if (v.origin === "self_serve" && v.club_id) continue;
    // venue_admins.role is owner | manager | staff
    const sub = ["owner", "manager", "staff"].includes(v.role) ? v.role : "staff";
    roles.push({
      key: "operator",
      sub,                       // owner | manager | staff
      entityId: v.entity_id,     // venue_id
      name: v.name,
      rank: ROLE_RANK[`operator_${sub}`] ?? 1,
    });
  }

  // CLUB-ADMIN hats — one per DISTINCT club this operator administers, from
  // get_my_world.admin_clubs (mig 522), deduped across every venue/location. Generic
  // across verticals: a grassroots club, a gym org across N sites, a league — each is
  // one entry → one club_admin hat, ALONGSIDE the operator hat(s) for the real
  // venues. A venueless shell club appears here too (its empty operator hat is
  // suppressed above), so admin_clubs is the SINGLE source of every club_admin hat.
  for (const cl of (world.admin_clubs || [])) {
    if (!cl || !cl.club_id || !cl.venue_id) continue;
    // Rank the club hat by the caller's REAL venue role (owner|manager|staff, from
    // get_my_world.admin_clubs) so an operator is never defaulted into the club
    // console above their own operator hat; a pure club-shell owner (role 'owner')
    // still ranks high enough to be the default. The server re-derives + enforces
    // caps regardless — this is UX ordering only.
    const sub = ["owner", "manager", "staff"].includes(cl.role) ? cl.role : "owner";
    roles.push({
      key: "club_admin",
      sub,
      entityId: cl.venue_id,     // a venue the caller admins for this club — the venue-token credential (resolve_venue_caller Stage-1b)
      clubId: cl.club_id,
      name: cl.name,
      rank: ROLE_RANK[`club_admin_${sub}`] ?? 3,
    });
  }

  if ((world.coaching || []).length > 0) {
    roles.push({
      key: "team_manager",
      teams: world.coaching,     // [{club_team_id, club_id, team_name, role}]
      name: world.coaching[0]?.team_name || "Your team",
      rank: ROLE_RANK.team_manager,
    });
  }

  if ((world.ref_assignments || []).length > 0) {
    roles.push({
      key: "referee",
      assignments: world.ref_assignments, // [{context, ref_token, game_id, kickoff_at, ...}]
      name: "Referee",
      rank: ROLE_RANK.referee,
    });
  }

  if ((world.guardian_of || []).length > 0) {
    roles.push({
      key: "guardian",
      children: world.guardian_of, // [{child_profile_id, first_name, last_name, ...}]
      name: "Family",
      rank: ROLE_RANK.guardian,
    });
  }

  // Adult CLUB member — the self-serve /hub track (Club Console PR #6). Derived
  // from world.club_memberships, which is keyed to the caller's OWN member_profile
  // (mig 372), never a child's — so an adult who is ALSO a guardian/coach gets a
  // member hat IN ADDITION and their self-view shows only their own data (the
  // self profile id comes from member_get_self(), not from any child).
  // One member hat PER club membership (not one aggregate) so each collapses into
  // ITS OWN club entity in the switcher — the Admin+Player merge for a given club
  // must not depend on club_memberships[] ordering (reviewer F1). `clubs` stays an
  // array (of this one club) for the member track's selfClubs consumer.
  for (const cm of (world.club_memberships || [])) {
    if (!cm || !cm.club_id) continue;
    roles.push({
      key: "member",
      clubId: cm.club_id,
      clubs: [cm],                    // {club_id, name, cohort_id, cohort_name, status}
      cohortName: cm.cohort_name,
      status: cm.status,
      name: cm.name || "Your club",
      rank: ROLE_RANK.member,
    });
  }

  // Highest rank first → drives the default active role.
  return roles.sort((a, b) => b.rank - a.rank);
}

// ── ENTITY GROUPING for the switcher (one row per club / venue / team / family,
// NOT per role). A person's roles at the SAME real-world thing (e.g. club_admin +
// member at one club) collapse into ONE entry; the role is then toggled in the
// header. Display-layer only — resolveRoles / the role objects are unchanged. ──

// Stable per-entity key. Roles sharing a key belong to the same real-world thing.
// club_admin + member at one club → same "club:<id>" key → one entry.
export function entityKey(role) {
  if (!role) return "";
  switch (role.key) {
    case "operator":     return "venue:" + role.entityId;
    case "club_admin":   return "club:" + role.clubId;
    case "member":       return "club:" + (role.clubId ?? role.clubs?.[0]?.club_id ?? "self");
    case "team_manager": return "team:" + (role.teams?.[0]?.club_team_id ?? role.name);
    case "guardian":     return "family";
    case "referee":      return "referee";
    default:             return role.key;
  }
}

// Entity type → drives the switcher icon + section grouping.
export function entityType(role) {
  switch (role?.key) {
    case "operator":     return "venue";
    case "club_admin":
    case "member":       return "club";
    case "team_manager": return "team";
    case "guardian":     return "family";
    case "referee":      return "referee";
    default:             return "other";
  }
}

// Distinct icon per entity TYPE (no more house-for-two-things / shield-for-three).
export const ENTITY_ICON = {
  venue: "house", club: "shield", team: "flag",
  family: "users", referee: "whistle", squad: "figure", other: "grid",
};

// Short, user-facing name for ONE role — the header pill + the entity row's role
// summary. Fixes the raw lower-case "club admin" fallback (no label → key).
export const ROLE_PILL = {
  operator: "Operator", club_admin: "Admin", team_manager: "Manager",
  guardian: "Guardian", referee: "Referee", member: "Player",
};
export function roleLabel(role) {
  return role ? (ROLE_PILL[role.key] || role.key.replace(/_/g, " ")) : "";
}

// Group a rank-sorted roles[] into entities, preserving order + carrying each
// role's flat index (so the caller setRoleIdx's into it). roles[0] of each entity
// is the highest-rank = the default when the entity is picked.
export function groupEntities(roles) {
  const byKey = new Map();
  (roles || []).forEach((r, idx) => {
    const k = entityKey(r);
    if (!byKey.has(k)) byKey.set(k, { key: k, type: entityType(r), name: r.name, roles: [] });
    byKey.get(k).roles.push({ role: r, idx });
  });
  return [...byKey.values()];
}

// The primary bottom-tab set for a resolved role. Role-aware, mirrors the handoff.
// (Operator/team-manager tab content lands per-track; Phase 0 renders placeholders.)
export function tabsFor(role) {
  if (!role) return ["more"];
  switch (role.key) {
    case "guardian":
      return ["matches", "league", "membership", "more"];
    case "member":
      // Adult club member self-serve: own training in/out (schedule), own match
      // availability (matches), own reliability/POTM (stats — Phase B, mig 519 self
      // reader), own membership/money, more. Mirrors guardian minus the child-proxy.
      return ["schedule", "matches", "stats", "membership", "more"];
    case "club_admin":
      // Club-admin critical day-to-day on the phone (Decision 10): needs-you-now
      // Today (DBS gaps · join requests · fixture clashes), People, Money glance,
      // Comms (send announcement). Deeper club surfaces (Schedule / Memberships /
      // Club page / Safeguarding) land under More with the PR #6b screens; deep
      // setup stays on the desktop console.
      return ["today", "people", "money", "comms", "more"];
    case "operator":
      return role.sub === "staff"
        ? ["tonight", "bookings", "people", "more"]      // staff: no payments/setup
        // owner/manager: Setup lives under More (declutters the bar to 5) — it's a
        // configure-once surface, not a daily tab. Reachable as a live More row.
        : ["tonight", "bookings", "payments", "people", "more"];
    case "team_manager":
      return ["tonight", "league", "people", "more"];
    case "referee":
      return ["fixtures", "more"];
    default:
      return ["more"];
  }
}

// Tab → { icon (icons.jsx name), label }. Drives the tab bar + header title.
export const TAB_META = {
  today:      { icon: "spark",    label: "Today",      title: "Club today" },
  money:      { icon: "pound",    label: "Money",      title: "Membership & money" },
  comms:      { icon: "bell",     label: "Comms",      title: "Announcements" },
  tonight:    { icon: "pulse",    label: "Tonight",    title: "Operations" },
  bookings:   { icon: "calendar", label: "Bookings",   title: "Bookings" },
  payments:   { icon: "pound",    label: "Payments",   title: "Payments" },
  setup:      { icon: "cog",      label: "Setup",      title: "Set up venue" },
  people:     { icon: "users",    label: "People",     title: "People" },
  matches:    { icon: "pulse",    label: "Sessions",   title: "Sessions" },
  schedule:   { icon: "calendar", label: "Schedule",   title: "Training" },
  stats:      { icon: "figure",   label: "Stats",      title: "Your form" },
  league:     { icon: "trophy",   label: "League",     title: "League" },
  membership: { icon: "card",     label: "Membership", title: "Membership" },
  fixtures:   { icon: "whistle",  label: "Fixtures",   title: "My fixtures" },
  more:       { icon: "dots",     label: "More",       title: "More" },
};

// Header context sub-line for the active role.
export function contextSubline(role, activeChild) {
  if (!role) return "";
  if (role.key === "guardian") {
    const c = activeChild;
    return c ? `${c.first_name || "Child"}${c.last_name ? " " + c.last_name : ""}` : "Family";
  }
  if (role.key === "club_admin") return role.name || "Your club";
  if (role.key === "operator") return role.name || "Your venue";
  if (role.key === "team_manager") return role.name || "Your team";
  if (role.key === "referee") return "Match official";
  if (role.key === "member") return role.name || "Your club";
  return "";
}
