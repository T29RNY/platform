import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowRight, LinkSimple } from "@phosphor-icons/react";
import { colors as C, computeDeeperIntel, sortByReservePriority } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import {
  getPlayers,
  getMatches,
  getBibHistory,
  getSchedule,
  getSettings,
  getTeamByJoinCode, playerJoinTeam, redeemInviteLink,
  getTeamStateByPlayerToken, getTeamStateByAdminToken,
  getCoverPool,
  getSession, getPlayerTeams, logAppBoot,
  linkPlayerToUser, updateUserProfile, claimMyAdminTeams,
  resetDemoData, updateDemoInteraction,
  memberGetSelf,
  getUserRelationships,
  getMyWorld, claimTeamAdmin, getMyAdminTeams,
  getTeamFeatureFlags, refLinkSelfToOfficial, venueClaimMemberships,
} from "@platform/core/storage/supabase.js";
import { deriveSquadContext } from "./lib/deriveContext.js";
import { squadDestination } from "./lib/squadDestination.js";
import { writeLastContext, readLastContext } from "./lib/lastContext.js";
import ContextSwitcher from "./components/ContextSwitcher.jsx";
import { TourProvider } from "./components/TourProvider.jsx";
import { SEED_COVER } from "./seeds.js";
import LoadingScreen from "./views/LoadingScreen.jsx";
import PlayerView    from "./views/PlayerView.jsx";
import StatsView     from "./views/StatsView.jsx";
import HistoryView   from "./views/HistoryView.jsx";
import AdminView     from "./views/AdminView/index.jsx";
import Onboarding    from "./onboarding/index.jsx";
import JoinTeam             from "./views/JoinTeam.jsx";
import InviteResolve        from "./views/InviteResolve.jsx";
import MemberPass           from "./views/MemberPass.jsx";
import MemberProfile        from "./views/MemberProfile.jsx";
import SessionsScreen       from "./views/SessionsScreen.jsx";
import ClassesScreen        from "./views/ClassesScreen.jsx";
import BookPT               from "./views/BookPT.jsx";
import UnifiedFeedScreen   from "./views/UnifiedFeedScreen.jsx";
// ParentHomeScreen (legacy guardian shell) fully retired in shell-unify PR #6/#6b —
// /parent-home now redirects to the normal landing router; the view file is deleted.
import MobileShell         from "./mobile/MobileShell.jsx";
import { resolveRoles }    from "./mobile/nav.js";
import TournamentScreen    from "./views/TournamentScreen.jsx";
import MatchdayScreen      from "./views/MatchdayScreen.jsx";
import EmbedLeagueScreen   from "./views/EmbedLeagueScreen.jsx";
import ClubPublicScreen    from "./views/ClubPublicScreen.jsx";
import ClubTrialScreen     from "./views/ClubTrialScreen.jsx";
import TournamentJoinScreen from "./views/TournamentJoinScreen.jsx";
import FollowLiveView      from "./views/FollowLiveView.jsx";
import EmailCaptureOverlay  from "./views/EmailCaptureOverlay.jsx";
import JoinSuccess   from "./views/JoinSuccess.jsx";
import AuthCallback  from "./views/AuthCallback.jsx";
import SignIn        from "./views/SignIn.jsx";
import AuthGateModal from "./components/AuthGateModal.jsx";
import AnalyticsConsentModal from "./components/AnalyticsConsentModal.jsx";
import { syncConsentToPostHog, hasAnalyticsDecision, setAnalyticsConsent, configureTelemetry } from "@platform/core";

// True only when we KNOW from a date of birth that the person is under 18.
// Unknown DOB (casual token players, members without a recorded DOB) → false,
// i.e. treated as an adult (LOCKED DECISION 5 — unknown-DOB users stay
// identified, minimal). A known minor is force-excluded from analytics.
function computeIsMinor(memberProfile) {
  const dob = memberProfile?.dob;
  if (!dob) return false;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age < 18;
}
import useRequireAuth from "./hooks/useRequireAuth.js";
import Legal         from "./views/Legal.jsx";
import FAQScreen     from "./views/FAQScreen.jsx";
import PWAWelcome   from "./views/PWAWelcome.jsx";
import GafferLauncher from "./views/Gaffer/GafferLauncher.jsx";
import SquadReady    from "./onboarding/steps/SquadReady.jsx";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700;800&family=Space+Mono:wght@700&display=swap";

// SHA-256 → lowercase hex. Derives a stable, non-reversible analytics id from
// a player token so the token itself never leaves the device. The player token
// is a bearer credential for /p/TOKEN routes — migration 064 hashes this same
// value server-side (md5) for exactly this reason. Returns null when the Web
// Crypto API is unavailable (non-secure context), which correctly skips
// identification rather than falling back to sending the raw token.
async function sha256Hex(input) {
  if (!input || !globalThis.crypto?.subtle) return null;
  try {
    const bytes = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (e) {
    console.error("sha256Hex error:", e);
    return null;
  }
}

const DEFAULT_SCHEDULE = {
  dayOfWeek:"Tuesday", kickoff:"19:00", venue:"", opensDay:"Wednesday",
  opensTime:"10:00", priorityLeadMins:60, pricePerPlayer:6,
  gameIsLive:false, squadSize:14, gameDateTime:null,
  isDraft:true, isCancelled:false, cancelReason:"",
};
const DEFAULT_SETTINGS = { groupName:"My Team" };

// ─── Feature flags ────────────────────────────────────────────────────────────
const ENABLE_GAFFER = import.meta.env.VITE_GAFFER_ENABLED === 'true';

// Resume a signed-in, hub-eligible user to their EXACT last /hub sub-context
// (hat · child · tab, written by MobileShell via lib/lastContext), not bare /hub.
// Safe because /hub is the caller's OWN auth-scoped home — never a token link, so
// the "Rocky" guard (App Store 2.1(a), which only blocks /p/ and /admin/ breadcrumbs)
// does not apply. Falls back to bare /hub when there's no fresh hub breadcrumb.
function hubResumeTarget() {
  const lc = readLastContext();
  // Exact /hub route only (not a "/hubbub"-style prefix collision) — the /hub path
  // is always the caller's own auth-scoped home, so this can never redirect a
  // signed-in user onto another identity's surface the way a /p/ or /admin/ token
  // breadcrumb could (the "Rocky" guard).
  const isHub = !!lc && (lc === "/hub" || lc.startsWith("/hub/") || lc.startsWith("/hub?"));
  return isHub ? lc : "/hub";
}

// ─── Routing ──────────────────────────────────────────────────────────────────
function getRoute() {
  const parts = window.location.pathname.split("/").filter(Boolean);

  // For player/admin routes — save localStorage immediately, before any async work
  if ((parts[0]==="p" || parts[0]==="admin") && parts[1]) {
    const path = window.location.pathname;
    const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

    // Always keep lastVisited fresh — used for permanent redirect on every subsequent app open
    localStorage.setItem("ioo_last_visited", path);

    // On iOS Safari non-standalone — also set redirectTo for fresh-install bridge
    if (isIOS && !isStandalone) {
      const payload = JSON.stringify({ path, ts: Date.now() });
      localStorage.setItem("ioo_redirect_to", payload);
    }

    if (parts[0]==="p") return { type:"player", token:parts[1] };
    return { type:"admin", token:parts[1] };
  }

  if (parts[0]==="demoadmin")                  return { type:"demoadmin" };
  if (parts[0]==="create")                    return { type:"create" };
  if (parts[0]==="join"          && parts[1]) return { type:"join",     code:parts[1] };
  if (parts[0]==="q"             && parts[1]) return { type:"qr",       code:parts[1] };
  if (parts[0]==="m"             && parts[1]) return { type:"member",   token:parts[1] };
  if (parts[0]==="profile")                  return { type:"profile" };
  if (parts[0]==="sessions")                 return { type:"sessions" };
  if (parts[0]==="classes")                  return { type:"classes" };
  if (parts[0]==="book")                     return { type:"book" };
  if (parts[0]==="signin")                   return { type:"signin" };
  if (parts[0]==="parent-home")              return { type:"parent-home" };
  if (parts[0]==="feed")                     return { type:"feed" };
  if (parts[0]==="hub")                      return { type:"hub", sub: parts.slice(1) };
  if (parts[0]==="follow-live" && parts[1])  return { type:"follow-live", profileId:parts[1] };
  if (parts[0]==="tournament" && parts[1]==="join" && parts[2]) return { type:"tournament_join", code:parts[2] };
  if (parts[0]==="tournament"  && parts[1])  return { type:"tournament",  slug:parts[1] };
  if (parts[0]==="matchday"    && parts[1])  return { type:"matchday",    code:parts[1] };
  if (parts[0]==="embed" && parts[1]==="league" && parts[2]) return { type:"embed_league", code:parts[2] };
  if (parts[0]==="c" && parts[1] && parts[2]==="trial") return { type:"club_trial", slug:parts[1] };
  if (parts[0]==="c"           && parts[1])  return { type:"club_public", slug:parts[1] };
  if (parts[0]==="auth"          && parts[1]==="callback") return { type:"auth_callback" };
  if (["legal","privacy","terms"].includes(parts[0])) return { type:"legal" };
  if (parts[0]==="faq")                      return { type:"faq" };
  if (window.location.hostname==="localhost") return { type:"admin",    token:"local" };

  // Redirect bridge — only at root "/".
  try {
    // SKIP the whole bridge when an auth session exists. This "resume to my last
    // token link" feature is for ANONYMOUS token players reopening the PWA. A
    // signed-in user must land on their OWN account home, never on a remembered
    // /p/ or /admin/ breadcrumb — otherwise a stale link drops a freshly-signed-in
    // session onto ANOTHER player's passwordless token view (no Sign Out, wrong
    // identity = the "bugged and signed me in as Rocky" bug, App Store 2.1(a)).
    // getRoute runs synchronously before onAuthStateChange, so this must be a sync
    // storage check (the supabase session token, default key sb-<ref>-auth-token),
    // not the async getSession().
    let signedIn = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) { signedIn = true; break; }
      }
    } catch { /* storage unavailable — treat as not signed in */ }

    if (!signedIn) {
      // NEVER auto-resume onto a /p/ or /admin/ TOKEN link. Those routes are entered
      // only by an explicit tap (handled at the top of getRoute). A token breadcrumb
      // can point at ANOTHER player's link — one an admin previewed, or the squad[0]
      // fallback that renders an unlinked admin AS the first squad member — so
      // auto-resuming it drops a cold launch onto a stranger's passwordless profile
      // with no Sign Out ("reopen → signed in as Rocky", App Store 2.1(a)). Only
      // non-token app routes (sessions/feed/member/club) are safe to auto-resume.
      const isTokenLink = (p) => /^\/(p|admin)\//.test(p || "");

      const stored = localStorage.getItem("ioo_redirect_to");
      if (stored) {
        try {
          const { path, ts } = JSON.parse(stored);
          const age = Date.now() - ts;
          if (path && ts && age < 7 * 24 * 60 * 60 * 1000 && !isTokenLink(path)) {
            localStorage.removeItem("ioo_redirect_to");
            window.location.replace(path);
            return { type:"redirecting" };
          }
        } catch { /* malformed payload — fall through to drop it */ }
        // Expired / unsafe / garbage — remove it.
        localStorage.removeItem("ioo_redirect_to");
      }

      // Context-aware resume (multi-context nav): prefer the structured last-context
      // — written on every resumable context route, so a club/guardian member resumes
      // where they actually were, not on a dormant squad. Falls back to the legacy
      // squad-only breadcrumb for users who predate the structured key.
      const lastContext = readLastContext();
      if (lastContext && !isTokenLink(lastContext)) {
        window.location.replace(lastContext);
        return { type:"redirecting" };
      }

      const last = localStorage.getItem("ioo_last_visited");
      if (last && !isTokenLink(last)) {
        window.location.replace(last);
        return { type:"redirecting" };
      }
    }
  } catch(e) {
    console.error("[ioo] redirect bridge error:", e);
  }

  // Standalone PWA with no known player — show welcome screen, not the create-a-team landing
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  if (isStandalone) {
    return { type:"pwa_welcome" };
  }

  return { type:"landing" };
}

// Player-token RPC (mig 080) returns the caller in state.squad with
// is_self=true for VCs and team admins; for ordinary players the caller is
// excluded. The caller record is also returned separately as state.player
// (sourced from to_jsonb(p.*), so it carries user_id but lacks group_number
// and is_self). Merge the squad-row's fields onto state.player and drop the
// duplicate row from the squad. No-op when the caller is excluded server-side.
function buildPlayerSquad(player, squad) {
  const selfFromSquad = squad.find(p => p.id === player.id);
  const me = selfFromSquad ? { ...player, ...selfFromSquad } : player;
  return [me, ...squad.filter(p => p.id !== player.id)];
}

// ─── Client-side stats derivation from match history ─────────────────────────
// Used by admin routes where the RPC doesn't include a stats block.
function computeStatsFromHistory(playerId, squad, matches, bibHistory) {
  const player = squad.find(p => p.id === playerId);
  if (!player) return null;

  const playerNames = new Set([player.name?.toLowerCase()]);
  if (player.nickname) playerNames.add(player.nickname.toLowerCase());

  const total  = matches.filter(m => !m.cancelled).length;
  const played = matches.filter(m => !m.cancelled && m.winner);

  const results = [];
  let wins = 0, draws = 0, losses = 0, goals = 0, potm = 0;

  for (const m of played) {
    // Recent matches store player IDs in teamA/teamB; legacy store names.
    const isMe = (v) => v === playerId || playerNames.has(v?.toLowerCase());
    const inA = (m.teamA || []).some(isMe);
    const inB = (m.teamB || []).some(isMe);
    if (!inA && !inB) continue;

    let result;
    if (m.winner === "D")                              { result = "d"; draws++;  }
    else if ((m.winner === "A" && inA) || (m.winner === "B" && inB)) { result = "w"; wins++;   }
    else                                               { result = "l"; losses++; }

    for (const [key, g] of Object.entries(m.scorers || {})) {
      if (key === playerId || playerNames.has(key?.toLowerCase())) goals += (g || 0);
    }

    if (m.motm) {
      if (m.motm === playerId || playerNames.has(m.motm?.toLowerCase())) potm++;
    }

    results.push(result);
  }

  const attended = wins + draws + losses;
  const winRate  = attended > 0 ? Math.round((wins / attended) * 100) : 0;

  // currentRun — matches arrive newest-first from the RPC
  const last20 = results.slice(0, 20);
  let currentRun = null;
  if (last20.length >= 1) {
    const first = last20[0];
    let len = 0;
    for (const r of last20) {
      if (first === "l" ? r !== "l" : r === "l") break;
      len++;
    }
    if (len >= 2) currentRun = { type: first === "l" ? "losing" : "unbeaten", length: len };
  }

  const reliability = total > 0 ? Math.round((attended / total) * 100) : null;

  // lastMatchMeta — most recent played match (matches arrive newest-first)
  const lastPlayedMatch = played[0] || null;
  const currentBibEntry = (bibHistory || []).find(b => b.returned === false);
  const bibHolderId = currentBibEntry?.playerId ?? currentBibEntry?.player_id ?? null;
  const lastMatchMeta = lastPlayedMatch ? {
    motm:      lastPlayedMatch.motm || null,
    matchDate: lastPlayedMatch.date || lastPlayedMatch.matchDate || null,
    bibHolder: bibHolderId,
  } : null;

  // playerForm — map of playerId → ["w","d","l",...] oldest-first (max 5)
  const nameToId = {};
  const idSet = new Set();
  squad.forEach(p => {
    idSet.add(p.id);
    if (p.name) nameToId[p.name.toLowerCase()] = p.id;
    if (p.nickname) nameToId[p.nickname.toLowerCase()] = p.id;
  });
  const formAccum = {};
  for (const m of played) {
    const processTeam = (entries, teamKey) => {
      for (const v of (entries || [])) {
        // Recent matches store player IDs; legacy store names.
        const pid = idSet.has(v) ? v : nameToId[v?.toLowerCase()];
        if (!pid) continue;
        if (!formAccum[pid]) formAccum[pid] = [];
        if (formAccum[pid].length >= 5) continue;
        let r;
        if (m.winner === "D") r = "d";
        else if (m.winner === teamKey) r = "w";
        else r = "l";
        formAccum[pid].push(r);
      }
    };
    processTeam(m.teamA, "A");
    processTeam(m.teamB, "B");
  }
  const playerForm = Object.entries(formAccum).map(
    ([pid, form]) => ({ player_id: pid, form: [...form].reverse() })
  );

  const intel = computeDeeperIntel(playerId, squad, matches);

  return {
    matchStats:  { games: attended, goals, motm: potm, wins, losses, draws, attended, bibs: 0 },
    winRate:     { played: attended, wins, draws, losses, winRate },
    currentRun,
    reliability,
    leagueRaw:   [],
    lastMatchMeta,
    playerForm,
    ...intel,
  };
}

export default function App() {
  const route = getRoute();
  const [view,         setView]        = useState("player");
  const [loading,      setLoading]     = useState(true);
  const [error,        setError]       = useState(null);
  const [teamId,       setTeamId]      = useState(null);
  const [squad,        setSquadRaw]    = useState([]);
  const [bibHistory,   setBibHistRaw]  = useState([]);
  const [schedule,     setScheduleRaw] = useState(DEFAULT_SCHEDULE);
  const [matchHistory, setMatchHistRaw]= useState([]);
  const [settings,     setSettingsRaw] = useState(DEFAULT_SETTINGS);
  const [coverPool,    setCoverPoolRaw]= useState([]);
  const [statsRaw,     setStatsRaw]    = useState(null);
  const [myPlayer,     setMyPlayer]    = useState(null);
  const [playerTeams,  setPlayerTeams] = useState([]);
  const [selectedTeam, setSelectedTeam]= useState(null);
  const [isAdmin,      setIsAdmin]     = useState(false);
  // live_channel_key from the team-state RPC. Used by the broadcast
  // realtime subscriber below — server publishes via notify_team_change to
  // `team_live:<key>`. Broadcast channels are NOT gated by RLS, so this
  // delivers live updates to anon clients too.
  const [liveChannelKey, setLiveChannelKey] = useState(null);

  // Auth gate hook — used by handleJoin to prompt sign-in when an unauthed
  // PWA user taps "Join". After sign-in, the original join action retries
  // automatically (carries the name from JoinTeam's NameStep through).
  const joinAuthGate = useRequireAuth();

  // Track which PlayerView tab to open on next mount
  const playerStartTabRef = useRef(null);

  // Admin sub-screen (hoisted so Gaffer can navigate)
  const [adminScreen,    setAdminScreen]  = useState("main");
  // Gaffer: blocks navigate actions when player is mid-flow
  const [isActionBlocked, setIsActionBlocked] = useState(false);

  // Landing player-link input
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkInput,     setLinkInput]     = useState("");

  // Join flow state
  const [joinTeam,       setJoinTeam]      = useState(null);
  const [joinedPlayer,   setJoinedPlayer]  = useState(null);
  const [joinLoading,    setJoinLoading]   = useState(false);
  const [joinError,      setJoinError]     = useState(null);
  const [joinPrefillName,setJoinPrefillName]= useState("");
  const [joinChecking,   setJoinChecking]  = useState(false);

  // Auth state
  const [authUser,     setAuthUser]    = useState(null);
  const [authReady,    setAuthReady]   = useState(false);

  // Member profile — populated when authUser is set. Used by SessionsScreen
  // (passed as prop to avoid a duplicate memberGetSelf() call) and by the
  // My Squads switcher to surface club membership entries.
  const [memberProfile, setMemberProfile] = useState(null);

  // Phase 0 — routing oracle. Populated from get_user_relationships() when
  // authUser resolves. Null until then — guarantees squad-only unauthenticated
  // users are never affected.
  const [relationships, setRelationships] = useState(null);

  // Unified login (Step 2). Teams the signed-in account is a verified admin of,
  // each with its admin_token (mig 376 get_my_admin_teams). Lets the landing send
  // an admin straight into their admin view from a plain login — no /admin/<token>
  // URL needed. null = not loaded yet (landing waits on it so a player+admin is
  // never briefly sent to their player view before admin status is known).
  const [myAdminTeams, setMyAdminTeams] = useState(null);

  // Phase 0c — Unified Identity & Sync Spine. The get_my_world() resolver
  // (mig 372) is the single source for the context switcher: every hat the
  // signed-in person holds (squads, clubs, each child, referee assignments,
  // club-team coaching) plus play-vs-ref conflicts. Loaded once auth resolves;
  // null for anon/squad-only users so they are never affected.
  const [myWorld, setMyWorld] = useState(null);
  // True once get_my_world() has RESOLVED (ok OR failed) for the signed-in user.
  // Lets landing/-feed routing tell "hats still loading" apart from "loaded, no
  // hats" — so we neither flash the legacy /feed nor hang on a get_my_world error.
  const [myWorldReady, setMyWorldReady] = useState(false);

  // Multi-context nav (Phase 1). squadCtxInputs = the team-state context fields
  // captured on load; featureFlags = the per-team kill-switch (default off →
  // everything below ships dark). Both are plumbing only until the flag is on.
  const [squadCtxInputs, setSquadCtxInputs] = useState(null);
  const [featureFlags,   setFeatureFlags]   = useState(null);
  const [showSwitcher,   setShowSwitcher]   = useState(false);
  const [switcherSquads, setSwitcherSquads] = useState([]);

  // Derived home-screen type. Only meaningful when authUser + relationships
  // are both present. "squad_only" → no new screens; existing paths unchanged.
  const homeScreenType = (() => {
    if (!authUser || !relationships) return null;
    const hasGuardian = (relationships.guardian_of?.length ?? 0) > 0;
    const hasClubs    = (relationships.club_memberships?.length ?? 0) > 0;
    const hasSquads   = (relationships.squads?.length ?? 0) > 0;
    if (hasGuardian)           return hasSquads ? "multi" : "parent";
    if (hasClubs && hasSquads) return "multi";
    if (hasClubs)              return "club_member";
    return "squad_only";
  })();

  // Does this signed-in person hold ≥1 mobile /hub hat (operator / club-admin /
  // team-manager / guardian / referee / member)? Drives retirement of the legacy
  // /feed multi-context home: anyone hub-eligible lands on the /hub role home
  // instead. Pure casual / multi-team players with NO hub hat keep /feed. Empty
  // until get_my_world resolves (guard on myWorldReady before routing on it).
  const hubEligible = !!myWorld && resolveRoles(myWorld).length > 0;

  // Just-created overlay state. After useOnboarding finishes create_team it
  // hard-redirects to /admin/<token>?just_created=1 (so the inline manifest
  // script in index.html can inject /api/manifest?admin=<token> at HTML
  // parse time — required for iOS PWA install). On the resulting page load,
  // pull the stashed SquadReady props out of sessionStorage and render
  // SquadReady as a top-level overlay BEFORE any view-routing happens.
  // Done at App.jsx level (not AdminView) because the default view on
  // /admin/<token> is "player", and AdminView never mounts until the user
  // taps the admin tab — which is why the overlay wasn't appearing.
  const [justCreatedData, setJustCreatedData] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('just_created') !== '1') return null;
      const raw = sessionStorage.getItem('ioo_just_created');
      if (!raw) return null;
      sessionStorage.removeItem('ioo_just_created');
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  });

  // Same pattern, post-join overlay. handleJoin redirects to
  // /p/<player_token>?just_joined=1 (so the inline manifest script in
  // index.html can inject /api/manifest?player=<token> for iOS PWA install).
  // Read sessionStorage on mount and render JoinSuccess as a top-level
  // overlay. Without this, the install carousel would show at /join/<code>
  // where iOS bakes start_url=/ instead of start_url=/p/<token>.
  const [justJoinedData] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('just_joined') !== '1') return null;
      const raw = sessionStorage.getItem('ioo_just_joined');
      if (!raw) return null;
      sessionStorage.removeItem('ioo_just_joined');
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  });

  // Email capture overlay (visit 3+ for unlinked token players)
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [linkConflict,     setLinkConflict]     = useState(null);

  // Analytics opt-in. PostHog boots opted-out; restore the stored choice, and if
  // the person has never been asked, show the one-time consent prompt.
  const [showAnalyticsConsent, setShowAnalyticsConsent] = useState(false);
  useEffect(() => {
    try {
      syncConsentToPostHog();
      if (!hasAnalyticsDecision()) setShowAnalyticsConsent(true);
    } catch (e) { console.error("analytics consent init failed", e); }
  }, []);

  // Never ask a known minor to consent — they are excluded from analytics
  // regardless, so the prompt would be both pointless and inappropriate.
  useEffect(() => {
    if (computeIsMinor(memberProfile)) setShowAnalyticsConsent(false);
  }, [memberProfile]);

  // Live telemetry context for the @platform/core chokepoint. Every track()
  // event gets stamped with the active hat + the full hat set, and is suppressed
  // for a known minor. Held in a ref so the getContext closure always reads
  // current values without re-registering.
  const isMinor = computeIsMinor(memberProfile);
  const telemetryHats = (myWorld ? resolveRoles(myWorld) : []).map((r) => r.key);
  const telemetryActiveHat = (() => {
    try { return new URLSearchParams(window.location.search).get("hat") || null; }
    catch (e) { return null; }
  })();
  const telemetryCtxRef = useRef({ activeHat: null, hats: [], isMinor: false });
  telemetryCtxRef.current = { activeHat: telemetryActiveHat, hats: telemetryHats, isMinor };
  useEffect(() => {
    configureTelemetry({ getContext: () => telemetryCtxRef.current });
  }, []);

  // MINOR ENFORCEMENT (the teeth behind the Legal "no analytics profiles of
  // under-18s" line). track()'s isMinor gate is not enough on its own —
  // autocapture ($pageview) and identify() bypass track(). So for a known minor
  // we hard opt-out of ALL capture and reset any profile, regardless of any
  // consent they (or a guardian) may have granted. Runs whenever minor status
  // resolves true.
  useEffect(() => {
    if (!isMinor || !window.posthog) return;
    try {
      window.posthog.opt_out_capturing?.();
      window.posthog.reset?.();
      window.posthog.register?.({ app: "inorout" });
    } catch (e) { console.error("minor analytics opt-out failed", e); }
  }, [isMinor]);

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet"; el.href = FONT_LINK;
    document.head.appendChild(el);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // CRITICAL — iOS PWA install path. Do NOT remove or refactor without
  // reading apps/inorout/api/manifest.js + apps/inorout/vercel.json headers
  // config + apps/inorout/src/onboarding/steps/SquadReady.jsx FIRST.
  //
  // Owns the <link rel="manifest"> href across route transitions. On admin
  // routes, points at /api/manifest?admin=<token> so iOS bakes /admin/<token>
  // into the home-screen icon at install time. On every other route,
  // restores the default /manifest.json. SquadReady's local effect handles
  // the create-flow case where the user installs without ever visiting an
  // /admin/<token> URL.
  //
  // Rules:
  // - guard MUST validate route.token against the admin regex BEFORE swap
  //   (avoids ?admin=undefined writes during route transitions)
  // - swap key MUST be both route.type AND route.token (not just type)
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    if (route.type === "admin" && route.token && /^admin_[A-Za-z0-9_-]+$/.test(route.token)) {
      link.setAttribute('href', `/api/manifest?admin=${encodeURIComponent(route.token)}`);
    } else if (route.type === "player" && route.token && /^p_[A-Za-z0-9_-]+$/.test(route.token)) {
      link.setAttribute('href', `/api/manifest?player=${encodeURIComponent(route.token)}`);
    } else if (route.type === "feed" || route.type === "sessions" || route.type === "parent-home" || route.type === "profile") {
      // Multi-context nav (Phase 1): non-squad users (guardians / club-only
      // members) install /feed as their home. Path-relative — inherits BASE_URL.
      link.setAttribute('href', '/api/manifest?feed=1');
    } else {
      link.setAttribute('href', '/manifest.json');
    }
  }, [route.type, route.token]);

  // On /create when unauthed, persist the intended destination BEFORE the
  // user taps Google OAuth, in both sessionStorage AND localStorage. Safari
  // can drop sessionStorage on cross-origin OAuth roundtrips, so the
  // localStorage backup is the actual safety net. Both are read by
  // AuthCallback (sessionStorage.ioo_pending_route first, then
  // localStorage.auth_return_to as fallback).
  useEffect(() => {
    if (route.type !== "create") return;
    if (authUser) return;
    try { sessionStorage.setItem("ioo_pending_route", "/create"); } catch(e) {}
    try { localStorage.setItem("auth_return_to", "/create"); } catch(e) {}
  }, [route.type, authUser]);

  // Resolve the initial auth session before painting any route-specific UI.
  // Without this, /join/CODE renders with authUser=null on the first paint
  // after /auth/callback redirects back, showing the sign-in button to a user
  // who is in fact already signed in — and a second OAuth round trip is what
  // creates the visible "redirect loop" bug.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;
        if (session?.user) setAuthUser(session.user);
      } catch (e) {
        console.error("initial session check failed:", e);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (route.type === "landing" || route.type === "auth_callback") {
      setLoading(false); return;
    }

    if (route.type === "join") {
      // Store pending join so AuthCallback can redirect back here even if Supabase
      // strips the returnTo query param (URL allowlist doesn't include wildcards)
      try {
        sessionStorage.setItem("ioo_pending_join", JSON.stringify({
          returnTo: window.location.pathname,
        }));
      } catch(e) {}
      getTeamByJoinCode(route.code).then(team => {
        if (team) setJoinTeam(team);
        setLoading(false);
      });
      return;
    }

    async function load() {
      try {
        // NOTE: no forced refreshSession() on boot. supabase-js owns token
        // refreshing (autoRefreshToken:true in supabase.js). A manual refresh
        // here races the SDK's own auto-refresh — each manual rotation revokes
        // the token the SDK is mid-refresh on, and in a WKWebView where storage
        // doesn't reliably round-trip that became a ~1/sec refresh storm → 429
        // → logout (App Store 2.1(a) rejection, s199). getSession() below reads
        // the persisted session and the SDK refreshes it lazily when needed.

        // Auth session is also resolved by the top-level authReady effect for
        // gating the UI. We still read it locally here because the load body
        // below uses `session` directly (admin/player auto-link to the auth
        // user). Cheap — supabase caches.
        const session = await getSession();

        // Telemetry — one audit_events row per app boot. Captures route,
        // display mode (PWA vs browser), and whether the client thinks
        // it's authed. The server-side actor_user_id captures whether the
        // JWT actually attached. Comparison surfaces auth-attachment bugs.
        // Fire-and-forget; cannot break boot.
        {
          const isStandalone = window.navigator.standalone === true
            || (typeof window.matchMedia === 'function'
                && window.matchMedia('(display-mode: standalone)').matches);
          const displayMode = isStandalone ? 'standalone' : 'browser';
          logAppBoot(route.token || null, route.type || 'unknown', displayMode, !!session?.user)
            .catch(() => { /* telemetry only */ });
        }
        let resolvedTeamId = null;

        if (route.type === "demoadmin") {
          setIsAdmin(true);
          setView("admin");
          try { await updateDemoInteraction(); } catch(e) {}
          const state = await getTeamStateByAdminToken("admin_demo");
          if (!state) { setError("Demo data unavailable."); setLoading(false); return; }
          setTeamId(state.teamId);           setSelectedTeam(state.teamId);
          setSquadRaw(state.squad);          setMatchHistRaw(state.matches);
          setBibHistRaw(state.bibHistory);   setScheduleRaw(state.schedule || DEFAULT_SCHEDULE);
          setSettingsRaw(state.settings || DEFAULT_SETTINGS);
          setCoverPoolRaw(state.coverPool);
          setLiveChannelKey(state.liveChannelKey || null);
          // /demoadmin always plays as Hassan — the demo protagonist with the
          // richest shared-game history. Auth session is ignored on this public
          // showcase route.
          const demoAdminPlayer = state.squad.find(p => p.id === 'p_demo_01');
          if (demoAdminPlayer) {
            setMyPlayer(demoAdminPlayer);
            setStatsRaw(computeStatsFromHistory(demoAdminPlayer.id, state.squad, state.matches, state.bibHistory));
          }
          // Always compute squad-wide stats (form dots + bibs)
          // regardless of whether admin has a linked player record
          if (state.squad?.length) {
            const squadStats = computeStatsFromHistory(
              state.squad[0].id,
              state.squad,
              state.matches,
              state.bibHistory
            );
            setStatsRaw(prev => ({
              ...(prev || {
                matchStats: null, winRate: null, currentRun: null,
                reliability: null, leagueRaw: [],
              }),
              playerForm:    squadStats?.playerForm    || [],
              lastMatchMeta: squadStats?.lastMatchMeta || null,
            }));
          }
          setLoading(false);
          return;
        }

        if (route.type === "admin") {
          if (route.token === "local") {
            // /admin/local dev shortcut — pre-RLS read to pick the sole team_id
            // during local development. Not user-facing.
            const { data } = await supabase.from("teams").select("id").limit(1).single(); // hygiene-exempt: /admin/local
            resolvedTeamId = data?.id;
            setIsAdmin(true);
          } else {
            const state = await getTeamStateByAdminToken(route.token);
            if (!state) { setError("Invalid admin link."); setLoading(false); return; }
            setIsAdmin(true);
            // Unified login (Step 1b): a signed-in visitor to a valid admin link is
            // enrolled as a real account-admin so their LOGIN alone grants admin
            // access from then on. Fire-and-forget — must never block admin entry.
            if (session?.user) claimTeamAdmin(route.token);
            setTeamId(state.teamId);           setSelectedTeam(state.teamId);
            setSquadRaw(state.squad);          setMatchHistRaw(state.matches);
            setBibHistRaw(state.bibHistory);   setScheduleRaw(state.schedule || DEFAULT_SCHEDULE);
            setSettingsRaw(state.settings || DEFAULT_SETTINGS);
            setCoverPoolRaw(state.coverPool);
            setLiveChannelKey(state.liveChannelKey || null);
            setSquadCtxInputs({ teamType: state.teamType, isCompetitive: state.isCompetitive, clubId: state.clubId, clubName: state.clubName });
            // Resolve the admin's own player row. Migration 070 marks the
            // admin's row with is_self=true (auth.uid() match) and exposes
            // every row's token so the admin can share /p/<token> links.
            // Falls through to null if auth is missing or the admin isn't
            // a player on this team.
            const adminPlayer = state.squad.find(p => p.isSelf);
            if (adminPlayer) {
              setMyPlayer(adminPlayer);
              setStatsRaw(computeStatsFromHistory(adminPlayer.id, state.squad, state.matches, state.bibHistory));
            }
            // Always compute squad-wide stats (form dots + bibs)
            // regardless of whether admin has a linked player record
            if (state.squad?.length) {
              const squadStats = computeStatsFromHistory(
                state.squad[0].id,
                state.squad,
                state.matches,
                state.bibHistory
              );
              setStatsRaw(prev => ({
                ...(prev || {
                  matchStats: null, winRate: null, currentRun: null,
                  reliability: null, leagueRaw: [],
                }),
                playerForm:    squadStats?.playerForm    || [],
                lastMatchMeta: squadStats?.lastMatchMeta || null,
              }));
            }
            setLoading(false);
            return;
          }
        }

        if (route.type === "player") {
          if (route.token?.startsWith("p_demotoken_")) {
            try { await updateDemoInteraction(); } catch(e) {}
          }
          const state = await getTeamStateByPlayerToken(route.token);
          if (!state) { setLoading(false); return; }
          const player = state.player;

          // Visit count — increment on every load
          const vcKey = `ioo_visit_count_${route.token}`;
          const visitCount = (parseInt(localStorage.getItem(vcKey) || "0", 10)) + 1;
          localStorage.setItem(vcKey, String(visitCount));

          // If auth'd and not yet linked — attempt to link
          if (session?.user && !player.userId) {
            try {
              const myTeams = await getPlayerTeams();
              // If the auth user already has any player record, it belongs to a different player
              if (myTeams.length > 0) {
                setLinkConflict("This email is already linked to another account — contact your admin");
              } else {
                await linkPlayerToUser(route.token);
                const display_name = session.user.user_metadata?.full_name
                  || session.user.user_metadata?.name
                  || session.user.email;
                try { await updateUserProfile(session.user.id, { display_name }); } catch(e) {}
                player.userId = session.user.id;
                localStorage.setItem(vcKey, "0");
              }
            } catch(e) {}
          }

          // Show email capture overlay on visit 3+ if still unlinked. Exclude ALL
          // demo player tokens (p_demotoken_* AND the reviewer's p_demo_alex_token /
          // any p_demo_* link) so the App-Store demo links never pop a sign-up overlay.
          const isDemoToken = route.token?.startsWith('p_demotoken_') || route.token?.startsWith('p_demo_');
          if (!player.userId && visitCount >= 3 && !isDemoToken) setShowEmailCapture(true);

          setMyPlayer(player);
          setPlayerTeams([]);
          const resolvedId = state.teamId || state.player?.team || null;
          if (!resolvedId) { setError("Could not find your team."); setLoading(false); return; }
          setTeamId(resolvedId);             setSelectedTeam(resolvedId);
          setSquadRaw(buildPlayerSquad(player, state.squad));
          setMatchHistRaw(state.matches);    setBibHistRaw(state.bibHistory);
          setScheduleRaw(state.schedule || DEFAULT_SCHEDULE);
          setSettingsRaw(state.settings || DEFAULT_SETTINGS);
          setCoverPoolRaw(state.coverPool);
          setLiveChannelKey(state.liveChannelKey || null);
          setSquadCtxInputs({ teamType: state.teamType, isCompetitive: state.isCompetitive, clubId: state.clubId, clubName: state.clubName });
          {
            const intel = computeDeeperIntel(player.id, buildPlayerSquad(player, state.squad), state.matches);
            setStatsRaw({ ...(state.stats || {}), ...intel });
          }
          setLoading(false);
          return;
        }

        if (!resolvedTeamId) { setLoading(false); return; }
        await loadTeamData(resolvedTeamId);
      } catch (err) {
        console.error("Load error:", err);
        setError(err.message);
        setLoading(false);
      }
    }
    load();
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) setAuthUser(session.user);
        else {
          setAuthUser(null);
          // Clear the "resume to last screen" breadcrumb on an explicit SIGN-OUT
          // (not on a transient INITIAL_SESSION-null) so the NEXT account to sign in
          // on this device — e.g. a shared family iPad — can't be dropped onto the
          // previous user's last screen. Root cause behind the stale-context landing
          // (and the earlier "signed in as someone else" confusion).
          if (event === "SIGNED_OUT") {
            try {
              localStorage.removeItem("ioo_last_context");
              localStorage.removeItem("ioo_last_visited");
              localStorage.removeItem("ioo_redirect_to");
            } catch (e) { /* storage unavailable — non-fatal */ }
            // Same shared-device reasoning, applied to the analytics identity.
            // This is the CHOKE POINT: it also covers session expiry and a failed
            // token refresh, which end a session without any sign-out button being
            // pressed and so never reach the explicit sign-out call sites.
            try {
              window.posthog?.reset?.();
              // reset() clears super properties — put `app` back, or every event
              // for the rest of this page session ships unattributed (there is no
              // reload on the in-place sign-out path, so `loaded` will not re-fire).
              window.posthog?.register?.({ app: "inorout" });
            } catch (e) { console.error("posthog reset failed", e); }
          }
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  // Adopt any superadmin-created squad shells whose admin_email matches this signed-in
  // user (mig 240). Fire-and-forget + idempotent: makes the squad appear in My Squads the
  // first time the organiser signs in. Isolated side-effect — never blocks or breaks auth.
  useEffect(() => {
    if (!authUser) return;
    claimMyAdminTeams().catch(() => {});
  }, [authUser]);

  // Fetch member profile whenever auth user changes. Powers the SessionsScreen
  // (passed as prop so /sessions avoids a duplicate fetch) and the My Squads
  // switcher club entries.
  useEffect(() => {
    if (!authUser) { setMemberProfile(null); return; }
    memberGetSelf().then(p => setMemberProfile(p?.found ? p : null)).catch(() => {});
  }, [authUser]);

  useEffect(() => {
    if (!authUser) { setRelationships(null); return; }
    // On RPC failure set an EMPTY sentinel, never leave `null`. The landing
    // oracle gates on `relationships` being non-null; a swallowed error that
    // left it null forever hung the page on a blank/marketing splash for a
    // signed-in user (App Store 2.1(a) hang vector, s199). Empty → the
    // "signed-in, no team" onboarding renders, which is the correct fallback.
    getUserRelationships()
      .then(r => setRelationships(r || { squads: [], club_memberships: [], guardian_of: [] }))
      .catch(() => setRelationships({ squads: [], club_memberships: [], guardian_of: [] }));
  }, [authUser]);

  // Unified login (Step 2) — load the teams this account admins (with tokens).
  // Best-effort: a failure leaves an empty list, so the landing falls back to the
  // existing player-only routing. [] (not null) once resolved so the landing knows
  // it can act; reset to null while logged out.
  useEffect(() => {
    if (!authUser) { setMyAdminTeams(null); return; }
    getMyAdminTeams().then(a => setMyAdminTeams(a || [])).catch(() => setMyAdminTeams([]));
  }, [authUser]);

  // Phase 0c — load the unified "my world" resolver for the context switcher.
  // Best-effort: a failure just leaves the switcher to its squad rows.
  // First self-link any match-official cards that match this account's verified
  // email (ref_link_self_to_official sets match_officials.user_id → a trigger
  // fills person_id) so a referee's assignments surface in ref_assignments without
  // any manual setup. Idempotent + no-op for non-referees; never blocks world-load.
  // ALONGSIDE it, bind any pending venue/club invites on the same verified email
  // (venue_claim_memberships sets venue_admins.user_id + status='active' → the
  // mig-371 trigger fills person_id via ensure_person) so an owner invited by
  // superadmin_create_club resolves their club-admin hat in get_my_world — i.e. it
  // shows in the context switcher — from the first sign-in. Without this the invite
  // ONLY bound if the owner happened to open the desktop venue console (apps/venue
  // App.jsx makes the same call), so a phone-first club owner saw an empty app and
  // assumed it was broken. Idempotent (matches 0 rows for ~every user; cannot
  // re-activate a revoked admin — it requires status='invited' AND user_id IS NULL
  // AND revoked_at IS NULL), and never blocks world-load. Must land BEFORE
  // getMyWorld() so the freshly-claimed hat is in the very first resolve.
  // Binding the hat is necessary but NOT sufficient for a BRAND-NEW owner:
  // superadmin_create_club writes no member_profile/squad, so a squad-less owner
  // derives homeScreenType='squad_only' and the landing dropped them on the "paste
  // your player link" welcome screen — the switcher carried the hat but nothing
  // ROUTED to it. The other half now lives in the landing router's squad_only arm
  // (search hubResumeTarget): 0 destinations + hubEligible → /hub. Both halves are
  // required — this bind is what makes hubEligible true on that first sign-in.
  useEffect(() => {
    if (!authUser) { setMyWorld(null); setMyWorldReady(false); return; }
    let cancelled = false;
    // Safety valve: launch routing waits on myWorldReady, but the world load is
    // best-effort — a HUNG refLinkSelfToOfficial()/getMyWorld() (no RPC timeout)
    // must never brick the landing on an infinite spinner. Flip ready after 4s
    // regardless; a still-null myWorld then falls through to the legacy /feed
    // home (pre-change behaviour), never a permanent LoadingScreen.
    const readyTimer = setTimeout(() => { if (!cancelled) setMyWorldReady(true); }, 4000);
    (async () => {
      // PARALLEL, not serial: both are independent best-effort binds, and the
      // launch path only has a 4s readyTimer budget before it gives up and sends a
      // hub user to /feed. Serialising a 3rd round-trip pushed the chain from ~2 to
      // ~3 RTT — on pitch-side signal that lands ON the 4s valve and can flap the
      // very owner this fixes out to /feed. allSettled: neither can reject the pair.
      await Promise.allSettled([refLinkSelfToOfficial(), venueClaimMemberships()]);
      try {
        const w = await getMyWorld();
        if (!cancelled) setMyWorld(w?.ok ? w : null);
      } catch { /* leave the switcher to its squad rows */ }
      if (!cancelled) setMyWorldReady(true);
    })();
    return () => { cancelled = true; clearTimeout(readyTimer); };
    // Gate on the STABLE user id, not the session object: onAuthStateChange hands a
    // fresh session.user on every TOKEN_REFRESHED (and the 5-min resume refresh), so
    // depending on the object re-fires these two WRITE binds needlessly. Same lesson
    // apps/clubmanager App.jsx already records.
  }, [authUser?.id]);

  // Full catch-up re-fetch. Single source of truth for the team_live broadcast
  // handler AND the PWA-resume handler. Re-fetches all team state via the
  // existing wrappers and replays it into the raw setters, branching by route
  // exactly like the initial load. Guarded by isRefreshing so the multiple
  // resume events (visibilitychange + pageshow + focus) coalesce into one
  // network round-trip. Declared above the resume effect because that effect's
  // dependency array references it — a later const would be in the TDZ.
  const isRefreshing = useRef(false);
  // Resume-handler auth-refresh throttle. MUST be a ref, not an effect-local
  // `let`: the resume effect's dep array is [refreshTeamData], which is rebuilt
  // on every route change (its deps are [route?.type, route?.token]). A local
  // `let lastAuthRefresh = 0` reset to 0 on each rebuild, defeating the 5-min
  // throttle so a navigate-heavy session re-refreshed the token repeatedly. A
  // ref persists across effect re-runs.
  const lastAuthRefresh = useRef(0);
  const refreshTeamData = useCallback(async () => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;
    try {
      if (route?.type === "player" && route?.token) {
        const state = await getTeamStateByPlayerToken(route.token);
        if (state && state.player) {
          const ps = buildPlayerSquad(state.player, state.squad);
          setSquadRaw(ps);
          setScheduleRaw(state.schedule || DEFAULT_SCHEDULE);
          setMatchHistRaw(state.matches);
          setBibHistRaw(state.bibHistory);
          setSettingsRaw(state.settings || DEFAULT_SETTINGS);
          setCoverPoolRaw(state.coverPool);
          const intel = computeDeeperIntel(state.player.id, ps, state.matches || []);
          setStatsRaw({ ...(state.stats || {}), ...intel });
        }
      } else if (route?.type === "admin" || route?.type === "demoadmin") {
        const tok = route.type === "demoadmin" ? "admin_demo" : route.token;
        const state = await getTeamStateByAdminToken(tok);
        if (state) {
          setSquadRaw(state.squad);
          setScheduleRaw(state.schedule || DEFAULT_SCHEDULE);
          setMatchHistRaw(state.matches);
          setBibHistRaw(state.bibHistory);
          setSettingsRaw(state.settings || DEFAULT_SETTINGS);
          setCoverPoolRaw(state.coverPool);
        }
      }
    } catch (e) {
      console.error("refreshTeamData error:", e);
    } finally {
      isRefreshing.current = false;
    }
  }, [route?.type, route?.token]);

  // On PWA resume from the background, refresh the access token, reconnect the
  // realtime socket, and catch up on any data missed while suspended.
  // iOS suspends the PWA and tears down both the WebSocket and the access token
  // silently. The auth refresh picks up a fresh JWT so RPCs go out authed; the
  // realtime reconnect resumes live streaming; the catch-up re-fetch pulls any
  // events lost while suspended.
  useEffect(() => {
    const AUTH_THROTTLE = 5 * 60 * 1000;
    const onResume = async () => {
      if (document.visibilityState !== 'visible') return;

      // (a) Auth token refresh — throttled to once / 5 min via a ref (see
      // lastAuthRefresh above) so the throttle survives this effect's re-runs.
      // Refreshing the JWT on every rapid foreground/background cycle is wasteful
      // and rate-limit prone.
      const now = Date.now();
      if (now - lastAuthRefresh.current >= AUTH_THROTTLE) {
        lastAuthRefresh.current = now;
        try { await supabase.auth.refreshSession(); } catch (e) { /* expected for anon — silent */ }
      }

      // (b) Force the realtime socket to reconnect. iOS tore it down while the
      // PWA was suspended; nudge it back so ONGOING live updates stream in
      // post-resume without needing another foreground. On a fresh socket
      // supabase-js v2 auto-rejoins the tracked channels.
      try {
        if (!supabase.realtime.isConnected()) supabase.realtime.connect();
      } catch (e) { console.error("realtime reconnect error:", e); }

      // (c) Catch-up re-fetch — NEVER throttled. Broadcast / postgres_changes
      // events that fired while suspended are ephemeral and lost forever, so we
      // always pull fresh state on every foreground.
      refreshTeamData();
    };
    // pageshow (incl. bfcache restore) + focus + visibilitychange can all fire
    // on an iOS PWA resume; refreshTeamData's isRefreshing ref dedupes them.
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, [refreshTeamData]);

  // Part A — returning user recognition on /join
  // Runs when authUser, joinTeam AND the admin list are all available. This is not a
  // join — it's "you already belong, open your squad" — so it owes the same door rule
  // as every other squad-open: an admin lands on /admin/<token>, or the manager who
  // taps the invite link they just posted to the squad chat loses their Admin tab.
  // Waits for myAdminTeams to RESOLVE (null while loading, [] once settled — the same
  // signal the landing paths gate on) because this navigates on its own rather than
  // on a tap: deciding the door mid-load would race straight to the player door.
  useEffect(() => {
    if (route.type !== "join" || !authUser || !joinTeam || myAdminTeams === null) return;
    let cancelled = false;
    setJoinChecking(true);
    (async () => {
      try {
        const myTeams = await getPlayerTeams();
        if (cancelled) return;
        const alreadyMember = myTeams.find(m => m.team_id === joinTeam.id);
        if (alreadyMember) {
          const { href } = squadDestination({
            teamId: alreadyMember.team_id, playerToken: alreadyMember.token,
            adminTeams: myAdminTeams,
          });
          if (href) { window.location.replace(href); return; }
        }
      } catch(e) {}
      if (!cancelled) setJoinChecking(false);
    })();
    return () => { cancelled = true; };
  }, [authUser, joinTeam, myAdminTeams]);

  const loadTeamData = async (tId) => {
    setLoading(true);
    // Stale-realtime-on-switch guard (Phase 0c): an in-app team swap changes
    // teamId but not liveChannelKey, which would leave the team_live broadcast
    // subscribed to the PREVIOUS team. Drop the key so the old broadcast channel
    // is torn down and not recreated for the wrong team; the postgres_changes
    // channels re-key on teamId and keep authed realtime flowing. (The switcher
    // itself navigates full-page, so this only hardens the legacy multi-team
    // landing path.)
    setLiveChannelKey(null);
    try {
      const [players, matches, bibs, sched, setts, cover] = await Promise.all([
        getPlayers(tId), getMatches(tId), getBibHistory(tId),
        getSchedule(tId), getSettings(tId), getCoverPool(tId),
      ]);
      setTeamId(tId);
      setSelectedTeam(tId);
      setSquadRaw(players);
      setMatchHistRaw(matches);
      setBibHistRaw(bibs);
      setScheduleRaw(sched || DEFAULT_SCHEDULE);
      setSettingsRaw(setts || DEFAULT_SETTINGS);
      setCoverPoolRaw(cover || []);
      setLoading(false);
    } catch(e) {
      setError(e.message);
      setLoading(false);
    }
  };

  // PostHog identification. Identifies EVERY persona, not just casual squad
  // players: the previous `!teamId` gate meant operators, guardians and
  // club-admins on /hub (who have no casual teamId) were never identified and,
  // under person_profiles:"identified_only", got no profile at all — the exact
  // users a pilot most needs to see. Now it runs for any signed-in user, and for
  // an anonymous token player.
  //
  // distinct_id is the stable identity: auth.uid for signed-in users (an
  // opaque UUID, safe to send), otherwise a SHA-256 hash of the player token.
  // NEVER the raw player token — it is a bearer credential for /p/TOKEN.
  //
  // Person properties carry the full hat SET (hats[]) so a person can be
  // segmented by what they are (operator / club_admin / guardian / member).
  // The ACTIVE hat is an event property, stamped by the chokepoint's getContext.
  // No free-text is sent (never the squad name).
  //
  // Skipped entirely for a known minor — belt-and-braces alongside the hard
  // opt-out above.
  useEffect(() => {
    if (!window.posthog || isMinor) return;
    const authId = authUser?.id || null;
    const rawToken = myPlayer?.token || null;
    if (!authId && !rawToken) return;
    let cancelled = false;
    (async () => {
      try {
        const distinctId = authId || (await sha256Hex(rawToken));
        if (!distinctId || cancelled) return;
        // One-time identity migration. Anyone identified by the PREVIOUS build
        // still has the RAW player token stored as their distinct_id, and
        // PostHog refuses to re-identify an already-identified person — so
        // without this reset their events would keep shipping the credential
        // forever and this fix would do nothing for existing users. Clearing the
        // stored identity lets the hashed id take effect. The cost is losing
        // continuity of those anonymous profiles, which is the right trade
        // against leaking a bearer token. Self-limiting: once the stored id is
        // the hash, this no longer matches. (No-ops while the inline stub is
        // still in play — get_distinct_id() returns undefined until the real
        // library loads.)
        const stored = window.posthog.get_distinct_id?.();
        if (rawToken && stored && stored === rawToken) {
          window.posthog.reset();
          // reset() clears super properties too — put `app` back.
          window.posthog.register?.({ app: "inorout" });
        }
        const personProps = { is_admin: !!isAdmin };
        if (teamId) personProps.team_id = teamId;
        if (telemetryHats.length) personProps.hats = telemetryHats;
        window.posthog.identify(distinctId, personProps);
        // Team group only when there is a casual team in context.
        if (teamId) window.posthog.group("team", teamId);
      } catch (e) {
        console.error("posthog identify error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId, authUser?.id, myPlayer?.token, isAdmin, isMinor, telemetryHats.join(",")]);

  // Multi-context nav (Phase 1): load the per-team kill-switch on squad routes.
  // Flag fails safe to off.
  useEffect(() => {
    if (!teamId || (route.type !== "player" && route.type !== "admin")) return;
    getTeamFeatureFlags(teamId).then(setFeatureFlags).catch(() => setFeatureFlags(null));
  }, [teamId, route.type]);

  // Remember the current context as the resume point, so a multi-context user
  // reopens where they actually left off (their club / guardian home / squad),
  // not on a dormant squad. Written for every resumable surface; the full path
  // (incl. ?club=<id>) is stored so resume lands on the exact context.
  useEffect(() => {
    const RESUMABLE = new Set(["player", "admin", "sessions", "classes", "book", "profile", "member", "feed"]);
    if (!RESUMABLE.has(route.type)) return;
    writeLastContext(window.location.pathname + window.location.search);
  }, [route.type, route.token]);

  // Realtime subscriptions
  const isFetchingPlayers = useRef(false);
  useEffect(() => {
    if (!teamId) return;
    const playerSub = supabase.channel(`players:${teamId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"players" },
        async () => {
          if (isFetchingPlayers.current) return;
          isFetchingPlayers.current = true;
          try {
            if (route?.type === "player" && route?.token) {
              const state = await getTeamStateByPlayerToken(route.token);
              if (state && state.player) {
                setSquadRaw(buildPlayerSquad(state.player, state.squad));
                const intel = computeDeeperIntel(state.player.id, buildPlayerSquad(state.player, state.squad), state.matches || []);
                setStatsRaw({ ...(state.stats || {}), ...intel });
              }
            } else if (route?.type === "admin" || route?.type === "demoadmin") {
              const adminTok = route.type === "demoadmin" ? "admin_demo" : route.token;
              const state = await getTeamStateByAdminToken(adminTok);
              if (state) setSquadRaw(state.squad);
            } else {
              const p = await getPlayers(teamId);
              setSquadRaw(p);
            }
          } catch (e) {
            console.error("players realtime refresh error:", e);
          } finally {
            isFetchingPlayers.current = false;
          }
        })
      .subscribe();
    const schedSub = supabase.channel(`schedule:${teamId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"schedule", filter:`team_id=eq.${teamId}` },
        async () => {
          try {
            if (route?.type === "player" && route?.token) {
              const state = await getTeamStateByPlayerToken(route.token);
              if (state?.schedule) setScheduleRaw(state.schedule);
            } else if (route?.type === "admin" || route?.type === "demoadmin") {
              const adminTok = route.type === "demoadmin" ? "admin_demo" : route.token;
              const state = await getTeamStateByAdminToken(adminTok);
              if (state?.schedule) setScheduleRaw(state.schedule);
            } else {
              const s = await getSchedule(teamId);
              if (s) setScheduleRaw(s);
            }
          } catch (e) {
            console.error("schedule realtime refresh error:", e);
          }
        })
      .subscribe();
    const matchSub = supabase.channel(`matches:${teamId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"matches", filter:`team_id=eq.${teamId}` },
        async () => {
          try {
            if (route?.type === "player" && route?.token) {
              const state = await getTeamStateByPlayerToken(route.token);
              if (state?.matches) setMatchHistRaw(state.matches);
            } else if (route?.type === "admin" || route?.type === "demoadmin") {
              const adminTok = route.type === "demoadmin" ? "admin_demo" : route.token;
              const state = await getTeamStateByAdminToken(adminTok);
              if (state?.matches) setMatchHistRaw(state.matches);
            } else {
              const m = await getMatches(teamId);
              setMatchHistRaw(m);
            }
          } catch (e) {
            console.error("matches realtime refresh error:", e);
          }
        })
      .subscribe();
    return () => {
      isFetchingPlayers.current = false;
      supabase.removeChannel(playerSub);
      supabase.removeChannel(schedSub);
      supabase.removeChannel(matchSub);
    };
  }, [teamId]);

  // Broadcast-channel realtime — works for anon AND authed clients alike.
  // The server (notify_team_change RPC) publishes to `team_live:<key>` on
  // every mutating action. The postgres_changes subscribers above are
  // RLS-gated and silently drop events for anon callers; this broadcast
  // pipe is not. Both pipes run in parallel — the refresh handler is
  // idempotent, so a double-fire is harmless.
  useEffect(() => {
    if (!teamId || !liveChannelKey) return;
    const channel = supabase.channel(`team_live:${liveChannelKey}`);
    // notify_team_change publishes with event name 'broadcast' via
    // realtime.send(payload, 'broadcast', topic). Match exactly — wildcard
    // event filters are NOT supported for broadcast type in the JS client.
    channel.on('broadcast', { event: 'broadcast' }, () => { refreshTeamData(); });
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [teamId, liveChannelKey, refreshTeamData]);

  // ── Setters ──────────────────────────────────────────────────────────────────
  const setSquad = (updater) => {
    const next = typeof updater==="function" ? updater(squad) : updater;
    setSquadRaw(next);
  };
  const setBibHistory = (updater) => {
    const next = typeof updater==="function" ? updater(bibHistory) : updater;
    setBibHistRaw(next);
  };
  const setSchedule = (updater) => {
    const next = typeof updater==="function" ? updater(schedule) : updater;
    setScheduleRaw(next);
  };
  const setMatchHistory = (updater) => {
    const next = typeof updater==="function" ? updater(matchHistory) : updater;
    setMatchHistRaw(next);
  };
  const setSettings = (updater) => {
    const next = typeof updater==="function" ? updater(settings) : updater;
    setSettingsRaw(next);
  };

  // Reset admin sub-screen when leaving admin view
  useEffect(() => {
    if (view !== "admin") setAdminScreen("main");
  }, [view]);

  // ── Join handler — auth first, name only after signed in ─────────────────
  // handleJoin is the public entry. It gates on auth via useRequireAuth —
  // if no session, opens the email-OTP modal and re-runs the internal
  // join after verification. The hook checks the live Supabase session
  // (not React state) to avoid staleness loops.
  const handleJoin = (name) => {
    joinAuthGate.requireAuth(() => doJoin(name), {
      reason: `Sign in to join ${joinTeam?.name || "this team"}. You'll only need to do this once.`,
    });
  };

  const doJoin = async (name) => {
    setJoinLoading(true); setJoinError(null);
    try {
      const player = await playerJoinTeam(joinTeam.id, name);
      // If arrived via a QR invite (/q/<code> → /join/<id>?invite=<code>), count
      // the use now that the join succeeded. Never let a redeem failure block the
      // join — it's already done; the audit trace is best-effort.
      const inviteCode = new URLSearchParams(window.location.search).get("invite");
      if (inviteCode) {
        try { await redeemInviteLink(inviteCode); }
        catch (e) { console.error("[invite] post-join redeem failed", e); }
      }
      // CRITICAL — iOS PWA install requires URL = /p/<token> at HTML parse
      // time so the inline manifest script in index.html injects
      // /api/manifest?player=<token>. Cannot install from /join/<code>
      // because the inline script has no player token to bake. Same
      // pattern as create_team → /admin/<token>?just_created=1. Stash the
      // JoinSuccess props in sessionStorage and hard-redirect.
      try {
        sessionStorage.setItem('ioo_just_joined', JSON.stringify({
          player,
          team: joinTeam,
          ts: Date.now(),
        }));
      } catch (e) {}
      window.location.replace(`/p/${player.token}?just_joined=1`);
    } catch(e) {
      setJoinError(e.message || "Something went wrong.");
    } finally {
      setJoinLoading(false);
    }
  };

  // ── Viewer helpers (used by AdminView gate + PlayerView) ───────────────────
  const _me          = myPlayer ? squad.find(p => p.id === myPlayer.id) : null;
  const isViceCaptain = _me?.isViceCaptain === true;

  // ── Special routes ────────────────────────────────────────────────────────
  if (route.type === "redirecting")  return null;
  if (route.type === "auth_callback") return <AuthCallback/>;
  if (route.type === "legal") return <Legal/>;
  if (route.type === "faq") return <FAQScreen/>;
  if (route.type === "qr") return <InviteResolve code={route.code} />;
  if (route.type === "member") return <MemberPass token={route.token} />;

  // Hold every other route until the initial auth check has resolved.
  // Prevents the brief paint where authUser is still null before
  // getSession() returns and downstream views (JoinTeam, /create gate,
  // PlayerView) mis-decide on a transient null.
  if (!authReady) return <LoadingScreen />;

  // Render the post-create SquadReady overlay BEFORE any other route
  // handling. Only fires once per session (sessionStorage was consumed in
  // the useState initializer above). Tapping "Go to my team" inside
  // SquadReady navigates via window.location.href to /admin/<token>
  // (without the ?just_created=1 param), which reloads this whole tree
  // and drops back into the normal admin flow.
  if (justCreatedData && route.type === "admin" && route.token) {
    return (
      <SquadReady
        groupName={justCreatedData.groupName || ""}
        joinCode={justCreatedData.joinCode}
        adminToken={route.token}
        adminPlayerToken={justCreatedData.adminPlayerToken}
      />
    );
  }

  if (justJoinedData && route.type === "player" && route.token) {
    return (
      <JoinSuccess
        player={justJoinedData.player}
        team={justJoinedData.team}
      />
    );
  }

  if (route.type === "pwa_welcome")  return <PWAWelcome/>;

  if (route.type === "profile") {
    if (loading) return (
      <LoadingScreen />
    );
    if (!authUser) return <SignIn returnTo="/profile" />;
    return <MemberProfile authUser={authUser} hasFeed={homeScreenType === "multi"} />;
  }

  if (route.type === "sessions") {
    if (!authReady) return (
      <LoadingScreen />
    );
    if (!authUser) return <SignIn returnTo="/sessions" />;
    // Squad-resume trap guard: a squad-only user (no clubs/guardian) must never
    // be stranded on the club Sessions screen — e.g. resumed here via a stale
    // lastContext. Once relationships are known, bounce to "/" so the landing
    // router sends them to their real home (squad chooser / player view).
    if (relationships && homeScreenType === "squad_only") { window.location.replace("/"); return null; }
    return <SessionsScreen authUser={authUser} memberProfile={memberProfile} hasFeed={homeScreenType === "multi"} />;
  }

  if (route.type === "classes") {
    if (!authReady) return (
      <LoadingScreen />
    );
    if (!authUser) return <SignIn returnTo="/classes" />;
    return <ClassesScreen authUser={authUser} memberProfile={memberProfile} />;
  }

  if (route.type === "book") {
    if (!authReady) return (
      <LoadingScreen />
    );
    if (!authUser) return <SignIn returnTo="/book" />;
    return <BookPT authUser={authUser} memberProfile={memberProfile} />;
  }

  if (route.type === "create") {
    if (loading) return (
      <LoadingScreen />
    );
    if (!authUser) return <SignIn returnTo="/create" />;
    return <Onboarding authUser={authUser} />;
  }

  // Sign-in entry for returning users. After auth, returnTo="/" hands off to the
  // landing routing oracle below, which sends them to their squad/chooser/home.
  if (route.type === "signin") {
    if (loading) return (
      <LoadingScreen />
    );
    if (!authUser) return <SignIn returnTo="/" />;
    window.location.replace("/");
    return null;
  }

  if (route.type === "join") {
    if (loading) return (
      <LoadingScreen />
    );
    if (!joinTeam) return (
      <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
        flexDirection:"column", alignItems:"center", justifyContent:"center",
        padding:24, fontFamily:"'DM Sans', sans-serif" }}>
        <div style={{ fontSize:40, marginBottom:16 }}>🔗</div>
        <div style={{ fontSize:14, color:C.muted, textAlign:"center" }}>
          This invite link is invalid or has expired.
        </div>
      </div>
    );
    if (joinedPlayer) return (
      <JoinSuccess
        player={joinedPlayer}
        team={joinTeam}
      />
    );
    return (
      <JoinTeam
        team={joinTeam}
        authUser={authUser}
        onNameSubmit={handleJoin}
        loading={joinLoading}
        error={joinError}
        prefillName={joinPrefillName}
        checking={joinChecking}
      />
    );
  }

  if (route.type === "parent-home") {
    // Legacy guardian shell retired (shell-unify PR #6). /parent-home is kept ONLY as a
    // thin redirect into the normal landing router ("/"), which routes a guardian to
    // their /hub guardian track and a (now-childless) squad-only user to their real
    // home — reusing the one landing oracle's guards AND its get_my_world-error /feed
    // fallback rather than duplicating them here (a direct /parent-home redirect fired
    // before `relationships` loaded, defeating the squad-only guard and risking a /hub
    // spinner on a world-load error). Any stale breadcrumb/bookmark lands on the right
    // home, never a dead route. The ParentHomeScreen view is now deleted (PR #6b); the
    // intentional guardian child-tap still deep-links straight to
    // /hub/matches?ctx=family&hat=guardian&child=<id> (ContextSwitcher).
    window.location.replace("/"); return null;
  }

  if (route.type === "feed") {
    if (!authUser) return <SignIn returnTo="/feed" />;
    // Squad-resume trap guard (see /sessions) — the feed is the multi-context
    // hub; a squad-only user resumed here gets bounced to their real home.
    if (relationships && homeScreenType === "squad_only") { window.location.replace("/"); return null; }
    // Legacy-feed retirement: anyone with a /hub hat is forwarded to the /hub
    // role home — even if a stored breadcrumb resumed them straight onto /feed.
    // Wait for hats to resolve first (never flash the old feed; never hang if
    // get_my_world errored). No hat → the legacy feed still serves them.
    if (!myWorldReady) return <LoadingScreen />;
    if (hubEligible) { window.location.replace("/hub"); return null; }
    return <UnifiedFeedScreen authUser={authUser} />;
  }

  // Multi-role mobile app (guardian + operator + team-manager). Scoped under
  // /hub — its own [data-surface="mobile"] amber theme tree; never touches the
  // casual / Member views or any laptop page. Role comes from get_my_world()
  // (myWorld); no role switcher.
  if (route.type === "hub") {
    if (!authReady || (authUser && myWorld === null)) return (
      <LoadingScreen />
    );
    if (!authUser) return <SignIn returnTo="/hub" />;
    return <MobileShell world={myWorld} authUser={authUser} route={route}
      onSignOut={async () => {
        try { await supabase.auth.signOut(); } catch (e) { console.error("sign out failed", e); }
        // Shared-device safety: see the note in packages/core signOut(). This path
        // does NOT navigate — the app re-renders <SignIn> in place — so `app` must
        // be re-registered here too; the SIGNED_OUT listener also covers it, but
        // that fires asynchronously and must not be raced.
        try {
          window.posthog?.reset?.();
          window.posthog?.register?.({ app: "inorout" });
        } catch (e) { console.error("posthog reset failed", e); }
      }} />;
  }

  if (route.type === "follow-live") {
    if (!authUser) return <SignIn returnTo={`/follow-live/${route.profileId}`} />;
    return <FollowLiveView profileId={route.profileId} />;
  }

  if (route.type === "tournament") {
    return <TournamentScreen slug={route.slug} signedIn={!!authUser} />;
  }

  if (route.type === "matchday") {
    return <MatchdayScreen code={route.code} signedIn={!!authUser} />;
  }

  if (route.type === "embed_league") {
    return <EmbedLeagueScreen code={route.code} />;
  }

  if (route.type === "club_trial") {
    return <ClubTrialScreen slug={route.slug} />;
  }

  if (route.type === "club_public") {
    return <ClubPublicScreen slug={route.slug} />;
  }

  if (route.type === "tournament_join") {
    if (!authUser) return <SignIn returnTo={`/tournament/join/${route.code}`} />;
    return <TournamentJoinScreen code={route.code} />;
  }

  // In-flight guard: a signed-in user at "/" whose relationships or admin-teams
  // are still loading must see a SPINNER, not the logged-out-looking marketing
  // splash below (which would otherwise paint for the frame(s) before the RPCs
  // resolve — a brief "you're signed out" flash, and the visual half of the
  // 2.1(a) rejection). Scoped to landing so token/admin routes are unaffected.
  if (route.type === "landing" && authReady && authUser
      && (relationships === null || myAdminTeams === null)) {
    return <LoadingScreen label="Loading..." />;
  }

  // Authenticated user at "/" — route to the correct home based on relationships.
  // Only fires once relationships have loaded (null guard prevents a flash-redirect
  // on the frame before the RPC resolves). Squad-only with exactly one squad →
  // straight into that squad's player view; with 2+ squads → fall through to the
  // "Your squads" chooser rendered below; with 0 squads (brand-new) → welcome page.
  if (route.type === "landing" && authReady && authUser && relationships && myAdminTeams !== null) {
    if (homeScreenType === "multi" || homeScreenType === "parent") {
      // /hub role home supersedes BOTH the legacy /feed hub AND the retired
      // /parent-home guardian shell (shell-unify PR #6): any guardian — with squads
      // ("multi") or without ("parent") — lands on their /hub guardian track. Wait
      // for hats to resolve; fall back to /feed only if none do (or get_my_world
      // errored). hubResumeTarget() only ever returns a /hub path, so a stale
      // /parent-home breadcrumb can never win here.
      if (!myWorldReady) return <LoadingScreen />;
      window.location.replace(hubEligible ? hubResumeTarget() : "/feed"); return null;
    }
    if (homeScreenType === "club_member") { window.location.replace("/sessions");    return null; }
    if (homeScreenType === "squad_only") {
      // Unified login (Step 2): a squad-only person's destinations = squads they
      // play in + any team they admin but don't play in. Exactly one destination →
      // straight in: the admin view if they're an admin of it (player view lives as
      // a tab inside), otherwise the player view. Old token links unchanged.
      const sq = relationships.squads || [];
      const adminOnly = myAdminTeams.filter(a => !sq.some(s => s.team_id === a.teamId));
      if (sq.length + adminOnly.length === 1) {
        if (sq.length === 1) {
          const { href } = squadDestination({
            teamId: sq[0].team_id, playerToken: sq[0].player_token, adminTeams: myAdminTeams,
          });
          if (href) { window.location.replace(href); return null; }
        } else if (adminOnly.length === 1) {
          window.location.replace(`/admin/${adminOnly[0].adminToken}`); return null;
        }
      }
      // ZERO casual destinations but ≥1 /hub hat → the /hub role home. Closes the
      // gap left open at the venue_claim_memberships bind above: claiming the hat
      // is necessary but not sufficient. superadmin_create_club writes a venue +
      // venue_admins + club, and NO member_profile/squad/team_admins — so a
      // brand-new club owner derives 'squad_only' with 0 squads AND 0 admin teams,
      // and fell through to the "paste your player link" welcome screen below.
      // The switcher carried their club_admin hat; nothing ROUTED to it, so a
      // phone-first owner's very first sign-in looked like a broken, empty app.
      // Deliberately reuses the multi/parent arm's exact mechanics rather than a
      // parallel path: wait for hats, then hubResumeTarget(). NOT hub-eligible →
      // falls through to the welcome screen unchanged, which is also the fail-safe
      // when get_my_world errors (myWorld null → hubEligible false): better a welcome
      // screen with reachable sign-out/delete (App Store 2.1(a)/5.1.1(v)) than /hub's
      // spinner, which waits on myWorld and would hang. The myWorldReady wait is
      // bounded by that effect's 4s valve, so it cannot become an indefinite hang.
      // Honest about the valve: if it fires BEFORE getMyWorld resolves, this arm
      // falls through and paints the welcome screen, then re-fires and redirects when
      // the hats land ~a moment later. Unlike the multi/parent arm (which always
      // navigates once ready) this one stays mounted, so that flash is real — but it
      // ends on the CORRECT screen, which beats today's stable-wrong one.
      if (sq.length + adminOnly.length === 0) {
        if (!myWorldReady) return <LoadingScreen />;
        if (hubEligible) { window.location.replace(hubResumeTarget()); return null; }
      }
    }
  }

  // Squad-only user with 2+ destinations → "Your teams" chooser. Destinations =
  // squads they play in + any team they admin but don't play in (unified login,
  // Step 2). Admin teams open the admin view (Manager tag); plain squads open the
  // player view. Reliable list from the relationships oracle + get_my_admin_teams.
  if (route.type === "landing" && authReady && authUser && relationships
      && myAdminTeams !== null && homeScreenType === "squad_only"
      && ((relationships.squads?.length ?? 0)
          + (myAdminTeams.filter(a => !(relationships.squads || []).some(s => s.team_id === a.teamId)).length))
         > 1) {
    const sq = relationships.squads || [];
    const rows = [
      ...sq.map(s => {
        const { href, isAdmin } = squadDestination({
          teamId: s.team_id, playerToken: s.player_token, adminTeams: myAdminTeams,
        });
        return { key: s.team_id, name: s.name, live: s.game_is_live, isAdmin, href };
      }),
      ...myAdminTeams
        .filter(a => !sq.some(s => s.team_id === a.teamId))
        .map(a => ({ key: a.teamId, name: a.teamName, live: false,
                     isAdmin: true, href: `/admin/${a.adminToken}` })),
    ];
    return (
      <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
        display:"flex", flexDirection:"column", alignItems:"center",
        justifyContent:"center", padding:24, fontFamily:"'DM Sans', sans-serif" }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:44,
          color:C.amber, letterSpacing:4, marginBottom:8, textAlign:"center" }}>
          YOUR TEAMS
        </div>
        <div style={{ fontSize:13, color:C.muted, textAlign:"center",
          marginBottom:28 }}>Pick a team to open.</div>
        <div style={{ width:"100%", maxWidth:340 }}>
          {rows.map(r => (
            <a key={r.key} href={r.href}
              style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                width:"100%", padding:"16px 18px", marginBottom:10, borderRadius:10,
                border:`1px solid ${r.live ? C.amber : C.border}`,
                background:C.surface, textDecoration:"none", color:C.text }}>
              <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:20,
                  letterSpacing:1, color: r.live ? C.amber : C.text }}>{r.name}</span>
                {r.isAdmin && (
                  <span style={{ fontFamily:"'DM Sans', sans-serif", fontSize:9, fontWeight:700,
                    letterSpacing:1, color:C.muted, border:`1px solid ${C.border}`,
                    borderRadius:4, padding:"2px 5px" }}>MANAGER</span>
                )}
              </span>
              <span style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11, fontWeight:700,
                letterSpacing:1, color: r.live ? C.amber : C.muted }}>
                {r.live ? "● LIVE" : "OPEN →"}</span>
            </a>
          ))}
        </div>
        <a href="/create" style={{ marginTop:18, fontFamily:"'DM Sans', sans-serif",
          fontSize:13, color:C.muted, textDecoration:"underline",
          textDecorationStyle:"dotted" }}>Create / Join another team</a>
      </div>
    );
  }

  // Signed-in user with ZERO teams/clubs/children (Option A onboarding). This one
  // branch subsumes both the old relay-only dead-end AND the normal-email
  // fall-through to the logged-out-looking marketing splash: every 0-team signed-in
  // user lands here now. It gives a real home — Create / Join — plus REACHABLE Sign
  // out and Delete-account (via /profile, which renders both for a no-team user) so
  // a fresh Hide-My-Email reviewer is never stranded (App Store 2.1(a) hang/logout
  // + 5.1.1(v) deletion-reachability, s199). `isRelay` only downgrades the
  // Hide-My-Email caution to a secondary hint instead of being the whole screen.
  if (route.type === "landing" && authReady && authUser && relationships && myAdminTeams !== null
      && homeScreenType === "squad_only"
      && (relationships.squads?.length ?? 0) === 0
      && myAdminTeams.length === 0) {
    const isRelay = (authUser.email || "").toLowerCase().endsWith("@privaterelay.appleid.com");
    const who = authUser.email || authUser.user_metadata?.name || "your account";
    const signOut = async () => {
      try { await supabase.auth.signOut(); } catch (e) { console.error("sign out failed", e); }
      // Shared-device safety: see the note in packages/core signOut(). Must run
      // BEFORE the redirect — a full page replace would abandon it.
      try { window.posthog?.reset?.(); } catch (e) { console.error("posthog reset failed", e); }
      window.location.replace("/signin");
    };
    const onbLinkValid = /\/p\/[a-zA-Z0-9_-]+/.test(linkInput);
    const onbGoToLink = () => {
      const m = linkInput.match(/\/p\/([a-zA-Z0-9_-]+)/);
      if (m) window.location.href = `/p/${m[1]}`;
    };
    return (
      <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
        display:"flex", flexDirection:"column", alignItems:"center",
        justifyContent:"center", padding:24, fontFamily:"'DM Sans',sans-serif" }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:44,
          letterSpacing:3, marginBottom:6, textAlign:"center", lineHeight:0.9 }}>
          <span style={{ color:C.green }}>IN</span>
          <span style={{ color:C.text }}> OR </span>
          <span style={{ color:C.red }}>OUT</span>
        </div>
        <div style={{ fontSize:13, color:C.muted, textAlign:"center", marginBottom:22 }}>
          You're signed in as <span style={{ color:C.text }}>{who}</span>.
        </div>
        <div style={{ fontSize:15, color:C.text, textAlign:"center",
          marginBottom:24, lineHeight:1.5, maxWidth:300 }}>
          You're not in a team yet. Create one, or join an existing team to get going.
        </div>
        <a href="/create" style={{ display:"block", width:"100%", maxWidth:320, textDecoration:"none" }}>
          <button style={{ width:"100%", padding:"16px 0", borderRadius:8,
            border:"none", background:C.amber, color:C.black,
            fontFamily:"'DM Sans',sans-serif", fontSize:16, fontWeight:700,
            cursor:"pointer", letterSpacing:0.3, display:"flex",
            alignItems:"center", justifyContent:"center", gap:8 }}>
            Create or join a team
            <ArrowRight size={18} weight="thin" />
          </button>
        </a>
        <div style={{ marginTop:18, textAlign:"center" }}>
          {!showLinkInput ? (
            <button onClick={() => setShowLinkInput(true)} style={{
              background:"none", border:"none", padding:0, cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif", fontSize:13, color:C.muted,
              display:"inline-flex", alignItems:"center", gap:6,
              textDecoration:"underline", textDecorationStyle:"dotted" }}>
              <LinkSimple size={15} weight="thin" />
              Have a player link?
            </button>
          ) : (
            <div style={{ maxWidth:320, margin:"0 auto" }}>
              <input autoFocus value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") onbGoToLink(); }}
                placeholder="Paste your link here"
                style={{ width:"100%", padding:"12px 14px", borderRadius:6,
                  border:`1.5px solid ${linkInput ? C.amber : C.border}`,
                  background:C.bg, color:C.text, fontFamily:"'DM Sans',sans-serif",
                  fontSize:14, outline:"none", boxSizing:"border-box", marginBottom:8 }} />
              <button onClick={onbGoToLink}
                style={{ width:"100%", padding:"12px 0", borderRadius:6, border:"none",
                  background: onbLinkValid ? C.amber : C.border,
                  color: onbLinkValid ? C.black : C.muted,
                  fontFamily:"'DM Sans',sans-serif", fontSize:14, fontWeight:700,
                  cursor: onbLinkValid ? "pointer" : "not-allowed",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                Go <ArrowRight size={16} weight="thin" />
              </button>
            </div>
          )}
        </div>
        {isRelay && (
          <div style={{ marginTop:24, fontSize:12, color:C.faint, textAlign:"center",
            lineHeight:1.5, maxWidth:300 }}>
            You used Apple's <b>Hide My Email</b>, which creates a separate account. If
            you already have a team under another login, sign out and sign back in the
            way you used before.
          </div>
        )}
        <div style={{ marginTop:28, display:"flex", gap:18, alignItems:"center" }}>
          <button onClick={signOut} style={{ background:"none", border:"none",
            padding:0, cursor:"pointer", fontFamily:"'DM Sans',sans-serif",
            fontSize:13, color:C.muted, textDecoration:"underline",
            textDecorationStyle:"dotted" }}>
            Sign out
          </button>
          <a href="/profile" style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13,
            color:C.muted, textDecoration:"underline", textDecorationStyle:"dotted" }}>
            Manage account
          </a>
        </div>
        {/* Terms/Privacy reachable in-app (5.1.1): this onboarding screen is exactly
            where a fresh Sign-in-with-Apple account lands, so the legal links must be
            here, not only on the logged-out marketing splash. */}
        <div style={{ marginTop:24, fontFamily:"'DM Sans',sans-serif", fontSize:11,
          color:C.muted, display:"flex", gap:8, justifyContent:"center" }}>
          <a href="/legal" style={{ color:C.muted, textDecoration:"none",
            display:"inline-flex", alignItems:"center", minHeight:44, padding:"0 8px" }}>Terms</a>
          <a href="/legal#privacy" style={{ color:C.muted, textDecoration:"none",
            display:"inline-flex", alignItems:"center", minHeight:44, padding:"0 8px" }}>Privacy</a>
          <a href="mailto:hello@in-or-out.com" style={{ color:C.muted, textDecoration:"none",
            display:"inline-flex", alignItems:"center", minHeight:44, padding:"0 8px" }}>Contact</a>
        </div>
      </div>
    );
  }

  if (route.type === "landing") {
    const linkValid = /\/p\/[a-zA-Z0-9_-]+/.test(linkInput);
    const goToLink = () => {
      const m = linkInput.match(/\/p\/([a-zA-Z0-9_-]+)/);
      if (m) window.location.href = `/p/${m[1]}`;
    };
    return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:24, fontFamily:"'DM Sans',sans-serif" }}>
      {/* Brand lockup — IN green · OR neutral · OUT red (matches PageHeader). */}
      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:60,
        lineHeight:0.9, letterSpacing:4, marginBottom:14, textAlign:"center" }}>
        <span style={{ color:C.green }}>IN</span>
        <span style={{ color:C.text }}> OR </span>
        <span style={{ color:C.red }}>OUT</span>
      </div>
      <div style={{ fontSize:14, color:C.muted, textAlign:"center",
        marginBottom:40, lineHeight:1.6, maxWidth:300 }}>
        The easiest way to organise your weekly football game.<br/>
        One link per player — they just tap In or Out.
      </div>
      <a href="/create" style={{ display:"block", width:"100%", maxWidth:320, textDecoration:"none" }}>
        <button style={{ width:"100%", padding:"16px 0", borderRadius:8,
          border:"none", background:C.amber, color:C.black,
          fontFamily:"'DM Sans',sans-serif", fontSize:16, fontWeight:700,
          cursor:"pointer", letterSpacing:0.3, display:"flex",
          alignItems:"center", justifyContent:"center", gap:8 }}>
          Create / Join Team
          <ArrowRight size={18} weight="thin" />
        </button>
      </a>
      <a href="/signin" style={{ marginTop:16, fontFamily:"'DM Sans',sans-serif",
        fontSize:14, color:C.amber, textDecoration:"none", fontWeight:600,
        textAlign:"center" }}>
        Already have a team? Sign in
      </a>
      <div style={{ marginTop:20, textAlign:"center" }}>
        {!showLinkInput ? (
          <button onClick={() => setShowLinkInput(true)} style={{
            background:"none", border:"none", padding:0, cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif", fontSize:13,
            color:C.muted, display:"inline-flex", alignItems:"center", gap:6,
            textDecoration:"underline", textDecorationStyle:"dotted",
          }}>
            <LinkSimple size={15} weight="thin" />
            Already have a player link?
          </button>
        ) : (
          <div style={{ maxWidth:320, margin:"0 auto" }}>
            <input
              autoFocus
              value={linkInput}
              onChange={e => setLinkInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") goToLink(); }}
              placeholder="Paste your link here"
              style={{ width:"100%", padding:"12px 14px", borderRadius:6,
                border:`1.5px solid ${linkInput ? C.amber : C.border}`,
                background:C.bg, color:C.text,
                fontFamily:"'DM Sans',sans-serif", fontSize:14,
                outline:"none", boxSizing:"border-box", marginBottom:8 }}
            />
            <button
              onClick={goToLink}
              style={{ width:"100%", padding:"12px 0", borderRadius:6,
                border:"none",
                background: linkValid ? C.amber : C.border,
                color: linkValid ? C.black : C.muted,
                fontFamily:"'DM Sans',sans-serif", fontSize:14, fontWeight:700,
                cursor: linkValid ? "pointer" : "not-allowed",
                display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              Go
              <ArrowRight size={16} weight="thin" />
            </button>
          </div>
        )}
      </div>
      <div style={{ marginTop:40, fontFamily:"'DM Sans',sans-serif", fontSize:11,
        color:C.faint, textAlign:"center", display:"flex", gap:16,
        justifyContent:"center" }}>
        <a href="/legal" style={{ color:C.faint, textDecoration:"none" }}>Terms</a>
        <a href="/legal#privacy" style={{ color:C.faint, textDecoration:"none" }}>Privacy</a>
        <a href="mailto:hello@in-or-out.com" style={{ color:C.faint, textDecoration:"none" }}>Contact</a>
      </div>
    </div>
    );
  }

  if (loading) return <LoadingScreen label="Loading..." />;

  if (error) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:16, padding:20 }}>
      <div style={{ fontSize:40 }}>⚠️</div>
      <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14,
        color:C.red, textAlign:"center" }}>
        {error}<br/>
        <span style={{ color:C.muted, fontSize:12 }}>Check your link and try again.</span>
      </div>
    </div>
  );

  if (route.type==="player" && !myPlayer) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      padding:24, fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>🔗</div>
      <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14,
        color:C.muted, textAlign:"center" }}>
        This link doesn't match any player.<br/>
        Check the link your organiser sent you.
      </div>
    </div>
  );

  // Multi-team / club-membership switcher
  const clubEntries = memberProfile?.active_clubs ?? [];
  if (route.type==="player" && myPlayer && (playerTeams.length > 1 || clubEntries.length > 0) && !selectedTeam) {
    // Multi-context nav ON: retire this legacy block — send a person with a /hub
    // hat to the /hub role home; a pure multi-team casual player (no hub hat)
    // keeps the /feed hub. OFF: unchanged. Wait for hats before deciding.
    if (featureFlags?.multi_context_nav) {
      if (!myWorldReady) return <LoadingScreen />;
      window.location.replace(hubEligible ? hubResumeTarget() : "/feed"); return null;
    }
    return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ padding:"20px 18px 12px", background:C.bg,
        borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28, letterSpacing:3 }}>
          <span style={{ color:C.green }}>IN</span>
          <span style={{ color:C.text }}> OR </span>
          <span style={{ color:C.red }}>OUT</span>
        </div>
        <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13,
          color:C.muted, marginTop:2 }}>Welcome back, {myPlayer.name}</div>
      </div>
      <div style={{ padding:18 }}>
        {playerTeams.length > 0 && (
          <>
            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11, fontWeight:800,
              color:C.muted, letterSpacing:1.5, textTransform:"uppercase", marginBottom:16 }}>
              YOUR GAMES
            </div>
            {playerTeams.map(team => (
              <div key={team.id} onClick={() => loadTeamData(team.id)}
                style={{ background:C.surface, border:`1px solid ${C.border}`,
                  borderRadius:12, padding:20, marginBottom:14, cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor=C.amber}
                onMouseLeave={e => e.currentTarget.style.borderColor=C.border}>
                <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
                  color:C.amber, letterSpacing:2 }}>{team.name}</div>
                <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12,
                  color:C.amber, marginTop:12, fontWeight:600, textAlign:"right" }}>
                  Open →
                </div>
              </div>
            ))}
          </>
        )}
        {clubEntries.length > 0 && (
          <>
            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11, fontWeight:800,
              color:C.muted, letterSpacing:1.5, textTransform:"uppercase",
              marginBottom:16, marginTop: playerTeams.length > 0 ? 8 : 0 }}>
              YOUR CLUBS
            </div>
            {clubEntries.map(club => (
              <div key={`${club.club_id}:${club.cohort_id}`}
                onClick={() => window.location.href = `/sessions?club=${club.club_id}`}
                style={{ background:C.surface, border:`1px solid ${C.border}`,
                  borderRadius:12, padding:20, marginBottom:14, cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor=C.amber}
                onMouseLeave={e => e.currentTarget.style.borderColor=C.border}>
                <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
                  color:C.amber, letterSpacing:2 }}>{club.club_name}</div>
                {club.cohort_name && (
                  <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13,
                    color:C.muted, marginTop:4 }}>{club.cohort_name}</div>
                )}
                <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12,
                  color:C.amber, marginTop:12, fontWeight:600, textAlign:"right" }}>
                  Sessions →
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
    );
  }

  const myId        = myPlayer?.id || (isAdmin ? squad[0]?.id : null);
  const sharedProps = { squad, setSquad, schedule, setSchedule, settings, setSettings };

  // Multi-context nav (Phase 1) — derived descriptor + per-team kill-switch.
  // Passed to PlayerView/AdminView for surface gating; both ship dark until the
  // team's multi_context_nav flag is on.
  const multiContextNav = !!featureFlags?.multi_context_nav;
  const squadContext    = squadCtxInputs
    ? deriveSquadContext({ ...squadCtxInputs, matchCount: matchHistory?.length || 0 })
    : null;

  // Open the unified switcher (header avatar). Best-effort fetch of the person's
  // squads. Each row opens via squadDestination, so an admin lands on the /admin
  // door and keeps the Admin tab — routing straight to /p/<token> silently
  // stripped it, because a /p/ route never derives isAdmin from team_admins.
  // Plain function (NOT useCallback) — this lives after the component's early
  // returns, so it must not be a hook (Rules of Hooks).
  const openSwitcher = () => {
    setShowSwitcher(true);
    getPlayerTeams()
      .then(rows => setSwitcherSquads((rows || []).filter(r => !r.disabled)
        .map(r => ({
          id: r.team_id, name: r.team_name, token: r.token,
          isAdmin: r.is_team_admin,
          type: r.is_competitive ? "league" : "casual",
        }))))
      .catch(() => { /* anon / not linked — switcher still shows clubs + feed */ });
    // Refresh the unified world each open so referee assignments + conflicts
    // (time-sensitive) are current. Best-effort; the auth-load value stands in.
    getMyWorld().then(w => setMyWorld(w?.ok ? w : null)).catch(() => {});
  };

  return (
    <TourProvider enabled={multiContextNav}>
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"'DM Sans', sans-serif" }}>
      <ContextSwitcher
        open={showSwitcher}
        onClose={() => setShowSwitcher(false)}
        currentName={myPlayer?.name || null}
        world={myWorld}
        squads={switcherSquads}
        conflicts={myWorld?.conflicts ?? []}
        currentTeamId={teamId}
        onSelectSquad={(s) => {
          const { href } = squadDestination({
            teamId: s?.id, playerToken: s?.token, adminTeams: myAdminTeams,
          });
          if (href) window.location.href = href;
        }}
      />
      {view==="player"  && (
        <PlayerView  {...sharedProps} myId={myId} teamId={teamId} adminToken={isAdmin ? (route.token || "admin_demo") : null}
          authUserId={authUser?.id || null}
          onMidFlowChange={setIsActionBlocked}
          isAdmin={isAdmin || isViceCaptain} onGoAdmin={() => setView("admin")}
          matchHistory={matchHistory} bibHistory={bibHistory}
          startTab={playerStartTabRef.current}
          context={squadContext} multiContextNav={multiContextNav}
          onSwitcherOpen={openSwitcher}
          stats={statsRaw}/>
      )}
      {view==="stats" && <StatsView
        teamId={teamId}
        squad={squad}
        bibHistory={bibHistory}
        matchHistory={matchHistory}
        settings={settings}
        schedule={schedule}
        myId={myId}
        stats={statsRaw}
        adminToken={isAdmin ? (route.token || "admin_demo") : null}
        playerToken={route.type === "player" ? route.token : null}/>}
      {view==="history" && <HistoryView matchHistory={matchHistory} players={squad} settings={settings} schedule={schedule}/>}
      {view==="admin"   && (isAdmin || isViceCaptain) && (
        <AdminView
          {...sharedProps}
          bibHistory={bibHistory}     setBibHistory={setBibHistory}
          matchHistory={matchHistory} setMatchHistory={setMatchHistory}
          coverPool={coverPool}       setCoverPool={setCoverPoolRaw}
          teamId={teamId}
          liveChannelKey={liveChannelKey}
          me={_me}
          context={squadContext} multiContextNav={multiContextNav}
          onSwitcherOpen={openSwitcher}
          adminToken={(isAdmin || isViceCaptain) ? (route.token || "admin_demo") : null}
          gafferEnabled={ENABLE_GAFFER}
          isViceCaptain={isViceCaptain}
          screen={adminScreen}        setScreen={setAdminScreen}
          onGoPlayer={() => { playerStartTabRef.current = null; setView("player"); }}
          onGoStats={() => { playerStartTabRef.current = "stats"; setView("player"); }}
          onGoHistory={() => { playerStartTabRef.current = "history"; setView("player"); }}
          onGoMyIO={() => { playerStartTabRef.current = "my-io"; setView("player"); }}
          isDemoMode={route.type === "demoadmin"}
          onResetDemo={async () => {
            await resetDemoData();
            const state = await getTeamStateByAdminToken("admin_demo");
            if (!state) return;
            setTeamId(state.teamId);         setSelectedTeam(state.teamId);
            setSquadRaw(state.squad);        setMatchHistRaw(state.matches);
            setBibHistRaw(state.bibHistory); setScheduleRaw(state.schedule || DEFAULT_SCHEDULE);
            setSettingsRaw(state.settings || DEFAULT_SETTINGS);
            setCoverPoolRaw(state.coverPool);
          }}
        />
      )}
      {ENABLE_GAFFER && isAdmin && (
        <GafferLauncher
          adminToken={route.token}
          teamName={settings?.groupName}
          teamId={teamId}
          squad={squad}
          schedule={schedule}
          onNavigate={(screen) => { setView("admin"); setAdminScreen(screen); }}
        />
      )}
      {showEmailCapture && (
        <EmailCaptureOverlay conflictMessage={linkConflict}/>
      )}
      <AuthGateModal {...joinAuthGate.gateProps} />
      <AnalyticsConsentModal
        open={showAnalyticsConsent}
        onAllow={() => { setAnalyticsConsent(true); setShowAnalyticsConsent(false); }}
        onDecline={() => { setAnalyticsConsent(false); setShowAnalyticsConsent(false); }}
      />
    </div>
    </TourProvider>
  );
}
