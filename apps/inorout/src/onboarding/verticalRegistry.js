// Config-driven Vertical Registry — the single data source the /create chooser
// reads from, and (in later PRs) the wizard step-set, the create-RPC dispatch, and
// owner-assignment will read from too. Adding a new vertical (yoga, dance,
// martial-arts) becomes a config row here + one RPC body, NOT a new screen / route /
// branch. Generalises the two registry patterns already in-repo
// (disciplineLabels.js + club_features). See SELF_SERVE_MULTI_VERTICAL_HANDOFF.md
// Decision #8.
//
// PR1 reads only: key, label, sublabel, Icon, surface, status.
// The remaining fields (createRpc / ownerModel / gateLevel / flagsPreset) are the
// forward seams for PR2–PR6 — declared now so a later vertical is a data edit, not a
// structural one. They are intentionally unused until their PR lands.

import { SoccerBall, Trophy, MapPin, UsersThree, Barbell, Medal } from "@phosphor-icons/react";

// surface  'native'   → the whole flow completes inside the phone app
//          'computer' → shell captured natively, then configured on the web console
// status   'live'     → routes into a working create flow now
//          'soon'     → renders an honest "coming soon" hand-off (no dead ends)
export const VERTICALS = [
  {
    key: "casual",
    label: "Casual squad",
    sublabel: "A regular kickabout with your mates",
    Icon: SoccerBall,
    surface: "native",
    status: "live",
    // forward seams (unused until PR3+)
    createRpc: "create_team",
    ownerModel: "admin_token",
    gateLevel: "open",
    flagsPreset: null,
  },
  {
    key: "competitive",
    label: "League / competitive team",
    sublabel: "Play in a league — register by code",
    Icon: Trophy,
    surface: "native",
    status: "live", // PR2: competitive create + join-a-league-by-code
    createRpc: "create_team",
    ownerModel: "admin_token",
    gateLevel: "open",
    flagsPreset: null,
  },
  {
    key: "venue",
    label: "Venue",
    sublabel: "Pitches, bookings & leagues",
    Icon: MapPin,
    surface: "computer",
    status: "live", // PR4: self-serve venue shell → SSO hand-off to the web console
    createRpc: "self_serve_create_venue",
    ownerModel: "venue_admins",
    gateLevel: "pending",
    flagsPreset: null,
  },
  {
    key: "tournament",
    label: "Tournament",
    sublabel: "Run a one-day cup from your phone",
    Icon: Medal, // distinct from competitive's Trophy
    surface: "native", // the whole run-it-pitch-side flow lives in the app
    status: "soon", // DARK until PR #5 (compliance + real-device walk) — one-line flip to "live"
    createRpc: "self_serve_create_tournament", // mig 489
    ownerModel: "venue_admins", // via the hidden personal-host venue + Stage-1b
    gateLevel: "open",
    flagsPreset: null,
  },
  {
    key: "club",
    label: "Football club",
    sublabel: "Age groups, teams & members",
    Icon: UsersThree,
    surface: "computer",
    status: "soon", // PR5
    createRpc: null,
    ownerModel: "venue_admins",
    gateLevel: "pending",
    flagsPreset: null,
  },
  {
    key: "gym",
    label: "Gym",
    sublabel: "Classes, sessions & memberships",
    Icon: Barbell,
    surface: "computer",
    status: "soon", // PR6
    createRpc: null,
    ownerModel: "venue_admins",
    gateLevel: "pending",
    flagsPreset: null,
  },
];
