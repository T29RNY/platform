// Unified roles system — used by both In or Out and Club Manager

export const ROLES = {
  SUPER_ADMIN:  "super_admin",   // platform level — you
  CLUB_ADMIN:   "club_admin",    // runs the club, all teams
  TEAM_ADMIN:   "team_admin",    // runs one team (coach/manager)
  DEPUTY_ADMIN: "deputy_admin",  // covers when admin away
  PLAYER:       "player",        // adult player, manages self
  PARENT:       "parent",        // manages child player(s)
  GUEST:        "guest",         // one-off, no account needed
  VIEWER:       "viewer",        // read-only
};

export const ADMIN_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.CLUB_ADMIN,
  ROLES.TEAM_ADMIN,
  ROLES.DEPUTY_ADMIN,
];

export const isAdmin = (role) => ADMIN_ROLES.includes(role);
