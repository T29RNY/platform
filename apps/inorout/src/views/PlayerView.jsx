import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { colors as C, groupByStatus, isLateDropout, sendTemplate, notificationTemplates,
  getPaymentState, getGuestPaymentState,
  handleCashPayment, handleGuestCashPayment,
  resolveMotm, isDormantGuest, isPendingGuest } from "@platform/core";
import { savePushSubscription, playerHasPushSubscription, addGuestPlayer, removeGuestPlayer, reactivateGuestPlayer, setPlayerStatus, setPlayerInjured, setPlayerNote, deletePlayer,
  getPOTMVotingState, getPOTMTallyPublic, setMyNickname,
  resolveBibHolder, getPlayerCompetitionFixtures } from "@platform/core/storage/supabase.js";
import POTMVotingModal from "./POTMVotingModal.jsx";
import AdminPlayerActionSheet from "./AdminPlayerActionSheet.jsx";
import {
  Check, X, Question, ArrowDown,
  PencilSimple, UserPlus, Bandaids, Bell, Hourglass,
} from "@phosphor-icons/react";
import AuthGateModal from "../components/AuthGateModal.jsx";
import useRequireAuth from "../hooks/useRequireAuth.js";
import PageHeader  from "../components/ui/PageHeader.jsx";
import StatusButton from "../components/ui/StatusButton.jsx";
import FirstTimeHint from "../components/FirstTimeHint.jsx";
import UpdateBanner from "../components/UpdateBanner.jsx";
import FitnessNudge from "../components/FitnessNudge.jsx";
import { registerNativePush } from "../native/native-push.js";
import { isNativeApp as detectNativeApp } from "../native/is-native.js";
import Tile        from "../components/ui/Tile.jsx";
import Avatar      from "../components/ui/Avatar.jsx";
import NavBar      from "../components/ui/NavBar.jsx";
import StatsView    from "./StatsView.jsx";
import HistoryView  from "./HistoryView.jsx";
import MyIOView     from "./MyIOView.jsx";
import MySquads     from "./MySquads";
import CompetitionStandingsCard from "./CompetitionStandingsCard";
import CompetitionFixturesCard from "./CompetitionFixturesCard";
import PlayerProfile from "./PlayerProfile.jsx";
import Tour from "../components/Tour.jsx";
import { tourKeyFor } from "../lib/tourRegistry.js";
import { AnimatePresence } from "framer-motion";

// ── helpers ───────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const b   = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b).split('').map(c => c.charCodeAt(0)));
}

function notifyServer(type, teamId, playerIds, payload, gameDate) {
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, teamId, playerIds, payload, gameDate }),
  }).catch(console.error);
}

// ── StatusBadge (inline, player view only) ────────────────────────────────────

const BADGE = {
  in:      { label:"✓ In",      bg:"var(--green2)",  border:"var(--greenb)",  color:"var(--green)",  shadow:"0 0 10px rgba(61,220,106,0.15)"   },
  out:     { label:"✕ Out",     bg:"var(--red2)",    border:"var(--redb)",    color:"var(--red)",    shadow:"0 0 10px rgba(255,64,64,0.15)"    },
  maybe:   { label:"? Maybe",   bg:"var(--amber2)",  border:"var(--amberb)",  color:"var(--amber)",  shadow:"0 0 10px rgba(255,176,32,0.15)"   },
  reserve: { label:"↓ Reserve", bg:"var(--purple2)", border:"var(--purpleb)", color:"var(--purple)", shadow:"0 0 10px rgba(176,96,240,0.15)"   },
};

function StatusBadge({ status }) {
  const c = BADGE[status];
  if (!c) return null;
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:5,
      borderRadius:"var(--r-pill)", padding:"5px 12px",
      fontSize:12, fontWeight:400,
      background:c.bg, border:`0.5px solid ${c.border}`,
      color:c.color, boxShadow:c.shadow,
    }}>
      {c.label}
    </div>
  );
}

// ── Share team sheet (WhatsApp) helpers ──────────────────────────────────────
function formatKickoff(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return "";
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const suffix = h >= 12 ? "pm" : "am";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return min === "00" ? `${h}${suffix}` : `${h}:${min}${suffix}`;
}

function displayName(p) {
  return (p?.nickname || p?.name || "?").trim();
}

// Renders a status section. Returns the section string, or null if empty.
// Hosts render as bulleted (or numbered) lines; their guests nest beneath
// with an arrow. Guests whose host is NOT in this section render standalone.
// Injured players are excluded — they go in their own dedicated section.
function renderTeamSheetSection(emoji, label, players, opts = {}) {
  const nonInjured = (players || []).filter(p => !p.injured);
  if (nonInjured.length === 0) return null;

  const hosts        = nonInjured.filter(p => !p.isGuest);
  const hostIdsHere  = new Set(hosts.map(p => p.id));
  const guestsByHost = new Map();
  const orphanGuests = [];
  for (const g of nonInjured.filter(p => p.isGuest)) {
    if (g.guestOf && hostIdsHere.has(g.guestOf)) {
      if (!guestsByHost.has(g.guestOf)) guestsByHost.set(g.guestOf, []);
      guestsByHost.get(g.guestOf).push(g);
    } else {
      orphanGuests.push(g);
    }
  }

  const { numbered = false, withCap = false, cap = null } = opts;
  const total = nonInjured.length;
  const countText = withCap && cap ? `(${total}/${cap})` : `(${total})`;
  const lines = [`${emoji} ${label} ${countText}`];

  hosts.forEach((host, i) => {
    const prefix = numbered ? `${i + 1}.` : "•";
    lines.push(`${prefix} ${displayName(host)}`);
    for (const g of guestsByHost.get(host.id) || []) {
      lines.push(`  ↳ ${displayName(g)}`);
    }
  });
  for (const g of orphanGuests) {
    lines.push(`• ${displayName(g)}`);
  }
  return lines.join("\n");
}

function buildTeamSheetText({ teamName, schedule, squad, lastMatchMeta, joinCode }) {
  if (!schedule) return "";

  // Date — UK-local via Intl (DST-aware)
  const dateStr = schedule.gameDateTime
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        weekday: "long",
        day: "numeric",
        month: "short",
      }).format(new Date(schedule.gameDateTime))
    : (schedule.dayOfWeek || "");

  const header = `*${teamName || "Team"}*${dateStr ? ` — ${dateStr}` : ""}`;

  if (schedule.isCancelled) {
    return [header, "❌ MATCH CANCELLED"].join("\n");
  }

  const banner = [];
  const kickoff = formatKickoff(schedule.kickoff);
  if (kickoff)                 banner.push(`🕗 ${kickoff}`);
  if (schedule.venue)          banner.push(`📍 ${schedule.venue}`);
  if (schedule.pricePerPlayer) banner.push(`💷 £${schedule.pricePerPlayer}`);

  const groups = groupByStatus(squad || []);
  const cap = schedule.squadSize || 14;

  // Squad-count suffix on the title: "- x more needed" until the target is
  // reached, then "- Full Squad". IN count excludes injured to match the
  // (total/cap) shown in the IN section below and the Live Board IN tile.
  const inCount = groups.in.filter(p => !p.injured).length;
  const shortBy = cap - inCount;
  const titleLine = header + (shortBy > 0 ? ` - ${shortBy} more needed` : ` - Full Squad`);

  const sections = [];
  sections.push(renderTeamSheetSection("🟢", "IN",      groups.in,      { withCap: true, cap }));
  sections.push(renderTeamSheetSection("🟣", "RESERVE", groups.reserve, { numbered: true }));
  sections.push(renderTeamSheetSection("🟡", "MAYBE",   groups.maybe));
  sections.push(renderTeamSheetSection("🔴", "OUT",     groups.out));

  // Injured — dedicated section, sourced from any-status players with injured=true
  const injured = (squad || []).filter(p => p.injured && !p.disabled);
  if (injured.length > 0) {
    const lines = ["🩹 INJURED"];
    for (const p of injured) lines.push(`• ${displayName(p)}`);
    sections.push(lines.join("\n"));
  }

  // Bibs
  const bibName = resolveBibHolder(lastMatchMeta?.bibHolder, squad || []);
  if (bibName) sections.push(`👕 Bibs: ${bibName}`);

  // Join-link CTA — only when spots are open AND a join code is present. Turns
  // the group broadcast into a way back into the app (returning member re-marks
  // in; newcomer onboards). Team-level /join link, never a personal /p token.
  // When the squad is full (shortBy <= 0) or no code is available, nothing is
  // pushed — the message is byte-for-byte unchanged from before this feature.
  if (shortBy > 0 && joinCode) {
    sections.push(`👉 In or out? Tap to update:\nhttps://app.in-or-out.com/join/${joinCode}`);
  }

  return [titleLine, banner.join("  "), ...sections.filter(Boolean)].filter(Boolean).join("\n\n");
}

// ── main component ────────────────────────────────────────────────────────────

export default function PlayerView({
  squad, setSquad, myId, teamId, adminToken = null, schedule: scheduleProp, settings,
  setSchedule, setSettings, onMidFlowChange,
  bibHistory = [], matchHistory = [],
  isAdmin = false, onGoAdmin,
  startTab = null,
  stats = null,
  context = null,
  multiContextNav = false, onSwitcherOpen = null,
  authUserId = null,
}) {
  const me = squad.find(p => p.id === myId);

  // Admin can tap any OTHER player's avatar on My View to open the quick-action
  // sheet (set their status / add a guest). Self uses the own status buttons.
  const canAdminAct  = isAdmin && !!adminToken;
  const adminTapFor  = (p) => (canAdminAct && p.id !== myId ? () => setAdminActionPlayer(p) : undefined);

  // ── League Mode 5.5 — competitive availability reuses the casual board ──────
  // For a competitive team we overlay the casual schedule with the next league
  // fixture: the board goes live, its header shows the real opponent/date/venue/
  // time, and players mark in/out exactly as casual (writes players.status). The
  // board auto-rolls to the next fixture as completed ones leave the upcoming set.
  // Casual teams have no fixtures → `schedule` is the unmodified prop (zero change).
  const playerToken = me?.token || null;
  const [compFixtures, setCompFixtures] = useState([]);
  useEffect(() => {
    if (!playerToken) { setCompFixtures([]); return; }
    getPlayerCompetitionFixtures(playerToken, "all")
      .then(d => setCompFixtures(d?.fixtures || []))
      .catch(e => { console.error(e); setCompFixtures([]); });
  }, [playerToken]);

  const nextFixture = useMemo(() => {
    // RPC returns fixtures ordered scheduled_date ASC — first scheduled is next.
    return compFixtures.find(f => f.status === "scheduled") || null;
  }, [compFixtures]);

  const schedule = useMemo(() => {
    if (!nextFixture) return scheduleProp;
    const dateLabel = nextFixture.scheduled_date
      ? new Date(`${nextFixture.scheduled_date}T00:00:00`)
          .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
      : (scheduleProp?.dayOfWeek || "");
    return {
      ...scheduleProp,
      gameIsLive: true,
      isCancelled: false,
      dayOfWeek: dateLabel,
      venue: nextFixture.venue_name || scheduleProp?.venue,
      kickoff: nextFixture.kickoff_time ? nextFixture.kickoff_time.slice(0, 5) : scheduleProp?.kickoff,
    };
  }, [nextFixture, scheduleProp]);

  const opponentLabel = nextFixture
    ? `${nextFixture.is_home ? "vs" : "@"} ${nextFixture.opponent_name || "TBC"}`
    : null;

  // ── auth gate for self-writes ──────────────────────────────────────────────
  // On the admin route in the home-screen app, no row has isSelf=true
  // (mig 070's flag requires auth.uid()). App.jsx then falls back to
  // squad[0] for myId — so `me` is the first squad member, not the actual
  // viewer. Acting as that wrong user is the bug. The gate: on admin
  // routes, if `me.isSelf` is false (fallback in play, or unauthed PWA),
  // pop the email-OTP modal. After verify, reload so the team-state
  // refetch sees auth.uid() and isSelf flips true on the right row.
  //
  // Player route (/p/<token>): me.token comes from the URL → isSelf isn't
  // set but the token IS the identity. needsSelfAuth stays false because
  // isAdmin is false on that route.
  const { requireAuth, gateProps } = useRequireAuth();
  const needsSelfAuth = isAdmin && !me?.isSelf;
  const promptSignIn = () => requireAuth(() => window.location.reload(), {
    reason: "Sign in once on this device to manage your own status. You won't be asked again.",
  });

  // ── existing state ── (unchanged)
  const [note,          setNote]         = useState(me?.note || "");
  const [showNote,      setShowNote]     = useState(false);
  const [notifState,    setNotifState]   = useState(
    () => (typeof localStorage !== "undefined" && localStorage.getItem(`notif_${myId}`)) || "idle"
  );
  // Push opt-in modal — fired after a player marks themselves "in" (the highest-
  // intent moment). Replaces the always-on inline card. "Not now" lets it return
  // a bounded number of times; "Never" stops it for good (profile toggle still
  // works). The hard iOS prompt only fires AFTER they tap Allow, so we never burn
  // iOS's one-shot permission dialog on someone who'd have said no.
  const [showPushModal, setShowPushModal] = useState(false);
  // Fallback timer for native push registration. On builds without APNs creds
  // (or the simulator) the OS never delivers a device token, so the
  // 'registration' event — and thus onRegistered — never fires and the modal
  // would hang on "Turning on…" forever. We arm this after register() kicks off
  // and flip to "subscribed" if it's still "asking" ~5s later. Cleared the
  // moment onRegistered/onError actually fires so a real result always wins.
  const pushRegTimer = useRef(null);
  const pushServerChecked = useRef(false);
  const [showPlusOneForm, setShowPlusOneForm] = useState(false);
  const [guestName,       setGuestName]       = useState("");
  const [guestSelfPaid,   setGuestSelfPaid]   = useState(false);
  const [addingGuest,     setAddingGuest]     = useState(false);
  const [guestAddError,   setGuestAddError]   = useState(null);
  const [pickerPlayer,    setPickerPlayer]    = useState(null);
  const [removingGuest,   setRemovingGuest]   = useState(false);

  // ── new UI state ──
  const [activeTab,   setActiveTab]   = useState(startTab || "my-view");
  const [showNoResp,  setShowNoResp]  = useState(false);
  // Admin avatar-tap quick-action sheet (My View). Set to the tapped player.
  const [adminActionPlayer, setAdminActionPlayer] = useState(null);
  const [cashPending,       setCashPending]       = useState(false);
  const [guestCashPending,  setGuestCashPending]  = useState(() => new Set());
  // Status confirmation messages (Locked in / We'll keep a spot / etc)
  // start hidden so a page refresh doesn't resurrect them. setStatus
  // flips this to false and re-arms the 5s timer that flips it back.
  const [hideConfirmation,  setHideConfirmation]  = useState(true);
  const confirmationTimer = useRef(null);
  // Brief tap-feedback state: drives the flash on the status-button row.
  // Colour matches the status tapped (in→green, out→red, maybe→amber,
  // reserve→purple). Cleared 600ms after each tap. The pulse-on-attention
  // animation is gated separately by status === 'none'.
  const [justTapped, setJustTapped] = useState(false);
  const [lastTappedStatus, setLastTappedStatus] = useState(null);
  const tapFlashTimer = useRef(null);
  const [lastMatchMeta,   setLastMatchMeta]   = useState(null);
  const [showPOTMModal,   setShowPOTMModal]   = useState(false);
  const [potmEligible,    setPotmEligible]    = useState([]);
  const [potmHasVoted,    setPotmHasVoted]    = useState(false);
  const [potmExistingVote,setPotmExistingVote]= useState(null);
  const [potmTally,       setPotmTally]       = useState([]);
  const [potmTotalVotes,  setPotmTotalVotes]  = useState(0);
  const [potmBanner,      setPotmBanner]      = useState(null); // { winnerName, isWinner }
  const prevVotingOpen = useRef(false);

  const [payError,        setPayError]        = useState(null);
  const [ledgerBalance,   setLedgerBalance]   = useState(null);
  // ?pay=1 → open Payment History straight away (mig 591 debt chase, PR #2).
  // A chase that lands on the top of PlayerView is a nag; landing on the screen with the
  // "I've paid" button and the per-week breakdown makes it actionable. Read once at mount
  // as the initial state rather than in an effect, so the sheet is open on first paint —
  // no flash of the wrong screen.
  const [showProfile,     setShowProfile]     = useState(() => {
    try { return new URLSearchParams(window.location.search).get("pay") === "1"; }
    catch { return false; }
  });

  // Inline nickname edit (My View header)
  const [editingMyNick, setEditingMyNick] = useState(false);
  const [myNick,        setMyNick]        = useState("");
  const [myNickError,   setMyNickError]   = useState(null);
  const [myNickSaving,  setMyNickSaving]  = useState(false);

  const saveMyNick = async () => {
    setMyNickSaving(true); setMyNickError(null);
    try {
      await setMyNickname(me?.token, myNick);
      const trimmed = myNick.trim() || null;
      setSquad(sq => sq.map(p => p.id === myId ? { ...p, nickname: trimmed } : p));
      setEditingMyNick(false);
    } catch(e) {
      setMyNickError(e?.code === "nickname_taken" ? "Already taken on this squad" : "Failed to save");
    } finally {
      setMyNickSaving(false);
    }
  };

  // ── existing derived ── (unchanged)
  const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  // Native (Capacitor) push goes through the APNs/FCM plugin, NOT the web
  // PushManager/serviceWorker APIs — which don't exist in the iOS WKWebView.
  // So treat a native build as push-capable regardless of those web checks;
  // otherwise the "Enable" opt-in never renders on the App Store / TestFlight
  // build and no device token is ever captured.
  const isNativeApp  = detectNativeApp();
  const canPush      = isNativeApp ||
    ("PushManager" in window && "serviceWorker" in navigator && (!isIOS || isStandalone));

  // Persistent guests (S1): only ACTIVE guests (status !== 'none') count as
  // "my +1s this week". A dormant guest row left over from last week must NOT
  // block the Plus One button — it's available again via the returning picker.
  // A pending plus-one (mig 346) has status='none' but pendingApproval=true — it
  // still counts as "my +1 this week" so the host sees it (waiting for approval)
  // and can't silently add another while one is queued.
  const myGuests      = squad.filter(p => p.isGuest && p.guestOf === myId && (p.status !== "none" || p.pendingApproval));
  const myGuest       = myGuests[0] ?? null;
  const canRemoveGuest = !schedule.isDraft;
  // Persistent guests S2: the team's dormant past guests, offered in the Plus One
  // picker so a host can bring one back (re-activate) instead of re-typing a name.
  // Exclude pending-approval guests — they aren't a returnable past guest yet.
  const pastGuests    = squad
    .filter(p => isDormantGuest(p) && !isPendingGuest(p))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const inPlayers        = squad.filter(p => p.status === "in" && !p.disabled && !p.injured);
  const nonGuestInPlayers = inPlayers.filter(p => !p.isGuest);
  const teamsSet         = nonGuestInPlayers.length > 0 && nonGuestInPlayers.every(p => p.team);
  const formMap          = Object.fromEntries((stats?.playerForm || []).map(f => [f.player_id, f.form]));
  // Last week's POTM — id-first (recent matches store the id), name fallback (legacy)
  const isLastMotm = (p) => !!lastMatchMeta?.motm &&
    (lastMatchMeta.motm === p.id || lastMatchMeta.motm === (p.nickname || p.name));

  // WhatsApp team-sheet share — lives on the Live Board IN tile (below the count).
  const shareUrl = schedule
    ? `https://wa.me/?text=${encodeURIComponent(buildTeamSheetText({
        teamName: settings?.groupName,
        schedule,
        squad,
        lastMatchMeta,
        joinCode: settings?.joinCode,
      }))}`
    : null;

  useEffect(() => {
    setLastMatchMeta(stats?.lastMatchMeta || null);
    setLedgerBalance(stats?.outstandingBalance ?? 0);
  }, [stats]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live POTM tally fetch — server-gated, returns counts only once the player
  // has voted ({ voted:false } otherwise). Counts arrive winner-first.
  const fetchPotmTally = useCallback(() => {
    if (!me?.token) return;
    const matchId = schedule?.activeMatchId || matchHistory?.[0]?.id;
    if (!matchId) return;
    getPOTMTallyPublic(me.token, matchId, teamId)
      .then(({ voted, tally, totalVotes }) => {
        if (!voted) return; // gate not yet open for this caller
        setPotmTally(tally);
        setPotmTotalVotes(totalVotes);
      })
      .catch(() => {});
  }, [me?.token, teamId, schedule?.activeMatchId, matchHistory]);

  // POTM voting — open modal when voting becomes active for this player
  useEffect(() => {
    const activeMatch = matchHistory?.[0];
    const wasOpen = prevVotingOpen.current;
    const nowOpen = schedule?.votingOpen;

    // Voting just opened → check eligibility
    if (nowOpen && !wasOpen && activeMatch && me && !me.isGuest) {
      prevVotingOpen.current = true;
      const matchId = schedule.activeMatchId || activeMatch.id;
      getPOTMVotingState(me.token, matchId, teamId)
        .then(({ eligible, existingVote, votes }) => {
          const myVote = votes.find(v => v.voter_id === myId);
          const voted = !!(myVote || existingVote);
          setPotmEligible(eligible);
          setPotmHasVoted(voted);
          setPotmExistingVote(existingVote || myVote?.nominee_id || null);
          if (voted) fetchPotmTally(); // already voted → pull the live tally
          const amEligible = eligible.some(p => p.id === myId);
          // Reappear on every app open while voting is live UNTIL the player
          // actually casts a vote — then never again. `voted` is server-truth
          // (votes/existingVote), so once they vote it stays suppressed across
          // reloads. Within a session the nowOpen && !wasOpen gate above keeps
          // it from re-popping after a dismissal. (Previously a localStorage
          // "seen" flag was set on first show, so dismissing without voting
          // killed it permanently — the bug this replaces.)
          if (amEligible && !voted) {
            setShowPOTMModal(true);
          }
        })
        .catch(() => {});
    }

    // Voting just closed + result is in → show banner
    if (!nowOpen && wasOpen && activeMatch?.motm) {
      prevVotingOpen.current = false;
      const winnerName = resolveMotm(activeMatch.motm, squad) || "Unknown";
      const isWinner = !!(me && activeMatch.motm === me.id);
      setPotmBanner({ winnerName, isWinner });
      setTimeout(() => setPotmBanner(null), 5000);
    } else if (!nowOpen) {
      prevVotingOpen.current = false;
    }
  }, [schedule?.votingOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live tally refresh — piggybacks on the team_live broadcast: every
  // notify_team_change (incl. submit_potm_vote) drives App.jsx's refreshTeamData,
  // which re-sets matchHistory. Re-pull the tally on that signal while the modal
  // is open, voting is live, and this player has voted. No new channel.
  useEffect(() => {
    if (showPOTMModal && schedule?.votingOpen && potmHasVoted) fetchPotmTally();
  }, [matchHistory, showPOTMModal, schedule?.votingOpen, potmHasVoted, fetchPotmTally]);

  const isFull   = inPlayers.length >= (schedule.squadSize || 14);
  // Admin-configured day_of_week is authoritative; the timestamp-derived
  // weekday is only a fallback (the demo schedule had drift between the
  // two, surfacing 'Tuesday' on a Wednesday match).
  const gameDay = schedule?.dayOfWeek
    || (schedule?.gameDateTime
        ? new Date(schedule.gameDateTime).toLocaleDateString('en-GB', { weekday:'long' })
        : 'this week');
  const groups   = groupByStatus(squad);
  const teamAPlayers = [...inPlayers.filter(p => p.team === "A")].sort((a, b) => a.name.localeCompare(b.name));
  const teamBPlayers = [...inPlayers.filter(p => p.team === "B")].sort((a, b) => a.name.localeCompare(b.name));

  // ── tile arrays ──
  const maybePlayers   = (groups.maybe   || []).filter(p => !p.disabled);
  const outPlayers     = (groups.out     || []).filter(p => !p.disabled);
  const reservePlayers = (groups.reserve || []).filter(p => !p.disabled);
  const noRespPlayers  = (groups.none    || []).filter(p => !p.disabled);

  // ── existing handlers ── (all unchanged)

  // Count one opt-in "ask" toward PUSH_ASK_CAP so a repeatedly-failing path
  // eventually stops nagging on its own. Shared by "Not now" and by the failure
  // branches of "Allow" (an interrupted/failed Allow used to re-nag forever
  // because only "Not now" ever incremented this).
  const bumpAskCount = () => {
    try {
      const asks = (parseInt(localStorage.getItem(`notif_asks_${myId}`) || "0", 10) || 0) + 1;
      localStorage.setItem(`notif_asks_${myId}`, String(asks));
    } catch { /* noop */ }
  };
  const handleSubscribe = async () => {
    if (needsSelfAuth) { promptSignIn(); return; }
    // Re-tap safety: clear any timer left armed by a prior attempt.
    if (pushRegTimer.current) { clearTimeout(pushRegTimer.current); pushRegTimer.current = null; }
    setNotifState("asking");
    try {
      // Native wrapper (iOS/Android): use APNs/FCM via the Capacitor bridge.
      // Returns false on the web so we fall through to the web-push flow.
      const native = await registerNativePush(me?.token, {
        // Mark subscribed ONLY when a device token actually lands and saves.
        // A real result always wins over the fallback timer — disarm it.
        onRegistered: () => {
          if (pushRegTimer.current) { clearTimeout(pushRegTimer.current); pushRegTimer.current = null; }
          localStorage.setItem(`notif_${myId}`, "subscribed");
          setNotifState("subscribed");
        },
        // Token never arrived / save failed → reset to idle so the Enable
        // prompt comes back and the user can retry (no permanent stuck state).
        onError: () => {
          if (pushRegTimer.current) { clearTimeout(pushRegTimer.current); pushRegTimer.current = null; }
          localStorage.removeItem(`notif_${myId}`);
          bumpAskCount(); // a failed Allow counts toward the cap so it stops re-nagging
          setNotifState("idle");
        },
      });
      if (native === "registering") {
        // Registration kicked off. The device token arrives asynchronously via
        // onRegistered — but on a build without APNs creds it may never come, so
        // don't leave the modal stuck on "Turning on…". After ~5s, if we're still
        // "asking" (neither callback fired), optimistically confirm and dismiss;
        // the token still saves in the background if onRegistered lands later.
        setNotifState("asking");
        pushRegTimer.current = setTimeout(() => {
          pushRegTimer.current = null;
          // Only confirm if nothing else resolved us out of "asking" in the
          // meantime — a real onRegistered/onError always wins.
          setNotifState(prev => {
            if (prev !== "asking") return prev;
            try { localStorage.setItem(`notif_${myId}`, "subscribed"); } catch { /* noop */ }
            return "subscribed";
          });
        }, 5000);
        return;
      }
      if (native === "denied") {
        localStorage.setItem(`notif_${myId}`, "denied");
        setNotifState("denied");
        return;
      }

      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        localStorage.setItem(`notif_${myId}`, "denied");
        setNotifState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
      });
      await savePushSubscription(me?.token, sub.toJSON());
      localStorage.setItem(`notif_${myId}`, "subscribed");
      setNotifState("subscribed");
    } catch(e) {
      console.error("Push subscribe failed:", e);
      bumpAskCount(); // a failed Allow counts toward the cap so it stops re-nagging
      setNotifState("idle");
    }
  };

  // ── push opt-in modal control ──
  // Re-ask cap: after this many "Not now" taps we stop nudging (Allow → subscribed/
  // denied and Never both stop earlier). Keeps the ask balanced, not naggy.
  const PUSH_ASK_CAP = 3;
  const maybeAskPush = () => {
    if (!canPush) return;
    if (notifState === "subscribed" || notifState === "denied" || notifState === "never") return;
    let asks = 0;
    try { asks = parseInt(localStorage.getItem(`notif_asks_${myId}`) || "0", 10) || 0; }
    catch { /* localStorage unavailable — fail open, just show it */ }
    if (asks >= PUSH_ASK_CAP) return;
    setShowPushModal(true);
  };
  // "Not now": close + count the ask so it eventually stops on its own.
  const handlePushNotNow = () => {
    bumpAskCount();
    setShowPushModal(false);
  };
  // "Never": stop asking for good. Profile toggle remains the way back in.
  const handlePushNever = () => {
    try { localStorage.setItem(`notif_${myId}`, "never"); } catch { /* noop */ }
    setNotifState("never");
    setShowPushModal(false);
  };
  // Auto-dismiss the modal a beat after a token actually lands (subscribed),
  // so the user sees the "all set" confirmation before it closes.
  useEffect(() => {
    if (showPushModal && notifState === "subscribed") {
      const t = setTimeout(() => setShowPushModal(false), 1600);
      return () => clearTimeout(t);
    }
  }, [showPushModal, notifState]);
  // Clear the native-push fallback timer on unmount so it never setState()s a
  // torn-down component.
  useEffect(() => () => {
    if (pushRegTimer.current) { clearTimeout(pushRegTimer.current); pushRegTimer.current = null; }
  }, []);
  // Server truth (mig 514): if the player already has a saved push subscription
  // on any platform, suppress the opt-in banner regardless of the local flag —
  // an app update / cache clear / interrupted round-trip can lose the local
  // "subscribed" flag while the server token stays valid, which otherwise
  // re-nags an already-subscribed player forever. One-shot, non-blocking,
  // fail-open (any error → behave exactly as before).
  useEffect(() => {
    if (pushServerChecked.current) return;
    if (!me?.token) return;
    if (notifState === "subscribed" || notifState === "denied" || notifState === "never") {
      pushServerChecked.current = true;
      return;
    }
    pushServerChecked.current = true;
    (async () => {
      try {
        const subscribed = await playerHasPushSubscription(me.token);
        if (subscribed) {
          try { localStorage.setItem(`notif_${myId}`, "subscribed"); } catch { /* noop */ }
          setNotifState("subscribed");
        }
      } catch (e) {
        console.error("push server-truth check failed:", e);
      }
    })();
  }, [me?.token, notifState, myId]);

  const setStatus = (s) => {
    if (needsSelfAuth) { promptSignIn(); return; }
    setCashPending(false);
    setGuestCashPending(new Set());
    clearTimeout(confirmationTimer.current);
    setHideConfirmation(false);
    confirmationTimer.current = setTimeout(() => setHideConfirmation(true), 5000);

    // Quick flash on the status-button row (600ms). Colour matches the
    // tapped status so the feedback feels semantic.
    clearTimeout(tapFlashTimer.current);
    setLastTappedStatus(s);
    setJustTapped(true);
    tapFlashTimer.current = setTimeout(() => setJustTapped(false), 600);

    // Haptic tap-tick. Works on Android Chrome/Firefox + PWA;
    // iOS Safari leaves navigator.vibrate undefined → no-op via the
    // optional chain. No try/catch needed in supported browsers but
    // defensive against a rare implementation that throws.
    try { navigator.vibrate?.(20); } catch { /* haptic best-effort */ }
    const late = isLateDropout(me?.status, s, schedule.gameDateTime);
    if (late) sendTemplate(notificationTemplates.lateDropout, me?.name);
    setSquad(squad.map(p => p.id === myId
      ? { ...p, status: s, note, lateDropouts: (p.lateDropouts || 0) + (late ? 1 : 0) }
      : p
    ));
    if (me?.token) setPlayerStatus(me.token, s).catch(console.error);

    // Ask about notifications the moment a player commits to a game — the point
    // they most want spot-opened / squad-full pings. Only on the transition INTO
    // "in" (not a re-tap), and only if we haven't subscribed/blocked/opted out.
    if (s === "in" && me?.status !== "in") maybeAskPush();

    if (!teamId) return;
    const gameDate = schedule.gameDateTime?.split("T")[0];

    // Spot-opened notification is now server-driven (mig 230): a DB trigger
    // reliably alerts the next reserve on ANY spot-freeing event (player out,
    // admin out, disable, injury) — not just this device's self-toggle.

    if (s === "in" && me?.status !== "in") {
      const currentInCount = inPlayers.length;
      const willBeFull     = currentInCount + 1 >= (schedule.squadSize || 14);
      if (willBeFull) {
        const toNotify = squad.filter(p => p.id !== myId && p.status !== "in" && !p.disabled && !p.injured);
        notifyServer("squadFull", teamId, toNotify.map(p => p.id), {
          title: "In or Out ⚽",
          body: "🔒 Squad's full! Get on the reserve list before it's too late.",
          icon: "/icons/icon-192.png",
        }, gameDate);
      }
    }
  };

  const saveNote = () => {
    setSquad(squad.map(p => p.id === myId ? { ...p, note } : p));
    setShowNote(false);
    if (me?.token) setPlayerNote(me.token, note).catch(console.error);
  };

  const handleGuestNameChange = (val) => {
    setGuestName(val);
    if (val.trim().length >= 2) {
      const match = squad.find(p => !p.isGuest && !p.disabled && p.id !== myId &&
        p.name.toLowerCase().startsWith(val.toLowerCase().trim()));
      setPickerPlayer(match || null);
    } else {
      setPickerPlayer(null);
    }
  };

  const submitGuest = async () => {
    if (!guestName.trim() || addingGuest) return;
    if (needsSelfAuth) { promptSignIn(); return; }
    setAddingGuest(true);
    setGuestAddError(null);
    try {
      // adminToken is set only on /admin routes — an admin's own +1 is approved
      // straight in; a player's +1 (adminToken null) enters pending approval.
      const guest = await addGuestPlayer(me?.token, guestName.trim(), adminToken);
      setSquad([...squad, guest]);
      // Notify admins a plus-one needs approval (push; dormant until admins
      // enable notifications). Fire-and-forget — never blocks the add.
      if (guest?.pendingApproval && teamId) {
        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "guestPendingApproval",
            teamId,
            payload: {
              title: "Plus-one to approve 🙋",
              body: `${me?.name || "A player"} added ${guestName.trim()} — approve or decline.`,
              icon: "/icons/icon-192.png",
            },
          }),
        }).catch(() => {});
      }
      setGuestName("");
      setGuestSelfPaid(false);
      setPickerPlayer(null);
      setShowPlusOneForm(false);
      onMidFlowChange?.(false);
    } catch(e) {
      console.error("Failed to add guest:", e);
      const msg = e?.message || "";
      setGuestAddError(msg === "squad_full" ? "The squad is full — no more spots left." : "Something went wrong. Try again.");
    } finally {
      setAddingGuest(false);
    }
  };

  const reactivateGuest = async (guestId) => {
    if (addingGuest) return;
    if (needsSelfAuth) { promptSignIn(); return; }
    setAddingGuest(true);
    setGuestAddError(null);
    try {
      const guest = await reactivateGuestPlayer(me?.token, guestId);
      // Swap the dormant squad row for the now-active one (it's already in squad).
      setSquad(sq => sq.map(p => p.id === guest.id ? guest : p));
      setGuestName("");
      setGuestSelfPaid(false);
      setPickerPlayer(null);
      setShowPlusOneForm(false);
      onMidFlowChange?.(false);
    } catch(e) {
      console.error("Failed to reactivate guest:", e);
      const msg = e?.message || "";
      setGuestAddError(msg === "squad_full" ? "The squad is full — no more spots left." : "Something went wrong. Try again.");
    } finally {
      setAddingGuest(false);
    }
  };

  const confirmExistingPlayer = () => {
    if (!pickerPlayer) return;
    setSquad(squad.map(p => p.id === pickerPlayer.id ? { ...p, status: "in" } : p));
    if (pickerPlayer.token) setPlayerStatus(pickerPlayer.token, "in").catch(console.error);
    setGuestName("");
    setPickerPlayer(null);
    setShowPlusOneForm(false);
  };

  const removeMyGuest = async (guestId) => {
    if (removingGuest) return;
    setRemovingGuest(true);
    try {
      await removeGuestPlayer(me.token, guestId);
      setSquad(sq => sq.filter(p => p.id !== guestId));
    } catch(e) {
      console.error("Failed to remove guest:", e);
    } finally {
      setRemovingGuest(false);
    }
  };

  const toggleInjury = () => {
    if (needsSelfAuth) { promptSignIn(); return; }
    const newInjured = !me?.injured;
    const needsStatusReset = newInjured && ["in", "reserve", "maybe"].includes(me?.status);
    setSquad(squad.map(p => p.id === myId
      ? { ...p, injured: newInjured, status: needsStatusReset ? "out" : p.status }
      : p
    ));
    if (me?.token) setPlayerInjured(me.token, newInjured).catch(console.error);
  };


  // ── render ────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence mode="wait" initial={false}>
    {showProfile ? (
      <PlayerProfile
        key="profile"
        me={me}
        settings={settings}
        onBack={() => setShowProfile(false)}
        onSwitchContext={onSwitcherOpen ? () => { setShowProfile(false); onSwitcherOpen(); } : null}
      />
    ) : (
    <div key="main" style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)", fontFamily:"var(--font-body)" }}>

      {/* App Store update nudge — native iOS only, self-hides when up to date / dismissed / on web */}
      <UpdateBanner />

      {/* POTM voting modal */}
      {showPOTMModal && (
        <POTMVotingModal
          matchId={schedule.activeMatchId || matchHistory?.[0]?.id}
          teamId={teamId}
          voterId={myId}
          voterToken={me?.token}
          voterName={me?.name}
          eligiblePlayers={potmEligible}
          hasVoted={potmHasVoted}
          existingVote={potmExistingVote}
          votingOpen={!!schedule.votingOpen}
          votingClosesAt={schedule.votingClosesAt}
          motm={matchHistory?.[0]?.motm}
          tally={potmTally}
          totalVotes={potmTotalVotes}
          onVoted={() => { setPotmHasVoted(true); fetchPotmTally(); }}
          onClose={() => setShowPOTMModal(false)}
        />
      )}

      {/* Push opt-in modal — fired from setStatus on the "in" tap. Soft ask
          BEFORE the hard iOS prompt: Allow runs the real registration (which
          surfaces the OS dialog); Not now/Never never touch it. */}
      {showPushModal && (
        <div
          onClick={() => { if (notifState !== "asking") handlePushNotNow(); }}
          style={{ position:"fixed", inset:0, zIndex:120, background:"rgba(0,0,0,0.6)",
            display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"var(--s1)", borderRadius:"var(--rs)", maxWidth:340, width:"100%",
            padding:"24px 22px", border:"0.5px solid var(--border-subtle)",
            boxShadow:"0 10px 44px rgba(0,0,0,0.45)" }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}>
              <div style={{ width:54, height:54, borderRadius:"50%",
                background: notifState === "subscribed"
                  ? "color-mix(in srgb, var(--green) 18%, var(--s2))"
                  : "color-mix(in srgb, var(--gold) 16%, var(--s2))",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Bell size={27} weight="thin"
                  color={notifState === "subscribed" ? "var(--green)" : "var(--gold)"} />
              </div>
            </div>

            {notifState === "subscribed" ? (
              <>
                <div style={{ textAlign:"center", fontFamily:"var(--font-heading)",
                  fontSize:24, color:"var(--t1)", letterSpacing:0.5, marginBottom:8 }}>
                  YOU'RE ALL SET
                </div>
                <div style={{ textAlign:"center", fontSize:13, color:"var(--t2)",
                  fontWeight:300, lineHeight:1.5 }}>
                  We'll ping you the moment a spot opens.
                </div>
              </>
            ) : notifState === "denied" ? (
              <>
                <div style={{ textAlign:"center", fontFamily:"var(--font-heading)",
                  fontSize:24, color:"var(--t1)", letterSpacing:0.5, marginBottom:8 }}>
                  NOTIFICATIONS ARE BLOCKED
                </div>
                <div style={{ textAlign:"center", fontSize:13, color:"var(--t2)",
                  fontWeight:300, lineHeight:1.5, marginBottom:20 }}>
                  Turn them on in <strong style={{ color:"var(--t1)" }}>Settings → In or Out → Notifications</strong> to hear about spots opening up.
                </div>
                <button onClick={() => setShowPushModal(false)} style={{
                  width:"100%", background:"var(--s3)", color:"var(--t1)", border:"none",
                  borderRadius:"var(--r-button)", padding:"13px", fontSize:14, fontWeight:500,
                  fontFamily:"var(--font-body)", cursor:"pointer" }}>
                  Got it
                </button>
              </>
            ) : (
              <>
                <div style={{ textAlign:"center", fontFamily:"var(--font-heading)",
                  fontSize:24, color:"var(--t1)", letterSpacing:0.5, marginBottom:10 }}>
                  TURN ON NOTIFICATIONS?
                </div>
                <div style={{ fontSize:13, color:"var(--t2)", fontWeight:300,
                  lineHeight:1.5, marginBottom:6 }}>
                  We'll only message you when it matters:
                </div>
                <ul style={{ margin:"0 0 22px", padding:"0 0 0 2px", listStyle:"none",
                  display:"flex", flexDirection:"column", gap:8 }}>
                  {[
                    "A spot opens up — so you can grab it",
                    "The squad's filling up",
                    "A late change before kick-off",
                  ].map((line, i) => (
                    <li key={i} style={{ display:"flex", gap:9, alignItems:"flex-start",
                      fontSize:13, color:"var(--t1)", fontWeight:300, lineHeight:1.45 }}>
                      <span style={{ color:"var(--gold)", flexShrink:0 }}>•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={handleSubscribe} disabled={notifState === "asking"} style={{
                  width:"100%", background:"var(--gold)", color:"var(--bg)", border:"none",
                  borderRadius:"var(--r-button)", padding:"13px", fontSize:15, fontWeight:600,
                  fontFamily:"var(--font-body)", cursor: notifState === "asking" ? "default" : "pointer",
                  opacity: notifState === "asking" ? 0.6 : 1, marginBottom:8 }}>
                  {notifState === "asking" ? "Turning on…" : "Allow"}
                </button>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={handlePushNotNow} disabled={notifState === "asking"} style={{
                    flex:1, background:"none", color:"var(--t2)", border:"none",
                    padding:"11px", fontSize:14, fontWeight:400, fontFamily:"var(--font-body)",
                    cursor:"pointer" }}>
                    Not now
                  </button>
                  <button onClick={handlePushNever} disabled={notifState === "asking"} style={{
                    flex:1, background:"none", color:"var(--t2)", border:"none",
                    padding:"11px", fontSize:14, fontWeight:400, fontFamily:"var(--font-body)",
                    cursor:"pointer", opacity:0.7 }}>
                    Never
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Admin avatar-tap quick-action sheet (set status / add guest) */}
      {adminActionPlayer && (
        <AdminPlayerActionSheet
          player={adminActionPlayer}
          squad={squad}
          setSquad={setSquad}
          adminToken={adminToken}
          teamId={teamId}
          schedule={schedule}
          settings={settings}
          adminName={me?.nickname || me?.name}
          onClose={() => setAdminActionPlayer(null)}
        />
      )}

      {/* POTM result banner */}
      {potmBanner && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 90,
          background: "var(--gold)", padding: "calc(14px + env(safe-area-inset-top)) 20px 14px",
          textAlign: "center", fontFamily: "var(--font-body)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--bg)" }}>
            {potmBanner.isWinner
              ? "🏆 You've been voted POTM tonight. Get in."
              : `🏆 ${potmBanner.winnerName} wins POTM tonight!`}
          </span>
        </div>
      )}

      {/* 1 ── PAGE HEADER (sticky) — my-view only; stats/history render their own headers */}
      {activeTab === "my-view" && (
        <div style={{ position:"sticky", top:0, zIndex:50, background:"var(--bg)" }}>
          <PageHeader
            teamName={settings?.groupName}
            opponentLabel={opponentLabel}
            dayOfWeek={schedule.dayOfWeek}
            venue={schedule.venue}
            kickoff={schedule.kickoff}
            pricePerPlayer={schedule.pricePerPlayer}
            squad={squad}
            inCount={inPlayers.length}
            squadSize={schedule.squadSize || 14}
            gameIsLive={schedule.gameIsLive}
            me={me}
            onAvatarTap={multiContextNav && onSwitcherOpen ? onSwitcherOpen : () => setShowProfile(true)}
          />
        </div>
      )}

      {/* 3 ── MY VIEW */}
      {activeTab === "my-view" && (
        <div style={{ padding:"0 16px 110px" }}>

          {/* Match Fitness discovery nudge — native only, self-hides when nothing to nudge */}
          <FitnessNudge
            matchHistory={matchHistory}
            onGoToResults={() => setActiveTab("history")}
            onOpenProfile={() => setShowProfile(true)}
          />

          {/* a — Response card (fixture/admins/price now live in the consolidated PageHeader) */}
          <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>

            <>
              <style>{`@keyframes ioo-name-glow{0%{text-shadow:-20px 0 8px transparent}40%{text-shadow:0px 0 12px rgba(232,160,32,0.6)}80%{text-shadow:20px 0 8px transparent}100%{text-shadow:none}}`}</style>

              {/* Header: subtitle row | name row | payment row */}
              {(() => {
                const price          = schedule.pricePerPlayer || 0;
                const owes           = me?.owes || 0;
                const effectiveDebt  = (ledgerBalance !== null && ledgerBalance > 0) ? ledgerBalance : owes;
                const paymentState = me
                  ? getPaymentState(me, cashPending)
                  : 'unpaid';
                const status = me?.status;

                // Ledger is the single source of truth for current outstanding
                // balance — same number Payments shows. Don't add `price` to it:
                // any unpaid pre-match ledger entry (match_id NULL) IS this
                // week's fee, so adding `price` would double-count.
                let amountText, amountColor = "var(--t2)";
                if (paymentState === 'paid') {
                  amountText = "Nothing owed 👊"; amountColor = "var(--green)";
                } else if (paymentState === 'claimed') {
                  amountText = "Awaiting confirmation"; amountColor = "var(--amber)";
                } else if (effectiveDebt > 0) {
                  amountText = `£${effectiveDebt} owed`;
                } else if (status === 'in') {
                  amountText = price > 0 ? `£${price} this week` : "Nothing owed 👊";
                  if (!price) amountColor = "var(--green)";
                } else {
                  amountText = "Nothing owed 👊"; amountColor = "var(--green)";
                }

                const tileStyle = (extra) => ({
                  flex:1, minHeight:28, borderRadius:"var(--r-button)",
                  fontSize:11, fontWeight:600, fontFamily:"var(--font-body)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"all 0.15s", cursor:"pointer", border:"none",
                  padding:"0 10px", whiteSpace:"nowrap",
                  ...extra,
                });

                const btns = [];

                // 460/PR#4: the primary action targets THIS week's game only. Older debt is
                // surfaced as a link to Payment History (per-week settle), killing the old
                // "pay this week vs clear the whole balance" duality.
                const thisWeekFee = (status === 'in') ? price : 0;
                const backlog     = Math.max(0, effectiveDebt - thisWeekFee);

                if (me?.selfPaid === true && me?.paid !== true && !cashPending) {
                  btns.push(
                    <span key="awaiting" style={{
                      flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                      color:"var(--amber)", borderRadius:"var(--r-button)",
                      padding:"0 10px", fontSize:12, fontWeight:400,
                      minHeight:28, fontFamily:"var(--font-body)",
                    }}>Claimed · awaiting confirmation</span>
                  );
                } else if (me?.paid === true) {
                  btns.push(
                    <span key="confirmed" style={{
                      flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                      background:"var(--green2)", border:"0.5px solid var(--greenb)",
                      color:"var(--green)", borderRadius:"var(--r-button)",
                      padding:"0 10px", fontSize:12, fontWeight:400,
                      minHeight:28, fontFamily:"var(--font-body)",
                    }}>✓ Paid</span>
                  );
                } else if (thisWeekFee > 0) {
                  // Playing this week with a fee due — primary claims THIS game via
                  // set_player_paid (a pending CLAIM; admin confirm settles just this week).
                  if (!cashPending) {
                    btns.push(
                      <button key="paid-cash" onClick={() => { if (needsSelfAuth) { promptSignIn(); return; } setCashPending(true); }}
                        style={tileStyle({ background:"var(--gold)", color:"var(--black)" })}>
                        I've paid (cash) · £{thisWeekFee}
                      </button>
                    );
                  } else {
                    btns.push(
                      <div key="confirm-cash" style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"stretch", gap:4 }}>
                        <button onClick={async () => {
                          setPayError(null);
                          try {
                            await handleCashPayment(me.token);
                            // pending CLAIM (mig 211) — keep owes; admin confirms to settle this week
                            setSquad(squad.map(p => p.id === myId ? { ...p, selfPaid:true } : p));
                            setCashPending(false);
                          } catch {
                            setPayError("Something went wrong — try again");
                          }
                        }} style={tileStyle({ background:"transparent", border:"0.5px solid var(--amber)", color:"var(--amber)" })}>
                          Confirm — you've paid?
                        </button>
                        {payError && <div style={{ fontSize:10, color:"var(--red)", textAlign:"center", fontWeight:300 }}>{payError}</div>}
                      </div>
                    );
                  }
                }
                // Not playing this week (pure backlog) or nothing owed → no primary button;
                // the backlog link below routes older debt to Payment History.

                return (
                  <div style={{ padding:"12px 16px 10px", borderBottom:"1px solid var(--b2)" }}>

                    {/* Row 1: subtitle | amount.
                        Pre-response prompt nudges toward the buttons; once
                        the player has tapped a status, the prompt collapses
                        to just the day context (no nag). */}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                      <div style={{ fontSize:10, fontWeight:300, letterSpacing:"0.1em",
                        textTransform:"uppercase", color:"var(--t2)" }}>
                        {!schedule.gameIsLive
                          ? "Sign-ups not open yet"
                          : (!me?.status || me?.status === "none")
                            ? `Are you in this ${gameDay}? Tap below ↓`
                            : `${gameDay}${schedule.kickoff ? ` · ${schedule.kickoff}` : ""}`}
                      </div>
                      <div style={{ fontSize:12, fontWeight:300, fontFamily:"var(--font-body)", color:amountColor }}>
                        {amountText}
                      </div>
                    </div>

                    {/* Row 2: name + pencil / edit form */}
                    {editingMyNick ? (
                      <div style={{ marginTop:2 }}>
                        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                          <input
                            value={myNick}
                            onChange={e => { setMyNick(e.target.value); setMyNickError(null); }}
                            onKeyDown={e => { if (e.key === "Enter") saveMyNick(); if (e.key === "Escape") setEditingMyNick(false); }}
                            placeholder="Add nickname"
                            autoFocus
                            style={{
                              flex:1, background:"var(--s2)",
                              border:`0.5px solid ${myNickError ? "var(--red)" : "var(--goldb)"}`,
                              borderRadius:6, padding:"5px 8px", fontSize:14, color:"var(--t1)",
                              fontFamily:"var(--font-body)", outline:"none", minWidth:0,
                            }}
                          />
                          <button onClick={saveMyNick} disabled={myNickSaving} style={{
                            background:"var(--gold)", color:"var(--bg)", border:"none",
                            borderRadius:6, padding:"5px 10px", fontSize:11, fontWeight:600,
                            cursor: myNickSaving ? "not-allowed" : "pointer",
                            opacity: myNickSaving ? 0.6 : 1, fontFamily:"var(--font-body)",
                          }}>
                            {myNickSaving ? "…" : "Save"}
                          </button>
                          <button onClick={() => { setEditingMyNick(false); setMyNickError(null); }} style={{
                            background:"transparent", border:"0.5px solid var(--border-subtle)",
                            borderRadius:6, padding:"5px 8px", fontSize:11, color:"var(--t2)",
                            cursor:"pointer", fontFamily:"var(--font-body)",
                          }}>✕</button>
                        </div>
                        {myNickError && (
                          <div style={{ fontSize:11, color:"var(--red)", marginTop:4, fontWeight:300 }}>{myNickError}</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ fontFamily:"var(--font-display)", fontSize:30,
                          lineHeight:1, color:"var(--t1)", letterSpacing:"0.04em",
                          animation:"ioo-name-glow 1.2s ease-in-out 2", animationFillMode:"forwards" }}>
                          {me?.nickname || me?.name}
                        </div>
                        <PencilSimple
                          size={14} weight="thin" color="var(--t2)"
                          style={{ cursor:"pointer", flexShrink:0, marginTop:4 }}
                          onClick={() => { setMyNick(me?.nickname || ""); setMyNickError(null); setEditingMyNick(true); }}
                        />
                      </div>
                    )}

                    {/* Bibs badge */}
                    {me?.id === lastMatchMeta?.bibHolder && (
                      <span style={{
                        display:"inline-block", marginTop:6,
                        background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                        color:"var(--amber)",
                        fontFamily:"var(--font-display)", fontSize:11, letterSpacing:"0.08em",
                        borderRadius:6, padding:"3px 8px",
                      }}>
                        YOU'VE GOT THE BIBS 👕
                      </span>
                    )}

                    {/* Row 3: payment buttons full width, side by side */}
                    {btns.length > 0 && (
                      <div style={{ display:"flex", gap:8, marginTop:8 }}>
                        {btns}
                      </div>
                    )}

                    {/* Backlog: unpaid weeks beyond this game → settle per-week in Payment History */}
                    {backlog > 0 && me?.paid !== true && (
                      <div
                        onClick={() => setShowProfile(true)}
                        style={{
                          marginTop:8, fontSize:11, fontWeight:300, lineHeight:1.4,
                          color:"var(--amber)", cursor:"pointer",
                        }}
                      >
                        You owe £{backlog} more from earlier — see Payment History →
                      </div>
                    )}

                  </div>
                );
              })()}

              {/* Locked row — gameIsLive only. Slides + fades after 5s
                  via the shared `hideConfirmation` timer (set in setStatus).
                  Wrapper stays mounted so the height/opacity animation
                  has something to play against. */}
              {schedule.gameIsLive && me?.status === "in" && (
                <div style={{
                  overflow: "hidden",
                  maxHeight:  hideConfirmation ? 0 : 60,
                  opacity:    hideConfirmation ? 0 : 1,
                  borderBottom: hideConfirmation ? "none" : "1px solid var(--b2)",
                  transition: "max-height 600ms ease, opacity 500ms ease 100ms, border-bottom 500ms ease",
                }}>
                  <div style={{
                    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                    padding:"8px 16px", fontSize:12, color:"var(--green)",
                    fontWeight:400, textAlign:"center",
                  }}>
                    🔒 Locked in. See you {gameDay}.
                  </div>
                </div>
              )}

              {/* Squad full notice */}
              {!me?.injured && isFull && me?.status !== "in" && (
                <div style={{ padding:"8px 16px", fontSize:12, fontWeight:600,
                  color:"var(--amber)", background:"var(--amber2)",
                  borderBottom:"1px solid var(--b2)" }}>
                  🔒 Squad is full — join the reserve list
                </div>
              )}

              {/* Cancelled banner */}
              {schedule.isCancelled && (
                <div style={{ margin:"10px 12px 0", background:"var(--red2)",
                  border:"0.5px solid var(--redb)", color:"var(--red)",
                  fontFamily:"var(--font-body)", fontWeight:400, fontSize:13,
                  padding:"8px 16px", borderRadius:8, textAlign:"center" }}>
                  ❌ This week's match is cancelled
                </div>
              )}

              {/* Sign-ups closed (game not live + not cancelled): instead of a
                  bare gap, tell the player exactly when the next game opens,
                  pulling the day + time live from the schedule (opens_day /
                  opens_time). Session 80. */}
              {!schedule.gameIsLive && !schedule.isCancelled && (() => {
                const d = schedule.opensDay;
                const t = schedule.opensTime; // "HH:MM"
                let timeLabel = t;
                if (t && /^\d{1,2}:\d{2}$/.test(t)) {
                  const [h, m] = t.split(":").map(Number);
                  const ap = h < 12 ? "am" : "pm";
                  const h12 = h % 12 === 0 ? 12 : h % 12;
                  timeLabel = m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, "0")}${ap}`;
                }
                const when = d && timeLabel ? `${d} at ${timeLabel}` : (d || timeLabel || "soon");
                return (
                  <div style={{ padding:"14px 12px", textAlign:"center",
                    border:"0.5px solid var(--border-subtle)", borderRadius:12,
                    background:"var(--s1)", color:"var(--t2)", fontSize:12,
                    fontWeight:300, fontFamily:"var(--font-body)", lineHeight:1.5 }}>
                    <div style={{ color:"var(--t1)", fontWeight:600, marginBottom:3 }}>
                      Sign-ups aren't open yet
                    </div>
                    Tap In/Out becomes available when the next game goes live —{" "}
                    <span style={{ color:"var(--gold)" }}>{when}</span>.
                  </div>
                );
              })()}

              {/* Status buttons 4-grid — gameIsLive or cancelled.
                  Pulses gold while player hasn't responded (status='none');
                  flashes green for 600ms on each tap. */}
              {(schedule.gameIsLive || schedule.isCancelled) && (
                <>
                <style>{`
                  @keyframes ioo-status-pulse {
                    0%,100% { box-shadow: 0 0 0 0 rgba(232,160,32,0.0); }
                    50%     { box-shadow: 0 0 16px 2px rgba(232,160,32,0.35); }
                  }
                  /* Flash colour is taken from the --flash-color custom
                     property set on the container — lets us match the
                     tapped status (in→green, out→red, maybe→amber,
                     reserve→purple) from a single keyframe. */
                  @keyframes ioo-status-flash {
                    0%   { box-shadow: 0 0 24px 6px var(--flash-color, rgba(61,220,106,0.85)); }
                    100% { box-shadow: 0 0 0 0   var(--flash-color, rgba(61,220,106,0)); }
                  }
                `}</style>
                {/* Status is step 1 of the My View spotlight tour (targets
                    data-gaffer-target="status-buttons"); the wrapper stays for
                    layout parity with the original. */}
                <FirstTimeHint>
                <div data-gaffer-target="status-buttons"
                  style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
                    gap:8, padding:"10px 12px",
                    borderRadius: 12,
                    "--flash-color":
                      lastTappedStatus === "out"     ? "rgba(255,64,64,0.85)"
                      : lastTappedStatus === "maybe"   ? "rgba(255,176,32,0.85)"
                      : lastTappedStatus === "reserve" ? "rgba(176,96,240,0.85)"
                      :                                  "rgba(61,220,106,0.85)",
                    animation:
                      justTapped
                        ? "ioo-status-flash 600ms ease-out"
                        : (schedule.gameIsLive && (!me?.status || me.status === "none"))
                          ? "ioo-status-pulse 2.4s ease-in-out infinite"
                          : "none",
                    ...(schedule.isCancelled && { opacity:0.4, pointerEvents:"none" }) }}>
                  <StatusButton
                    status="in" label="In"
                    icon={<Check size={18} weight="thin" />}
                    active={me?.status === "in"}
                    onClick={() => !me?.injured && !isFull && setStatus("in")}
                    disabled={me?.injured || (isFull && me?.status !== "in")}
                  />
                  <StatusButton
                    status="out" label="Out"
                    icon={<X size={18} weight="thin" />}
                    active={me?.status === "out"}
                    onClick={() => !me?.injured && setStatus("out")}
                    disabled={!!me?.injured}
                  />
                  <StatusButton
                    status="maybe" label="Maybe"
                    icon={<Question size={18} weight="thin" />}
                    active={me?.status === "maybe"}
                    onClick={() => !me?.injured && !isFull && setStatus("maybe")}
                    disabled={me?.injured || (isFull && me?.status !== "maybe")}
                  />
                  <StatusButton
                    status="reserve" label="Reserve"
                    icon={<ArrowDown size={18} weight="thin" />}
                    active={me?.status === "reserve"}
                    onClick={() => !me?.injured && setStatus("reserve")}
                    disabled={!!me?.injured}
                  />
                </div>
                </FirstTimeHint>
                </>
              )}

              {/* Note row — gameIsLive only */}
              {schedule.gameIsLive && (
                <div style={{ borderTop:"1px solid var(--b2)" }}>
                  {showNote ? (
                    <div style={{ padding:"10px 16px" }}>
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Might be 5 mins late…"
                        rows={2}
                        style={{ width:"100%", padding:"9px 12px", borderRadius:8,
                          border:"0.5px solid var(--border-subtle)", background:"var(--s3)",
                          color:"var(--t1)", fontFamily:"var(--font-body)", fontSize:13,
                          outline:"none", boxSizing:"border-box", resize:"none",
                          marginBottom:8 }}
                      />
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={saveNote} style={{
                          flex:1, padding:"9px 0", borderRadius:8, border:"none",
                          background:"var(--gold)", color:"var(--black)",
                          fontFamily:"var(--font-body)", fontSize:13, fontWeight:500, cursor:"pointer" }}>
                          Save Note
                        </button>
                        <button onClick={() => setShowNote(false)} style={{
                          flex:1, padding:"9px 0", borderRadius:8,
                          border:"0.5px solid var(--border-subtle)", background:"transparent",
                          color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:13, cursor:"pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => setShowNote(true)} style={{
                      padding:"9px 16px", display:"flex", alignItems:"center",
                      justifyContent:"space-between", cursor:"pointer" }}>
                      <span style={{ display:"flex", alignItems:"center", gap:6,
                        fontSize:12, color:"var(--t2)", fontWeight:400 }}>
                        <PencilSimple size={14} weight="thin" />
                        Add a note
                      </span>
                      <span style={{ fontSize:12, color:"var(--t2)", fontStyle:"italic", fontWeight:300 }}>
                        {me?.note || "e.g. \"Might be 5 mins late\""}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Status confirmation message — gameIsLive only, auto-hides after 5s; not shown for "in" (🔒 row covers it) */}
              {schedule.gameIsLive && me?.status && me.status !== "none" && me.status !== "in" && !hideConfirmation && (
                <div style={{ padding:"9px 16px", borderTop:"1px solid var(--b2)",
                  fontSize:12, fontWeight:400, color:"var(--t2)", fontStyle:"italic" }}>
                  {me.status === "maybe"
                    ? "🤞 Got it — we'll keep a spot open"
                    : me.status === "reserve"
                      ? "🟣 On the reserve list — we'll let you know if a spot opens"
                      : "👍 No worries, we'll find cover"}
                </div>
              )}

              {/* Push opt-in moved to a modal fired on the "in" tap (see
                  showPushModal overlay near the POTM modal). The always-on card
                  was replaced because it sat in a busy screen and got ignored. */}
              {/* Guest payment rows — one per active guest, inside card, gold-tinted bg */}
              {myGuests.map(g => {
                const gps      = getGuestPaymentState(g, guestCashPending.has(g.id));
                const price    = schedule.pricePerPlayer || 0;
                const payMode  = 'both';
                const gName    = g.name.charAt(0).toUpperCase() + g.name.slice(1);
                const ts = (extra) => ({
                  height:32, borderRadius:"var(--r-pill)",
                  fontSize:11, fontWeight:600, fontFamily:"var(--font-body)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"all 0.15s", cursor:"pointer", border:"none",
                  padding:"0 12px", whiteSpace:"nowrap",
                  ...extra,
                });

                let right;
                if (gps === 'paid_stripe') {
                  right = <span style={{ fontSize:11, color:"var(--green)", fontWeight:400 }}>✓ Stripe</span>;
                } else if (gps === 'paid_cash') {
                  const label = g.paidBy === 'host'  ? "✓ You paid"
                              : g.paidBy === 'admin' ? "✓ Admin confirmed"
                              : `✓ ${gName} paid`;
                  right = <span style={{ fontSize:11, color:"var(--green)", fontWeight:400 }}>{label}</span>;
                } else if (gps === 'cash_pending') {
                  right = (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                      <button onClick={async () => {
                        setPayError(null);
                        try {
                          await handleGuestCashPayment(me?.token, g.id, 'host');
                          setSquad(sq => sq.map(p => p.id === g.id ? { ...p, selfPaid:true, paidBy:'host' } : p));
                          setGuestCashPending(prev => { const s = new Set(prev); s.delete(g.id); return s; });
                        } catch {
                          setPayError("Something went wrong — try again");
                        }
                      }} style={ts({ background:"transparent", border:"0.5px solid var(--amber)", color:"var(--amber)" })}>
                        Confirm — You've Paid?
                      </button>
                      {payError && <div style={{ fontSize:10, color:"var(--red)", textAlign:"right", fontWeight:300 }}>{payError}</div>}
                    </div>
                  );
                } else if (g.selfPaid) {
                  right = <span style={{ fontSize:11, color:"var(--t2)", fontWeight:300 }}>Paid</span>;
                } else {
                  right = (
                    <div style={{ display:"flex", flexDirection:"row", gap:6, alignItems:"center" }}>
                      {payMode !== 'cash_only' && (
                        <button disabled style={ts({ background:"transparent", border:"1px solid rgba(255,255,255,0.25)", color:"var(--t2)", opacity:0.4, cursor:"not-allowed" })}>
                          Transfer £{price}
                        </button>
                      )}
                      {payMode !== 'stripe_only' && (
                        <button onClick={() => setGuestCashPending(prev => new Set([...prev, g.id]))} style={ts({ background:"var(--gold)", color:"var(--black)" })}>
                          Paid
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div key={g.id} style={{
                    padding:"10px 16px",
                    borderTop:"0.5px solid var(--b2)",
                    background:"rgba(232,160,32,0.04)",
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                  }}>
                    <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>👤 {gName}</div>
                    {right}
                  </div>
                );
              })}
            </>
          </div>

          {/* c — Quick actions row */}
          {!schedule.isCancelled && <div style={{ display:"flex", gap:8, marginBottom:8 }}>

            {/* Plus One — always visible */}
            {schedule.gameIsLive && (
              myGuests.length > 0 ? (
                /* Guest card — lists all active guests + Add another CTA */
                <div style={{ flex:1, padding:"11px 12px", background:"var(--s1)",
                  border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                  display:"flex", flexDirection:"column", gap:8 }}>
                  {myGuests.map(g => (
                    <div key={g.id} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <UserPlus size={20} weight="thin" color="var(--t1)" style={{ flexShrink:0 }} />
                          <div>
                            <div style={{ fontSize:13, fontWeight:500, color:"var(--t1)" }}>{g.name}</div>
                            <div style={{ fontSize:11, color: g.pendingApproval ? "var(--amber)" : "var(--t2)", fontWeight:300 }}>
                              {g.pendingApproval ? "⏳ Waiting for admin approval" : "your +1"}
                            </div>
                          </div>
                        </div>
                        {canRemoveGuest && (
                          <button onClick={() => removeMyGuest(g.id)} disabled={removingGuest} style={{
                            padding:"5px 10px", borderRadius:6,
                            border:"0.5px solid var(--border-subtle)", background:"var(--s3)",
                            color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:11,
                            cursor:"pointer", flexShrink:0 }}>
                            {removingGuest ? "..." : g.pendingApproval ? "Cancel" : "Remove"}
                          </button>
                        )}
                      </div>
                      {!g.pendingApproval && (
                        <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300 }}>
                          {g.selfPaid ? "Paid" : "You're covering payment"}
                        </div>
                      )}
                    </div>
                  ))}
                  {!showPlusOneForm && (
                    <button onClick={() => { setShowPlusOneForm(true); onMidFlowChange?.(true); }}
                      style={{ background:"none", border:"none", color:"var(--green)", fontFamily:"var(--font-body)",
                        fontSize:11, fontWeight:600, cursor:"pointer", textAlign:"left", padding:"2px 0 0" }}>
                      + Add another
                    </button>
                  )}
                </div>
              ) : !showPlusOneForm ? (
                <button
                  data-gaffer-target="add-plus-one"
                  onClick={() => { setShowPlusOneForm(true); onMidFlowChange?.(true); }}
                  style={{ flex:1, padding:"11px 12px", background:"var(--s1)",
                    border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                    display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                  <UserPlus size={20} weight="thin" color="var(--t1)" style={{ flexShrink:0 }} />
                  <div style={{ textAlign:"left" }}>
                    <div style={{ fontSize:13, fontWeight:400, color:"var(--t1)" }}>Plus One</div>
                    <div style={{ fontSize:11, color:"var(--t2)", marginTop:1, fontWeight:300 }}>Bring a guest</div>
                  </div>
                </button>
              ) : null
            )}

            {/* Injured tile */}
            {me?.injured ? (
              <button data-tour="injured-toggle" onClick={toggleInjury} style={{
                flex:1, padding:"11px 12px",
                background:"var(--red2)", border:"0.5px solid var(--redb)",
                borderRadius:"var(--rs)", boxShadow:"0 0 10px rgba(255,64,64,0.15)",
                display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              }}>
                <Bandaids size={20} weight="thin" color="var(--red)" style={{ flexShrink:0 }} />
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontSize:13, fontWeight:600, color:"var(--red)" }}>Injured</div>
                  <div style={{ fontSize:11, color:"var(--t2)", marginTop:1, fontWeight:300 }}>Tap to clear</div>
                </div>
              </button>
            ) : (
              <button data-tour="injured-toggle" onClick={toggleInjury} style={{
                flex:1, padding:"11px 12px", background:"var(--s1)",
                border:"0.5px solid var(--border-subtle)",
                borderRadius:"var(--rs)",
                display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              }}>
                <Bandaids size={20} weight="thin" color="var(--t1)" style={{ flexShrink:0 }} />
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontSize:13, fontWeight:400, color:"var(--t1)" }}>Injured?</div>
                  <div style={{ fontSize:11, color:"var(--t2)", marginTop:1, fontWeight:300 }}>Mark yourself out</div>
                </div>
              </button>
            )}
          </div>}

          {/* Plus One form (expanded) */}
          {!schedule.isCancelled && showPlusOneForm && (
            <div style={{ padding:"14px 16px", borderRadius:"var(--r)",
              background:"var(--s1)", border:"0.5px solid var(--border-subtle)", marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--t1)", marginBottom:12 }}>
                ➕ Add a plus one
              </div>
              {pastGuests.length > 0 && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:400, color:"var(--t2)", marginBottom:8 }}>
                    Bringing someone back?
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {pastGuests.map(g => (
                      <button key={g.id} onClick={() => reactivateGuest(g.id)} disabled={addingGuest}
                        style={{ padding:"7px 12px", borderRadius:16,
                          border:"0.5px solid var(--amberb)", background:"var(--amber2)",
                          color:"var(--amber)", fontFamily:"var(--font-body)", fontSize:12,
                          fontWeight:600, cursor: addingGuest ? "not-allowed" : "pointer" }}>
                        {g.name}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize:11, fontWeight:300, color:"var(--t2)", margin:"10px 0 2px" }}>
                    or add someone new
                  </div>
                </div>
              )}
              <input
                value={guestName}
                onChange={e => handleGuestNameChange(e.target.value)}
                placeholder="Guest's name..."
                style={{ width:"100%", padding:"11px 13px", borderRadius:8,
                  marginBottom: pickerPlayer ? 8 : 12,
                  border:"0.5px solid var(--border-subtle)", background:"var(--s3)",
                  color:"var(--t1)", fontFamily:"var(--font-body)", fontSize:14,
                  outline:"none", boxSizing:"border-box" }}
              />
              {pickerPlayer && (
                <div style={{ padding:"10px 12px", borderRadius:8, marginBottom:12,
                  background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                  display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                  <span style={{ fontSize:12, color:"var(--amber)" }}>
                    Is this {pickerPlayer.name} (already on the team)?
                  </span>
                  <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                    <button onClick={confirmExistingPlayer} style={{
                      padding:"5px 11px", borderRadius:4,
                      border:"0.5px solid var(--greenb)", background:"var(--green2)",
                      color:"var(--green)", fontFamily:"var(--font-body)",
                      fontSize:11, fontWeight:700, cursor:"pointer" }}>
                      Yes
                    </button>
                    <button onClick={() => setPickerPlayer(null)} style={{
                      padding:"5px 11px", borderRadius:4,
                      border:"0.5px solid var(--border-subtle)", background:"transparent",
                      color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:11, cursor:"pointer" }}>
                      No
                    </button>
                  </div>
                </div>
              )}
              {/* Payment toggle */}
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                {[{ label:`${me?.name} pays`, value: false }, { label:"They pay", value: true }].map(opt => (
                  <button key={String(opt.value)} onClick={() => setGuestSelfPaid(opt.value)} style={{
                    flex:1, padding:"9px 0", borderRadius:8,
                    border: guestSelfPaid === opt.value ? "0.5px solid var(--amberb)" : "0.5px solid var(--border-subtle)",
                    background: guestSelfPaid === opt.value ? "var(--amber2)" : "transparent",
                    color: guestSelfPaid === opt.value ? "var(--amber)" : "var(--t2)",
                    fontFamily:"var(--font-body)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {guestAddError && (
                <div style={{ fontSize:12, color:"var(--red)", fontWeight:300, marginBottom:8 }}>{guestAddError}</div>
              )}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={submitGuest} disabled={!guestName.trim() || addingGuest} style={{
                  flex:1, padding:"10px 0", borderRadius:8, border:"none",
                  background: guestName.trim() ? "var(--green)" : "var(--s3)",
                  color: guestName.trim() ? "#000" : "var(--t2)",
                  fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
                  cursor: guestName.trim() && !addingGuest ? "pointer" : "not-allowed" }}>
                  {addingGuest ? "Adding..." : "Add Plus One"}
                </button>
                <button onClick={() => {
                  setShowPlusOneForm(false); setGuestName(""); setPickerPlayer(null);
                  onMidFlowChange?.(false);
                }} style={{
                  flex:1, padding:"10px 0", borderRadius:8,
                  border:"0.5px solid var(--border-subtle)", background:"transparent",
                  color:"var(--t2)", fontFamily:"var(--font-body)", fontSize:13, cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* e — Live board */}
          <>
            <div style={{ display:"flex", alignItems:"center", marginBottom:7, marginTop:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:7, fontSize:10, fontWeight:400,
                letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)" }}>
                <span style={{ width:6, height:6, background:"var(--green)", borderRadius:"50%",
                  animation:"ioo-blink 2s infinite", boxShadow:"0 0 8px var(--green)",
                  display:"inline-block", flexShrink:0 }} />
                Live Board
              </div>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:8 }}>

              {/* TEAMS TILE (when confirmed) or IN TILE */}
              {teamsSet ? (
                <div style={{
                  borderRadius:"var(--rs)", overflow:"hidden",
                  border:"0.5px solid rgba(61,220,106,0.35)",
                  background:"linear-gradient(135deg,rgba(61,220,106,0.22) 0%,rgba(61,220,106,0.06) 45%,rgba(10,10,8,0.6) 100%)",
                  boxShadow:"0 0 18px rgba(61,220,106,0.1),inset 0 0 30px rgba(61,220,106,0.05)",
                }}>
                  {/* Header row */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", borderBottom:"0.5px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ padding:"8px 14px", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#60A0FF", display:"flex", alignItems:"center", gap:6, borderRight:"0.5px solid rgba(255,255,255,0.06)" }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:"#60A0FF", boxShadow:"0 0 6px rgba(96,160,255,0.5)", flexShrink:0 }} />
                      Team A · {teamAPlayers.length}
                    </div>
                    <div style={{ padding:"8px 14px", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#FF6060", display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:"#FF6060", boxShadow:"0 0 6px rgba(255,96,96,0.5)", flexShrink:0 }} />
                      Team B · {teamBPlayers.length}
                    </div>
                  </div>
                  {/* Body — two columns */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr" }}>
                    {[
                      ["A", teamAPlayers, "#60A0FF", "rgba(96,160,255,0.15)", "rgba(96,160,255,0.4)"],
                      ["B", teamBPlayers, "#FF6060", "rgba(255,96,96,0.15)",  "rgba(255,96,96,0.4)"],
                    ].map(([team, players, color, avBg, avBorder], colIdx) => (
                      <div key={team} style={{ borderRight: colIdx === 0 ? "0.5px solid rgba(255,255,255,0.06)" : "none", paddingTop:8, paddingBottom:8 }}>
                        {players.map(p => {
                          const isMe    = p.id === myId;
                          const form    = (formMap[p.id] || []).slice(0, 5).reverse();
                          const host    = p.isGuest ? squad.find(h => h.id === p.guestOf) : null;
                          const motmValue = lastMatchMeta?.motm;
                          const isMotm  = !!motmValue && (
                            motmValue === p.id ||
                            motmValue === (p.nickname || p.name)
                          );
                          const hasBibs = lastMatchMeta?.bibHolder === p.id;
                          const parts   = ((p.nickname || p.name) || "").trim().split(/\s+/);
                          const ini     = parts.length >= 2
                            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                            : ((p.nickname || p.name) || "?").slice(0, 2).toUpperCase();
                          return (
                            <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 14px", background: isMe ? "rgba(232,160,32,0.06)" : "transparent" }}>
                              <div style={{
                                position:"relative",
                                width:28, height:28, borderRadius:"50%",
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize:9, fontWeight:600, flexShrink:0,
                                background: isMe ? "var(--gold2)" : avBg,
                                border:     `0.5px solid ${isMe ? "var(--goldb)" : avBorder}`,
                                color:      isMe ? "var(--gold)" : color,
                                boxShadow:  isMe ? "0 0 8px rgba(232,160,32,0.2)" : "none",
                              }}>
                                {ini}
                                {hasBibs && (
                                  <div style={{
                                    position:"absolute", bottom:0, right:0,
                                    width:10, height:10, borderRadius:"50%",
                                    background:"var(--amber)",
                                  }}/>
                                )}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                                  <span style={{ fontSize:12, color:"var(--t1)", fontWeight:400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flexShrink:1 }}>
                                    {p.nickname || p.name}{isMotm ? " 🏆" : ""}
                                  </span>
                                  {form.length > 0 && (
                                    <div style={{ display:"flex", gap:3, flexShrink:0 }}>
                                      {form.map((r, i) => (
                                        <span key={i} style={{ width:7, height:7, borderRadius:"50%", display:"inline-block",
                                          background: r === "w" ? "var(--green)" : r === "l" ? "var(--red)" : "var(--amber)" }} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {hasBibs && <div style={{ fontSize:9, color:"var(--amber)", fontWeight:300, marginTop:1 }}>{resolveBibHolder(lastMatchMeta?.bibHolder, squad)} has bibs 👕</div>}
                                {host   && <div style={{ fontSize:9, color:"var(--gold)",  fontWeight:300, marginTop:1 }}>+1 {host.nickname || host.name}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Tile colour="green" icon="✅" label="In" count={inPlayers.length} shareUrl={shareUrl}>
                  {inPlayers.map(p => (
                    <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="green" hasGuest={p.isGuest === true} isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} hasMotm={isLastMotm(p)} onClick={adminTapFor(p)} />
                  ))}
                </Tile>
              )}

              {/* RESERVE */}
              {reservePlayers.length > 0 && (
                <div data-gaffer-target="reserve-list">
                  <Tile colour="purple" icon="🟣" label="Reserve" count={reservePlayers.length}>
                    {reservePlayers.map((p, i) => (
                      <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="purple" reserveIndex={i + 1} isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} hasMotm={isLastMotm(p)} onClick={adminTapFor(p)} />
                    ))}
                  </Tile>
                </div>
              )}

              {/* MAYBE */}
              {maybePlayers.length > 0 && (
                <Tile colour="amber" icon="❓" label="Maybe" count={maybePlayers.length}>
                  {maybePlayers.map(p => (
                    <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="amber" isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} hasMotm={isLastMotm(p)} onClick={adminTapFor(p)} />
                  ))}
                </Tile>
              )}

              {/* OUT */}
              {outPlayers.length > 0 && (
                <Tile colour="red" icon="❌" label="Out" count={outPlayers.length}>
                  {outPlayers.map(p => (
                    <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="red" isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} hasMotm={isLastMotm(p)} onClick={adminTapFor(p)} />
                  ))}
                </Tile>
              )}
            </div>

            {/* No response row */}
            {noRespPlayers.length > 0 && (
              <>
                <div
                  onClick={() => setShowNoResp(s => !s)}
                  style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
                    borderRadius:"var(--rs)", padding:"10px 14px",
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    marginBottom:8, cursor:"pointer" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8,
                    fontSize:12, color:"var(--t2)", fontWeight:400 }}>
                    <Hourglass size={16} weight="thin" />
                    No response · {noRespPlayers.length}
                  </div>
                  <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300 }}>
                    {showNoResp ? "Tap to hide ↑" : "Tap to view ↓"}
                  </div>
                </div>
                {showNoResp && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"5px 9px",
                    padding:"0 4px", marginBottom:8 }}>
                    {noRespPlayers.map(p => (
                      <Avatar key={p.id} player={p} isMe={p.id === myId} tileColour="green" isInjured={p.injured === true} hasBibs={lastMatchMeta?.bibHolder === p.id} hasMotm={isLastMotm(p)} onClick={adminTapFor(p)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>


          <MySquads
            currentTeamId={teamId}
            currentToken={myId && squad.find(p => p.id === myId)?.token}
            userId={authUserId || me?.userId || null}
          />

          <CompetitionStandingsCard
            playerToken={myId && squad.find(p => p.id === myId)?.token}
            currentTeamId={teamId}
          />

          <CompetitionFixturesCard
            playerToken={playerToken}
            currentTeamId={teamId}
            fixtures={compFixtures}
          />

        </div>
      )}

      {/* STATS tab */}
      {activeTab === "stats" && (
        <StatsView teamId={teamId} squad={squad} bibHistory={bibHistory} matchHistory={matchHistory} settings={settings} schedule={schedule} myId={myId} stats={stats} adminToken={adminToken} playerToken={playerToken} />
      )}

      {/* HISTORY tab */}
      {activeTab === "history" && (
        <HistoryView matchHistory={matchHistory} players={squad} settings={settings} schedule={schedule} />
      )}

      {/* MY IO tab */}
      {activeTab === "my-io" && (
        <MyIOView player={me} teamId={teamId} teamName={settings?.groupName} stats={stats} matchHistory={matchHistory} />
      )}

      {/* Context-aware guided tour for the current tab (gated by the per-team
          flag; no-ops when no tour is registered for this context+tab). */}
      <Tour
        tourKey={tourKeyFor(context?.type, activeTab === "my-view" ? "myview" : activeTab === "stats" ? "stats" : null)}
        enabled={multiContextNav}
        active={activeTab === "my-view" || activeTab === "stats"}
      />

      {/* 4 ── NAVBAR */}
      <NavBar activeTab={activeTab} onTabChange={setActiveTab} onAdminClick={isAdmin ? onGoAdmin : undefined} />
      <AuthGateModal {...gateProps} />
    </div>
    )}
    </AnimatePresence>
  );
}
