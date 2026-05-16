import { useState, useEffect, useRef } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/supabase";
import {
  getPlayers, upsertPlayers,
  getMatches, insertMatch,
  getBibHistory, insertBib,
  getSchedule, upsertSchedule,
  getSettings, upsertSettings,
  getTeamByAdminToken, getTeamByPlayerToken,
  getPlayerByToken, getPlayerTeams,
  getTeamByJoinCode, addPlayerToTeam,
  getCoverPool, addCoverPlayer, removeCoverPlayer, updateCoverPlayer,
  getSession, getUser, findPlayerByUserId, findPlayerByEmail,
  getUserProfile, linkPlayerToUser, updateUserProfile,
  resetDemoData, updateDemoInteraction,
} from "@platform/supabase";
import { SEED_COVER } from "./seeds.js";
import PlayerView    from "./views/PlayerView.jsx";
import StatsView     from "./views/StatsView.jsx";
import HistoryView   from "./views/HistoryView.jsx";
import AdminView     from "./views/AdminView/index.jsx";
import InstallBanner from "./views/InstallBanner.jsx";
import Onboarding    from "./onboarding/index.jsx";
import JoinTeam             from "./views/JoinTeam.jsx";
import EmailCaptureOverlay  from "./views/EmailCaptureOverlay.jsx";
import JoinSuccess   from "./views/JoinSuccess.jsx";
import AuthCallback  from "./views/AuthCallback.jsx";
import Legal         from "./views/Legal.jsx";
import PWAWelcome   from "./views/PWAWelcome.jsx";
import Gaffer        from "./views/Gaffer/index.jsx";

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
    console.warn("[ioo] redirect bridge error:", e);
  }

  // Standalone PWA with no known player — show welcome screen, not the create-a-team landing
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  if (isStandalone) {
    return { type:"pwa_welcome" };
  }

  return { type:"landing" };
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
  const [myPlayer,     setMyPlayer]    = useState(null);
  const [playerTeams,  setPlayerTeams] = useState([]);
  const [selectedTeam, setSelectedTeam]= useState(null);
  const [isAdmin,      setIsAdmin]     = useState(false);

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

  // Email capture overlay (visit 3+ for unlinked token players)
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [linkConflict,     setLinkConflict]     = useState(null);

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet"; el.href = FONT_LINK;
    document.head.appendChild(el);
  }, []);

  useEffect(() => {
    if (route.type === "landing" || route.type === "create" || route.type === "auth_callback") {
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
        // Check auth session
        const session = await getSession();
        if (session?.user) setAuthUser(session.user);

        let resolvedTeamId = null;

        if (route.type === "demoadmin") {
          setIsAdmin(true);
          setView("admin");
          try { await updateDemoInteraction(); } catch(e) {}
          resolvedTeamId = "team_demo";
        }

        if (route.type === "admin") {
          if (route.token === "local") {
            const { data } = await supabase.from("teams").select("id").limit(1).single();
            resolvedTeamId = data?.id;
            setIsAdmin(true);
          } else {
            const team = await getTeamByAdminToken(route.token);
            if (!team) { setError("Invalid admin link."); setLoading(false); return; }
            resolvedTeamId = team.id;
            setIsAdmin(true);
          }
          // Identify which squad member is the admin so My View shows their own data
          if (session?.user) {
            try {
              const adminPlayer = await findPlayerByUserId(session.user.id);
              if (adminPlayer) setMyPlayer(adminPlayer);
            } catch(e) {}
          }
        }

        if (route.type === "player") {
          if (route.token?.startsWith("p_demotoken_")) {
            try { await updateDemoInteraction(); } catch(e) {}
          }
          const player = await getPlayerByToken(route.token);
          if (!player) { setLoading(false); return; }

          // Visit count — increment on every load
          const vcKey = `ioo_visit_count_${route.token}`;
          const visitCount = (parseInt(localStorage.getItem(vcKey) || "0", 10)) + 1;
          localStorage.setItem(vcKey, String(visitCount));

          // If auth'd and not yet linked — attempt to link
          if (session?.user && !player.userId) {
            try {
              const emailMatches = await findPlayerByEmail(session.user.email);
              const conflict = emailMatches.find(m => m.player_id !== player.id);
              if (conflict) {
                setLinkConflict("This email is already linked to another account — contact your admin");
              } else {
                await linkPlayerToUser(player.id, session.user.id);
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
          if (!player.userId && visitCount >= 3) {
            setShowEmailCapture(true);
          }

          setMyPlayer(player);
          const teams = await getPlayerTeams(player.id);
          setPlayerTeams(teams);
          if (teams.length === 0) { setError("Could not find your team."); setLoading(false); return; }
          if (teams.length === 1) resolvedTeamId = teams[0].id;
          else { setLoading(false); return; } // show switcher
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

  // Part A — returning user recognition on /join
  // Runs when both authUser and joinTeam are available
  useEffect(() => {
    if (route.type !== "join" || !authUser || !joinTeam) return;
    let cancelled = false;
    setJoinChecking(true);
    (async () => {
      try {
        const matches = await findPlayerByEmail(authUser.email);
        if (cancelled) return;
        const alreadyMember = matches.find(m => m.team_id === joinTeam.id);
        if (alreadyMember) {
          window.location.replace(`/p/${alreadyMember.token}`);
          return;
        }
        if (matches.length > 0) {
          const profile = await getUserProfile(authUser.id);
          if (cancelled) return;
          const display = profile?.display_name
            || authUser.user_metadata?.full_name
            || authUser.user_metadata?.name
            || authUser.email;
          setJoinPrefillName(display);
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

  // Realtime subscriptions
  useEffect(() => {
    if (!teamId) return;
    const playerSub = supabase.channel(`players:${teamId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"players" },
        async () => { const p = await getPlayers(teamId); setSquadRaw(p); })
      .subscribe();
    const schedSub = supabase.channel(`schedule:${teamId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"schedule", filter:`team_id=eq.${teamId}` },
        async () => { const s = await getSchedule(teamId); if (s) setScheduleRaw(s); })
      .subscribe();
    const matchSub = supabase.channel(`matches:${teamId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"matches", filter:`team_id=eq.${teamId}` },
        async () => { const m = await getMatches(teamId); setMatchHistRaw(m); })
      .subscribe();
    return () => {
      supabase.removeChannel(playerSub);
      supabase.removeChannel(schedSub);
      supabase.removeChannel(matchSub);
    };
  }, [teamId]);

  // ── Setters ──────────────────────────────────────────────────────────────────
  const setSquad = async (updater) => {
    const next = typeof updater==="function" ? updater(squad) : updater;
    setSquadRaw(next);
    try { await upsertPlayers(next, teamId); } catch(e) { console.error(e); }
  };
  const setBibHistory = async (updater) => {
    const next = typeof updater==="function" ? updater(bibHistory) : updater;
    if (next.length > bibHistory.length) {
      try { await insertBib(next[0], teamId); } catch(e) { console.error(e); }
    }
    setBibHistRaw(next);
  };
  const setSchedule = async (updater) => {
    const next = typeof updater==="function" ? updater(schedule) : updater;
    setScheduleRaw(next);
    try { await upsertSchedule(next, teamId); } catch(e) { console.error(e); }
  };
  const setMatchHistory = async (updater) => {
    const next = typeof updater==="function" ? updater(matchHistory) : updater;
    if (next.length > matchHistory.length) {
      try { await insertMatch(next[0], teamId); } catch(e) { console.error(e); }
    }
    setMatchHistRaw(next);
  };
  const setSettings = async (updater) => {
    const next = typeof updater==="function" ? updater(settings) : updater;
    setSettingsRaw(next);
    try { await upsertSettings(next, teamId); } catch(e) { console.error(e); }
  };

  // Reset admin sub-screen when leaving admin view
  useEffect(() => {
    if (view !== "admin") setAdminScreen("main");
  }, [view]);

  // ── Join handler — auth first, name only after signed in ─────────────────
  const handleJoin = async (name) => {
    if (!authUser) return;
    setJoinLoading(true); setJoinError(null);
    try {
      // Check if this auth user already has a player record anywhere
      const existing = await findPlayerByUserId(authUser.id);
      if (existing) {
        // Already a player — just link to this team
        await supabase.from("team_players")
          .upsert({ team_id: joinTeam.id, player_id: existing.id },
            { onConflict:"team_id,player_id" });
        setJoinedPlayer({ id: existing.id, name: existing.name, token: existing.token });
        setJoinLoading(false);
        return;
      }
      // New player — create with auth user_id
      const player = await addPlayerToTeam(name, joinTeam.id, authUser.id);
      setJoinedPlayer(player);
    } catch(e) {
      setJoinError(e.message || "Something went wrong.");
    } finally {
      setJoinLoading(false);
    }
  };

  // ── Gaffer context + navigation ──────────────────────────────────────────
  const _me          = myPlayer ? squad.find(p => p.id === myPlayer.id) : null;
  const _inPlayers   = squad.filter(p => p.status === "in"      && !p.disabled && !p.injured);
  const _reserves    = squad.filter(p => p.status === "reserve" && !p.disabled);
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
  if (route.type === "pwa_welcome")  return <PWAWelcome/>;
  if (route.type === "auth_callback") return <AuthCallback/>;
  if (route.type === "legal") return <Legal/>;
  if (route.type === "create") return <Onboarding/>;

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
          border:"none", background:C.amber, color:"#000",
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
                background:"#0a0a0a", color:C.text,
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
                background: linkInput.match(/\/p\/[a-zA-Z0-9_-]+/) ? C.amber : "#2a2a2a",
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
        color:"#444", textAlign:"center", display:"flex", gap:16,
        justifyContent:"center" }}>
        <a href="/legal" style={{ color:"#444", textDecoration:"none" }}>Terms</a>
        <a href="/legal#privacy" style={{ color:"#444", textDecoration:"none" }}>Privacy</a>
        <a href="mailto:hello@in-or-out.com" style={{ color:"#444", textDecoration:"none" }}>Contact</a>
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

  // Multi-team switcher
  if (route.type==="player" && myPlayer && playerTeams.length > 1 && !selectedTeam) return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <InstallBanner/>
      <div style={{ padding:"20px 18px 12px", background:"#0f0f0f",
        borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28,
          color:C.amber, letterSpacing:3 }}>IN OR OUT</div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:2 }}>Welcome back, {myPlayer.name}</div>
      </div>
      <div style={{ padding:18 }}>
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
        <PlayerView  {...sharedProps} myId={myId} teamId={teamId}
          onMidFlowChange={setIsActionBlocked}
          isAdmin={isAdmin} onGoAdmin={() => setView("admin")}
          matchHistory={matchHistory} bibHistory={bibHistory}
          startTab={playerStartTabRef.current}/>
      )}
      {view==="stats" && <StatsView
        teamId={teamId || squad?.[0]?.team}
        squad={squad}
        bibHistory={bibHistory}
        matchHistory={matchHistory}
        settings={settings}
        schedule={schedule}/>}
      {view==="history" && <HistoryView matchHistory={matchHistory} players={squad} settings={settings} schedule={schedule}/>}
      {view==="admin"   && isAdmin && (
        <AdminView
          {...sharedProps}
          bibHistory={bibHistory}     setBibHistory={setBibHistory}
          matchHistory={matchHistory} setMatchHistory={setMatchHistory}
          coverPool={coverPool}       setCoverPool={setCoverPoolRaw}
          teamId={teamId}
          screen={adminScreen}        setScreen={setAdminScreen}
          onGoPlayer={() => { playerStartTabRef.current = null; setView("player"); }}
          onGoStats={() => { playerStartTabRef.current = "stats"; setView("player"); }}
          onGoHistory={() => { playerStartTabRef.current = "history"; setView("player"); }}
          onGoMyIO={() => { playerStartTabRef.current = "my-io"; setView("player"); }}
          isDemoMode={route.type === "demoadmin"}
          onResetDemo={async () => { await resetDemoData(); await loadTeamData("team_demo"); }}
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
    </div>
  );
}
