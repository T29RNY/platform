// Where does a squad open for this viewer?
//
// The rule (stated at the landing paths in App.jsx since unified login): a team
// admin opens their squad at the ADMIN door — the player view lives as a tab
// inside it, because `view` defaults to "player" and the /admin/<token> route
// never forces the admin view. Everyone else opens at the player door.
//
// This lives in one place because hardcoding `/p/${token}` at a call site
// SILENTLY STRIPS a team admin's access: on a /p/ route isAdmin is never derived
// from team_admins (only a vice-captain's flag unlocks the Admin tab), so an
// admin who is not also a VC loses admin entirely and the app contradicts the DB.
//
// adminTeams comes from getMyAdminTeams(), which returns nothing for anonymous
// viewers (auth.uid() is null) — so anon correctly keeps the player door.

export function findAdminToken(adminTeams, teamId) {
  if (!teamId || !Array.isArray(adminTeams)) return null;
  return (adminTeams.find(a => a.teamId === teamId) || {}).adminToken || null;
}

// Returns { href, isAdmin }. href is null when neither door is reachable
// (no admin token and no player token) — callers must not navigate.
export function squadDestination({ teamId, playerToken, adminTeams }) {
  const adminToken = findAdminToken(adminTeams, teamId);
  if (adminToken)  return { href: `/admin/${adminToken}`, isAdmin: true };
  if (playerToken) return { href: `/p/${playerToken}`,    isAdmin: false };
  return { href: null, isAdmin: false };
}
