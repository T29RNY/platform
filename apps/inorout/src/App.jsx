import { useState, useEffect, useRef, useCallback } from "react";
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
} from "@platform/core/storage/supabase.js";
import { SEED_COVER } from "./seeds.js";
import PlayerView    from "./views/PlayerView.jsx";
import StatsView     from "./views/StatsView.jsx";
import HistoryView   from "./views/HistoryView.jsx";
import AdminView     from "./views/AdminView/index.jsx";
import InstallBanner from "./views/InstallBanner.jsx";
import Onboarding    from "./onboarding/index.jsx";
import JoinTeam             from "./views/JoinTeam.jsx";
import InviteResolve        from "./views/InviteResolve.jsx";
import MemberPass           from "./views/MemberPass.jsx";
import MemberProfile        from "./views/MemberProfile.jsx";
import SessionsScreen       from "./views/SessionsScreen.jsx";
import UnifiedFeedScreen   from "./views/UnifiedFeedScreen.jsx";
import ParentHomeScreen    from "./views/ParentHomeScreen.jsx";
import TournamentScreen    from "./views/TournamentScreen.jsx";
import TournamentJoinScreen from "./views/TournamentJoinScreen.jsx";
import FollowLiveView      from "./views/FollowLiveView.jsx";
import EmailCaptureOverlay  from "./views/EmailCaptureOverlay.jsx";
import JoinSuccess   from "./views/JoinSuccess.jsx";
import AuthCallback  from "./views/AuthCallback.jsx";
import SignIn        from "./views/SignIn.jsx";
import AuthGateModal from "./components/AuthGateModal.jsx";
import useRequireAuth from "./hooks/useRequireAuth.js";
import Legal         from "./views/Legal.jsx";
import PWAWelcome   from "./views/PWAWelcome.jsx";
import Gaffer        from "./views/Gaffer/index.jsx";
import SquadReady    from "./onboarding/steps/SquadReady.jsx";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&display=swap";

const DEFAULT_SCHEDULE = {
  dayOfWeek:"Tuesday", kickoff:"19:00", venue:"", opensDay:"Wednesday",
  opensTime:"10:00", priorityLeadMins:60, pricePerPlayer:6,
  gameIsLive:false, squadSize:14, gameDateTime:null,
  isDraft:true, isCancelled:false, cancelReason:"",
};
const DEFAULT_SETTINGS = { groupName:"My Team" };

// ─── Feature flags ────────────────────────────────────────────────────────────
const ENABLE_GAFFER = false;

// ─── Gaffer access control ────────────────────────────────────────────────────
const GAFFER_ALLOWED = new Set([
  'admin_101d9ac950278f76',
  'p_95go8k6cfwo',
]);

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
  if (parts[0]==="parent-home")              return { type:"parent-home" };
  if (parts[0]==="feed")                     return { type:"feed" };
  if (parts[0]==="follow-live" && parts[1])  return { type:"follow-live", profileId:parts[1] };
  if (parts[0]==="tournament" && parts[1]==="join" && parts[2]) return { type:"tournament_join", code:parts[2] };
  if (parts[0]==="tournament"  && parts[1])  return { type:"tournament",  slug:parts[1] };
  if (parts[0]==="auth"          && parts[1]==="callback") return { type:"auth_callback" };
  if (["legal","privacy","terms"].includes(parts[0])) return { type:"legal" };
  if (window.location.hostname==="localhost") return { type:"admin",    token:"local" };

  // Redirect bridge — only at root "/"
  try {
    const stored = localStorage.getItem("ioo_redirect_to");
    if (stored) {
      const { path, ts } = JSON.parse(stored);
      const age = Date.now() - ts;
      if (path && ts && age < 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem("ioo_redirect_to");
        window.location.replace(path);
        return { type:"redirecting" };
      }
      // Expired — remove it but fall through to lastVisited
      localStorage.removeItem("ioo_redirect_to");
    }

    const last = localStorage.getItem("ioo_last_visited");
    if (last) {
      window.location.replace(last);
      return { type:"redirecting" };
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
        // Force a session refresh on every boot. PWAs (especially iOS) lose
        // their access-token between launches even when the refresh token
        // is still valid. Calling refreshSession here gets us a fresh JWT
        // so subsequent RPCs go out authed. If there's no refresh token
        // (anon visitor) or the refresh fails for any reason, we swallow
        // the error and proceed exactly as we would have today.
        try { await supabase.auth.refreshSession(); } catch (e) { /* anon or expired — fall through */ }

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
            setTeamId(state.teamId);           setSelectedTeam(state.teamId);
            setSquadRaw(state.squad);          setMatchHistRaw(state.matches);
            setBibHistRaw(state.bibHistory);   setScheduleRaw(state.schedule || DEFAULT_SCHEDULE);
            setSettingsRaw(state.settings || DEFAULT_SETTINGS);
            setCoverPoolRaw(state.coverPool);
            setLiveChannelKey(state.liveChannelKey || null);
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

          // Show email capture overlay on visit 3+ if still unlinked
          const isDemoToken = route.token?.startsWith('p_demotoken_');
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
        else setAuthUser(null);
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
    getUserRelationships().then(r => setRelationships(r)).catch(() => {});
  }, [authUser]);

  // Full catch-up re-fetch. Single source of truth for the team_live broadcast
  // handler AND the PWA-resume handler. Re-fetches all team state via the
  // existing wrappers and replays it into the raw setters, branching by route
  // exactly like the initial load. Guarded by isRefreshing so the multiple
  // resume events (visibilitychange + pageshow + focus) coalesce into one
  // network round-trip. Declared above the resume effect because that effect's
  // dependency array references it — a later const would be in the TDZ.
  const isRefreshing = useRef(false);
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
    let lastAuthRefresh = 0;
    const AUTH_THROTTLE = 5 * 60 * 1000;
    const onResume = async () => {
      if (document.visibilityState !== 'visible') return;

      // (a) Auth token refresh — throttled to once / 5 min. Refreshing the JWT
      // on every rapid foreground/background cycle is wasteful and rate-limit
      // prone.
      const now = Date.now();
      if (now - lastAuthRefresh >= AUTH_THROTTLE) {
        lastAuthRefresh = now;
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
  // Runs when both authUser and joinTeam are available
  useEffect(() => {
    if (route.type !== "join" || !authUser || !joinTeam) return;
    let cancelled = false;
    setJoinChecking(true);
    (async () => {
      try {
        const myTeams = await getPlayerTeams();
        if (cancelled) return;
        const alreadyMember = myTeams.find(m => m.team_id === joinTeam.id);
        if (alreadyMember) {
          window.location.replace(`/p/${alreadyMember.token}`);
          return;
        }
      } catch(e) {}
      if (!cancelled) setJoinChecking(false);
    })();
    return () => { cancelled = true; };
  }, [authUser, joinTeam]);

  const loadTeamData = async (tId) => {
    setLoading(true);
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

  // PostHog identification — tells the analytics platform "this person is
  // on team X". Drives feature-flag targeting by team and gives every event
  // a team_id property automatically. distinct_id is the stable identity:
  // auth.uid for signed-in users, player token otherwise.
  useEffect(() => {
    if (!window.posthog || !teamId) return;
    const distinctId = authUser?.id || myPlayer?.token || null;
    if (!distinctId) return;
    try {
      window.posthog.identify(distinctId, {
        team_id: teamId,
        is_admin: !!isAdmin,
      });
      window.posthog.group("team", teamId, {
        name: settings?.groupName || null,
      });
    } catch (e) {
      console.error("posthog identify error:", e);
    }
  }, [teamId, authUser?.id, myPlayer?.token, isAdmin, settings?.groupName]);

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

  // ── Gaffer context + navigation ──────────────────────────────────────────
  const _me          = myPlayer ? squad.find(p => p.id === myPlayer.id) : null;
  const isViceCaptain = _me?.isViceCaptain === true;
  const _inPlayers   = squad.filter(p => p.status === "in"      && !p.disabled && !p.injured);
  const _reserves    = sortByReservePriority(squad.filter(p => p.status === "reserve" && !p.disabled));
  const _reservePos  = _me?.status === "reserve"
    ? _reserves.findIndex(p => p.id === _me.id) + 1 || null
    : null;
  const gafferContext = {
    currentScreen:  view === "admin" ? adminScreen : view,
    isAdmin,
    playerName:     _me?.name || myPlayer?.name || null,
    playerStatus:   _me?.status || "none",
    reservePosition: _reservePos,
    isInjured:      _me?.injured || false,
    gameDate:       schedule.gameDateTime?.split("T")[0] || null,
    kickoff:        schedule.kickoff || null,
    venue:          schedule.venue   || null,
    squadSize:      schedule.squadSize   || 14,
    inCount:        _inPlayers.length,
    reserveCount:   _reserves.length,
    price:          schedule.pricePerPlayer || null,
    gameIsLive:     schedule.gameIsLive    || false,
    isMember:       _me ? (_me.attended > 0) : false,
    multipleTeams:  playerTeams.length > 1,
  };

  const handleGafferNavigate = (target) => {
    switch (target) {
      case "stats":        setView("stats"); break;
      case "history":      setView("history"); break;
      case "bibs":         setView("admin"); setAdminScreen("bibs"); break;
      case "score":        setView("admin"); setAdminScreen("score"); break;
      case "squad":        setView("admin"); setAdminScreen("squad"); break;
      case "schedule":     setView("admin"); setAdminScreen("schedule"); break;
      case "payments":     setView("admin"); setAdminScreen("main"); break;
      case "cover-pool":   setView("admin"); setAdminScreen("main"); break;
      case "game-switcher": setSelectedTeam(null); break;
      default: break;
    }
  };

  // ── Special routes ────────────────────────────────────────────────────────
  if (route.type === "redirecting")  return null;
  if (route.type === "auth_callback") return <AuthCallback/>;
  if (route.type === "legal") return <Legal/>;
  if (route.type === "qr") return <InviteResolve code={route.code} />;
  if (route.type === "member") return <MemberPass token={route.token} />;

  // Hold every other route until the initial auth check has resolved.
  // Prevents the brief paint where authUser is still null before
  // getSession() returns and downstream views (JoinTeam, /create gate,
  // PlayerView) mis-decide on a transient null.
  if (!authReady) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      alignItems:"center", justifyContent:"center" }}>
      <div style={{ fontSize:48 }}>⚽</div>
    </div>
  );

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
      <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
        alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:48 }}>⚽</div>
      </div>
    );
    if (!authUser) return <SignIn returnTo="/profile" />;
    return <MemberProfile authUser={authUser} />;
  }

  if (route.type === "sessions") {
    if (!authReady) return (
      <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
        alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:48 }}>⚽</div>
      </div>
    );
    if (!authUser) return <SignIn returnTo="/sessions" />;
    return <SessionsScreen authUser={authUser} memberProfile={memberProfile} />;
  }

  if (route.type === "create") {
    if (loading) return (
      <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
        alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:48 }}>⚽</div>
      </div>
    );
    if (!authUser) return <SignIn returnTo="/create" />;
    return <Onboarding authUser={authUser} />;
  }

  if (route.type === "join") {
    if (loading) return (
      <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
        alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:48 }}>⚽</div>
      </div>
    );
    if (!joinTeam) return (
      <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
        flexDirection:"column", alignItems:"center", justifyContent:"center",
        padding:24, fontFamily:"Inter,sans-serif" }}>
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
    if (!authUser) return <SignIn returnTo="/parent-home" />;
    return <ParentHomeScreen authUser={authUser} />;
  }

  if (route.type === "feed") {
    if (!authUser) return <SignIn returnTo="/feed" />;
    return <UnifiedFeedScreen authUser={authUser} />;
  }

  if (route.type === "follow-live") {
    if (!authUser) return <SignIn returnTo={`/follow-live/${route.profileId}`} />;
    return <FollowLiveView profileId={route.profileId} />;
  }

  if (route.type === "tournament") {
    return <TournamentScreen slug={route.slug} />;
  }

  if (route.type === "tournament_join") {
    if (!authUser) return <SignIn returnTo={`/tournament/join/${route.code}`} />;
    return <TournamentJoinScreen code={route.code} />;
  }

  // Authenticated user at "/" — route to the correct home based on relationships.
  // Only fires once relationships have loaded (null guard prevents a flash-redirect
  // on the frame before the RPC resolves). Squad-only users never hit a branch
  // (homeScreenType==='squad_only' or null) → fall through to the landing page.
  if (route.type === "landing" && authReady && authUser && relationships) {
    if (homeScreenType === "parent")      { window.location.replace("/parent-home"); return null; }
    if (homeScreenType === "multi")       { window.location.replace("/feed");        return null; }
    if (homeScreenType === "club_member") { window.location.replace("/sessions");    return null; }
  }

  if (route.type === "landing") return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:52,
        color:C.amber, letterSpacing:4, marginBottom:8, textAlign:"center" }}>
        IN OR OUT
      </div>
      <div style={{ fontSize:14, color:C.muted, textAlign:"center",
        marginBottom:40, lineHeight:1.6, maxWidth:300 }}>
        The fastest way to organise your weekly football game.<br/>
        No apps. No accounts. Just tap and go.
      </div>
      <a href="/create" style={{ display:"block", width:"100%", maxWidth:320 }}>
        <button style={{ width:"100%", padding:"16px 0", borderRadius:8,
          border:"none", background:C.amber, color:C.black,
          fontFamily:"Inter,sans-serif", fontSize:16, fontWeight:800,
          cursor:"pointer", letterSpacing:0.5 }}>
          Create Your Team →
        </button>
      </a>
      <div style={{ marginTop:20, textAlign:"center" }}>
        {!showLinkInput ? (
          <button onClick={() => setShowLinkInput(true)} style={{
            background:"none", border:"none", padding:0, cursor:"pointer",
            fontFamily:"Inter,sans-serif", fontSize:13,
            color:C.muted, textDecoration:"underline", textDecorationStyle:"dotted",
          }}>
            Already have a player link?
          </button>
        ) : (
          <div style={{ maxWidth:320, margin:"0 auto" }}>
            <input
              autoFocus
              value={linkInput}
              onChange={e => setLinkInput(e.target.value)}
              onKeyDown={e => {
                if (e.key !== "Enter") return;
                const m = linkInput.match(/\/p\/([a-zA-Z0-9_-]+)/);
                if (m) window.location.href = `/p/${m[1]}`;
              }}
              placeholder="Paste your link here"
              style={{ width:"100%", padding:"12px 14px", borderRadius:6,
                border:`1.5px solid ${linkInput ? C.amber : C.border}`,
                background:C.bg, color:C.text,
                fontFamily:"Inter,sans-serif", fontSize:14,
                outline:"none", boxSizing:"border-box", marginBottom:8 }}
            />
            <button
              onClick={() => {
                const m = linkInput.match(/\/p\/([a-zA-Z0-9_-]+)/);
                if (m) window.location.href = `/p/${m[1]}`;
              }}
              style={{ width:"100%", padding:"12px 0", borderRadius:6,
                border:"none",
                background: linkInput.match(/\/p\/[a-zA-Z0-9_-]+/) ? C.amber : C.border,
                color: linkInput.match(/\/p\/[a-zA-Z0-9_-]+/) ? "#000" : C.muted,
                fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:700,
                cursor: linkInput.match(/\/p\/[a-zA-Z0-9_-]+/) ? "pointer" : "not-allowed",
              }}>
              Go →
            </button>
          </div>
        )}
      </div>
      <div style={{ marginTop:40, fontFamily:"Inter,sans-serif", fontSize:11,
        color:C.faint, textAlign:"center", display:"flex", gap:16,
        justifyContent:"center" }}>
        <a href="/legal" style={{ color:C.faint, textDecoration:"none" }}>Terms</a>
        <a href="/legal#privacy" style={{ color:C.faint, textDecoration:"none" }}>Privacy</a>
        <a href="mailto:hello@in-or-out.com" style={{ color:C.faint, textDecoration:"none" }}>Contact</a>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:48 }}>⚽</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, color:C.muted }}>Loading...</div>
    </div>
  );

  if (error) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:16, padding:20 }}>
      <div style={{ fontSize:40 }}>⚠️</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
        color:C.red, textAlign:"center" }}>
        {error}<br/>
        <span style={{ color:C.muted, fontSize:12 }}>Check your link and try again.</span>
      </div>
    </div>
  );

  if (route.type==="player" && !myPlayer) return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>🔗</div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
        color:C.muted, textAlign:"center" }}>
        This link doesn't match any player.<br/>
        Check the link your organiser sent you.
      </div>
    </div>
  );

  // Multi-team / club-membership switcher
  const clubEntries = memberProfile?.active_clubs ?? [];
  if (route.type==="player" && myPlayer && (playerTeams.length > 1 || clubEntries.length > 0) && !selectedTeam) return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <InstallBanner/>
      <div style={{ padding:"20px 18px 12px", background:C.bg,
        borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28,
          color:C.amber, letterSpacing:3 }}>IN OR OUT</div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:2 }}>Welcome back, {myPlayer.name}</div>
      </div>
      <div style={{ padding:18 }}>
        {playerTeams.length > 0 && (
          <>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
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
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:12,
                  color:C.amber, marginTop:12, fontWeight:600, textAlign:"right" }}>
                  Open →
                </div>
              </div>
            ))}
          </>
        )}
        {clubEntries.length > 0 && (
          <>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
              color:C.muted, letterSpacing:1.5, textTransform:"uppercase",
              marginBottom:16, marginTop: playerTeams.length > 0 ? 8 : 0 }}>
              YOUR CLUBS
            </div>
            {clubEntries.map(club => (
              <div key={`${club.club_id}:${club.cohort_id}`}
                onClick={() => window.location.href = "/sessions"}
                style={{ background:C.surface, border:`1px solid ${C.border}`,
                  borderRadius:12, padding:20, marginBottom:14, cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor=C.amber}
                onMouseLeave={e => e.currentTarget.style.borderColor=C.border}>
                <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
                  color:C.amber, letterSpacing:2 }}>{club.club_name}</div>
                {club.cohort_name && (
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
                    color:C.muted, marginTop:4 }}>{club.cohort_name}</div>
                )}
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:12,
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

  const myId        = myPlayer?.id || (isAdmin ? squad[0]?.id : null);
  const sharedProps = { squad, setSquad, schedule, setSchedule, settings, setSettings };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <InstallBanner/>
      {view==="player"  && (
        <PlayerView  {...sharedProps} myId={myId} teamId={teamId} adminToken={isAdmin ? (route.token || "admin_demo") : null}
          onMidFlowChange={setIsActionBlocked}
          isAdmin={isAdmin || isViceCaptain} onGoAdmin={() => setView("admin")}
          matchHistory={matchHistory} bibHistory={bibHistory}
          startTab={playerStartTabRef.current}
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
        adminToken={isAdmin ? (route.token || "admin_demo") : null}/>}
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
          adminToken={(isAdmin || isViceCaptain) ? (route.token || "admin_demo") : null}
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
      {ENABLE_GAFFER && (
        <Gaffer
          context={gafferContext}
          onNavigate={handleGafferNavigate}
          isBlocked={isActionBlocked || adminScreen === "score"}
          enabled={GAFFER_ALLOWED.has(route.token)}
        />
      )}
      {showEmailCapture && (
        <EmailCaptureOverlay conflictMessage={linkConflict}/>
      )}
      <AuthGateModal {...joinAuthGate.gateProps} />
    </div>
  );
}
