// Role / "hat" resolution for the console — built off get_my_world() (the
// identity spine), never a hard-coded club-only role. FUTURE-PROOF mandate of
// the Club Manager epic: one person legitimately holds many hats (club admin +
// parent + adult player + occasional ref) across apps, and the spine returns
// that whole set in one call. Mirrors apps/inorout/src/mobile/nav.js:resolveRoles
// adapted for the desktop admin console.

// Rank so the highest-authority hat is the default active context.
const HAT_RANK = { admin: 3, coach: 2, guardian: 1, player: 0 };

// Turn a get_my_world() payload into the ordered hat set the console offers in
// its context switcher. Returns [] until the spine resolves (world.ok).
export function resolveHats(world) {
  if (!world || world.ok !== true) return [];
  const hats = [];

  // admin hat — any active venue_admin role (entity_id = venue_id)
  const venueAdmin = (world.admin_roles || []).filter((r) => r.type === "venue_admin");
  if (venueAdmin.length > 0) {
    hats.push({ key: "admin", label: "Club admin", venues: venueAdmin });
  }
  // coach hat — club_team_managers rows
  if ((world.coaching || []).length > 0) {
    hats.push({ key: "coach", label: "Coach", teams: world.coaching });
  }
  // guardian hat — accepted guardian of one or more children
  if ((world.guardian_of || []).length > 0) {
    hats.push({ key: "guardian", label: "Parent", children: world.guardian_of });
  }
  // player hat — active club memberships (adult player self-serve)
  if ((world.club_memberships || []).length > 0) {
    hats.push({ key: "player", label: "Player", memberships: world.club_memberships });
  }

  return hats.sort((a, b) => (HAT_RANK[b.key] ?? -1) - (HAT_RANK[a.key] ?? -1));
}

// Which left-rail sections a hat may see. PR #1 ships the shell + Home only;
// later PRs light up the rest. The rail three-layer-gates on this (nav → route
// → RPC), so a section a hat can't own never renders.
const ADMIN_SECTIONS = [
  "home", "people", "structure", "schedule",
  "memberships", "matchday", "comms", "clubpage", "safeguarding",
];
export function sectionsForHat(hatKey) {
  if (hatKey === "admin") return ADMIN_SECTIONS;
  if (hatKey === "coach") return ["home", "people", "schedule", "matchday", "comms"];
  // guardian / player companion surfaces live in the native /hub, not this console
  return ["home"];
}

// club_<slug-with-underscores>  →  public page slug (hyphens).
// Club ids are minted as 'club_' + name.toLowerCase().replace(/\s+/g,'_')
// (mig 286); the public club_pages slug uses hyphens. Derive one from the other
// so the console can pull branding/rich data from get_club_public without a new
// backend read. Returns null if the id doesn't look like a club id.
export function clubIdToSlug(clubId) {
  if (typeof clubId !== "string" || !clubId.startsWith("club_")) return null;
  return clubId.slice("club_".length).replace(/_/g, "-");
}
