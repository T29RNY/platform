// deriveContext — the single source of truth for "which context is the user
// looking at right now", driving the NavBar tab set, surface gating, and (Phase 2)
// the guided tours. Multi-context nav epic, Phase 1.
//
// Design rule (locked s141): deriveContext takes the SELECTED CONTEXT ENTITY,
// never the person. The switcher's two lists (squads vs clubs) disambiguate
// squad-vs-club before any flag is read. A club-affiliated competitive squad
// still resolves to competitive_squad; its club membership, if any, is always a
// separate active_clubs entry.
//
// Tab presence is keyed on team_type === 'competitive' (stable — no off-season
// flicker). Content (standings/fixtures) is keyed on is_competitive (active
// league registration). See Q2 in the handoff.

export const CONTEXT_TYPES = {
  CASUAL: "casual_squad",
  COMPETITIVE: "competitive_squad",
  CLUB: "club_membership",
  GUARDIAN: "guardian",
};

// Returned descriptor shape:
//   { type, hasMatches, isLeague, isClub, clubId, clubName, cohortId }

// Squad route (/p/<token> or /admin/<token>) — fed from the team-state RPC
// fields mapped in @platform/core (teamType, isCompetitive, clubId, clubName)
// plus the loaded match count.
export function deriveSquadContext({
  teamType,
  isCompetitive,
  clubId = null,
  clubName = null,
  matchCount = 0,
} = {}) {
  const competitive = teamType === "competitive";
  return {
    type: competitive ? CONTEXT_TYPES.COMPETITIVE : CONTEXT_TYPES.CASUAL,
    hasMatches: (matchCount || 0) > 0,
    isLeague: !!isCompetitive,
    isClub: false,
    clubId: clubId ?? null,
    clubName: clubName ?? null,
    cohortId: null,
  };
}

// Club route (/sessions, /classes, /m, /profile) — fed from the selected
// active_clubs entry (from memberGetSelf).
export function deriveClubContext(clubEntry = {}) {
  return {
    type: CONTEXT_TYPES.CLUB,
    hasMatches: false,
    isLeague: false,
    isClub: true,
    clubId: clubEntry?.club_id ?? null,
    clubName: clubEntry?.club_name ?? null,
    cohortId: clubEntry?.cohort_id ?? null,
  };
}

// Guardian route (/parent-home) — a single context; children are content within
// it, never separate switcher entries.
export function deriveGuardianContext() {
  return {
    type: CONTEXT_TYPES.GUARDIAN,
    hasMatches: false,
    isLeague: false,
    isClub: false,
    clubId: null,
    clubName: null,
    cohortId: null,
  };
}

// Unified dispatcher over a tagged entity. Returns null when the entity is not
// yet resolved, so callers can render a stable "resolving" bar rather than
// flashing the wrong tabs.
export function deriveContext(entity) {
  if (!entity || !entity.kind) return null;
  switch (entity.kind) {
    case "squad":
      return deriveSquadContext(entity);
    case "club":
      return deriveClubContext(entity.club);
    case "guardian":
      return deriveGuardianContext();
    default:
      return null;
  }
}
