// nav.js — real role + tab resolution for the multi-role mobile shell.
//
// Replaces the prototype's faked ROLES/tabsFor()/role-switcher (m-data.jsx) with
// functions driven by the live get_my_world() resolver (mig 372). There is NO
// role switcher in production — a person's hats come straight from the server:
//
//   venue_admin (admin_roles[].type) → operator   (role = owner|manager|staff)
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
  if ((world.club_memberships || []).length > 0) {
    roles.push({
      key: "member",
      clubs: world.club_memberships, // [{club_id, name, cohort_id, cohort_name, status}]
      name: world.club_memberships[0]?.name || "Your club",
      rank: ROLE_RANK.member,
    });
  }

  // Highest rank first → drives the default active role.
  return roles.sort((a, b) => b.rank - a.rank);
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
      // availability (matches), own membership/money, more. Reliability/POTM lands
      // in Phase B (a self reader). Mirrors guardian minus the child-proxy.
      return ["schedule", "matches", "membership", "more"];
    case "operator":
      return role.sub === "staff"
        ? ["tonight", "bookings", "people", "more"]      // staff: no payments/setup
        // owner/manager get the Setup hub (they configure the venue); it stays
        // reachable post-go-live as an "add more" surface (Decision #11).
        : ["tonight", "setup", "bookings", "payments", "people", "more"];
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
  tonight:    { icon: "pulse",    label: "Tonight",    title: "Operations" },
  bookings:   { icon: "calendar", label: "Bookings",   title: "Bookings" },
  payments:   { icon: "pound",    label: "Payments",   title: "Payments" },
  setup:      { icon: "cog",      label: "Setup",      title: "Set up venue" },
  people:     { icon: "users",    label: "People",     title: "People" },
  matches:    { icon: "pulse",    label: "Matches",    title: "Matches" },
  schedule:   { icon: "calendar", label: "Schedule",   title: "Training" },
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
  if (role.key === "operator") return role.name || "Your venue";
  if (role.key === "team_manager") return role.name || "Your team";
  if (role.key === "referee") return "Match official";
  if (role.key === "member") return role.name || "Your club";
  return "";
}
