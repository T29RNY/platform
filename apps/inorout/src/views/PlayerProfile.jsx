import { useState, useEffect } from "react";
import {
  ArrowLeft, CaretRight, ChartLineUp, Bandaids, Receipt,
  SignOut, Trash, X as XIcon,
  PencilSimple, Link as LinkIcon, ArrowsClockwise, FirstAid, BellSimple, Lightning,
  Plus, Question, ArrowsLeftRight,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import {
  getMyPaymentHistory, getMyInjuries,
  leaveSquad, deleteMyAccount,
  setPlayerNickname, resetPlayerToken,
  insertPlayerInjury, clearPlayerInjury, getPlayerInjuries,
  deletePlayer, getMyContact, setPlayerContact,
  adminSetPlayerStatus, signOut, supabase,
  getMyShareMatchFitness, setShareMatchFitness,
  getMyUseFitnessForBalancing, setUseFitnessForBalancing,
} from "@platform/core/storage/supabase.js";
import { adminGetPlayerLedger, toggleViceCaptain, claimLedgerPayment } from "@platform/core";
import FirstTimeHint from "../components/FirstTimeHint.jsx";
import AuthGateModal from "../components/AuthGateModal.jsx";
import useRequireAuth from "../hooks/useRequireAuth.js";
import { registerNativePush } from "../native/native-push.js";
import { App as CapApp } from "@capacitor/app";
import { isHealthAvailable } from "../native/native-health.js";

// ── helpers ─────────────────────────────────────────────────────────────────

// Diagnostic footer (support tool): App Store binary version+build (via Capacitor App.getInfo —
// native only; blank on web), the web-bundle build stamp (baked at build time in vite.config),
// and whether Apple Health is switched on for this device. Lets support tell at a glance whether
// a player is on a stale cached bundle / old app version.
function VersionFooter() {
  const [appInfo, setAppInfo] = useState(null);
  useEffect(() => { CapApp.getInfo().then(setAppInfo).catch(() => {}); }, []);
  const web = `${import.meta.env.VITE_BUILD_DATE || "dev"} · ${import.meta.env.VITE_BUILD_SHA || "dev"}`;
  return (
    <div style={{ textAlign: "center", padding: "28px 0 10px", fontSize: 11, lineHeight: 1.7, color: "var(--t2)", fontFamily: "var(--font-body)" }}>
      <div>In or Out{appInfo ? ` ${appInfo.version} (${appInfo.build})` : ""} · web {web}</div>
      <div style={{ opacity: 0.8 }}>Apple Health: {isHealthAvailable() ? "available" : "not available"}</div>
    </div>
  );
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })
  : "—";

const TYPE_LABEL = {
  game_fee: "Game fee", guest_fee: "Guest fee",
  debt_payment: "Debt payment", waiver: "Waived", refund: "Refund",
  cancelled: "Match cancelled",
};

const STATUS_STYLE = {
  paid:      { bg:"var(--green2)",         border:"var(--greenb)",         color:"var(--green)"  },
  unpaid:    { bg:"var(--amber2)",         border:"var(--amberb)",         color:"var(--amber)"  },
  claimed:   { bg:"var(--amber2)",         border:"var(--amberb)",         color:"var(--amber)"  },
  waived:    { bg:"var(--purple2)",        border:"var(--purpleb)",        color:"var(--purple)" },
  refunded:  { bg:"rgba(96,160,255,0.12)", border:"rgba(96,160,255,0.3)", color:"#60A0FF"       },
  disputed:  { bg:"var(--red2)",           border:"var(--redb)",           color:"var(--red)"    },
  cancelled: { bg:"var(--s3)",             border:"var(--t2)",             color:"var(--t2)"     },
};

// ── inline keyframes ────────────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("pp-styles")) {
  const el = document.createElement("style");
  el.id = "pp-styles";
  el.textContent = `
    @keyframes pp-fade-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
    .pp-section { animation: pp-fade-in 280ms ease both; }
  `;
  document.head.appendChild(el);
}

// ── Section wrapper ─────────────────────────────────────────────────────────

function Section({ icon, label, count, defaultOpen = false, onExpand, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const firstOpenRef = useState({ done: defaultOpen });

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !firstOpenRef[0].done) {
      firstOpenRef[0].done = true;
      await onExpand?.();
    }
  };

  return (
    <div className="pp-section" style={{
      background:"rgba(255,255,255,0.03)",
      backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
      border:"0.5px solid var(--border-subtle)",
      borderRadius:"var(--r)", overflow:"hidden", marginBottom:10,
    }}>
      <div onClick={toggle} style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"14px 16px", cursor:"pointer",
        WebkitTapHighlightColor:"transparent",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {icon}
          <span style={{
            fontFamily:"var(--font-display)", fontSize:13,
            letterSpacing:"0.1em", color:"var(--t1)",
          }}>{label}</span>
          {count != null && (
            <span style={{
              fontSize:11, color:"var(--t2)", fontWeight:300,
              padding:"1px 8px", borderRadius:"var(--r-pill)",
              background:"rgba(255,255,255,0.06)",
            }}>{count}</span>
          )}
        </div>
        <CaretRight size={16} weight="thin" color="var(--t2)"
          style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}/>
      </div>
      {open && (
        <div style={{ borderTop:"0.5px solid var(--b2)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Stats body (always uses props — no async) ───────────────────────────────

function StatsBody({ me }) {
  const cells = [
    { label:"Played", val: me?.attended    || 0 },
    { label:"Goals",  val: me?.goals       || 0 },
    { label:"POTM",   val: me?.motm        || 0 },
    { label:"Bibs",   val: me?.bibCount    || 0 },
    { label:"Late",   val: me?.lateDropouts|| 0 },
  ];
  return (
    <div style={{ display:"flex" }}>
      {cells.map(({ label, val }, i) => (
        <div key={label} style={{
          flex:1, textAlign:"center", padding:"14px 0",
          borderRight: i < cells.length - 1 ? "0.5px solid var(--b2)" : "none",
        }}>
          <div style={{
            fontFamily:"var(--font-display)", fontSize:26,
            lineHeight:1, color:"var(--t1)",
          }}>{val}</div>
          <div style={{
            fontSize:9, color:"var(--t2)", fontWeight:300,
            letterSpacing:"0.06em", textTransform:"uppercase", marginTop:3,
          }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Payment history body ────────────────────────────────────────────────────

function PaymentHistoryBody({ entries, loading, error, onClaim, claimingId, canClaim }) {
  if (loading) {
    return <div style={{ padding:"14px 16px", fontSize:12, color:"var(--t2)", fontWeight:300 }}>Loading…</div>;
  }
  if (error) {
    return <div style={{ padding:"14px 16px", fontSize:12, color:"var(--red)", fontWeight:300 }}>Couldn't load payment history</div>;
  }
  if (!entries?.length) {
    return <div style={{ padding:"14px 16px", fontSize:12, color:"var(--t2)", fontWeight:300 }}>No payment history yet</div>;
  }
  return entries.map((entry, i) => {
    // A row is a pending CLAIM when it's still unpaid but carries a claim marker.
    const isClaimed = entry.status === "unpaid" && !!entry.claimedAt;
    // Only the player's own UNPAID, unclaimed match fees are tappable. paid / waived /
    // cancelled / refunded / disputed / guest_fee rows are inert; admin view never claims.
    const tappable  = !!canClaim && entry.type === "game_fee"
                      && entry.status === "unpaid" && !entry.claimedAt;
    const busy      = claimingId === entry.id;
    const ss        = STATUS_STYLE[isClaimed ? "claimed" : entry.status] || STATUS_STYLE.unpaid;
    return (
      <div
        key={entry.id || i}
        onClick={tappable && !busy ? () => onClaim(entry.id) : undefined}
        style={{
          padding:"10px 16px", display:"flex", alignItems:"center",
          justifyContent:"space-between", gap:8,
          borderTop: i === 0 ? "none" : "0.5px solid var(--b2)",
          cursor: tappable && !busy ? "pointer" : "default",
          opacity: busy ? 0.55 : 1,
          transition:"opacity 120ms ease",
        }}
      >
        <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
          <div style={{ fontSize:12, color:"var(--t1)", fontWeight:400 }}>
            {TYPE_LABEL[entry.type] || entry.type}
          </div>
          <div style={{ fontSize:10, color: tappable ? "var(--amber)" : "var(--t2)", fontWeight:300 }}>
            {isClaimed
              ? "Awaiting confirmation"
              : tappable
                ? (busy ? "Marking…" : "Tap to mark as paid")
                : <>{fmtDate(entry.createdAt)}{entry.method && <span style={{ opacity:0.6 }}> · {entry.method}</span>}</>}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{
            fontSize:10, fontWeight:600, padding:"2px 7px",
            borderRadius:"var(--r-pill)",
            border:`0.5px solid ${ss.border}`,
            background:ss.bg, color:ss.color, letterSpacing:"0.04em",
          }}>
            {isClaimed ? "CLAIMED" : (entry.status || "").toUpperCase()}
          </span>
          <span style={{ fontSize:12, fontWeight:600, color:"var(--t1)", minWidth:30, textAlign:"right" }}>
            £{Number(entry.amount || 0).toFixed(0)}
          </span>
        </div>
      </div>
    );
  });
}

// ── Injuries body ───────────────────────────────────────────────────────────

function InjuriesBody({ injuries, loading, error, currentlyInjured }) {
  if (loading) {
    return <div style={{ padding:"14px 16px", fontSize:12, color:"var(--t2)", fontWeight:300 }}>Loading…</div>;
  }
  if (error) {
    return <div style={{ padding:"14px 16px", fontSize:12, color:"var(--red)", fontWeight:300 }}>Couldn't load injury history</div>;
  }
  if (!injuries?.length) {
    return (
      <div style={{ padding:"14px 16px", fontSize:12, color:"var(--t2)", fontWeight:300 }}>
        {currentlyInjured ? "Currently marked injured — no history yet" : "No injuries recorded"}
      </div>
    );
  }
  return injuries.map(inj => {
    const from = new Date(inj.injured_at);
    const to   = inj.cleared_at ? new Date(inj.cleared_at) : new Date();
    const days = Math.max(0, Math.round((to - from) / 86400000));
    return (
      <div key={inj.id} style={{ padding:"10px 16px", borderTop:"0.5px solid var(--b2)" }}>
        <div style={{ fontSize:12, color:"var(--t1)" }}>
          {fmtDate(inj.injured_at)}
          {inj.cleared_at
            ? ` → ${new Date(inj.cleared_at).toLocaleDateString("en-GB", { day:"numeric", month:"short" })}`
            : " → ongoing"}
        </div>
        <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:2 }}>
          {days} day{days !== 1 ? "s" : ""}
          {inj.marked_by ? ` · marked by ${inj.marked_by}` : ""}
        </div>
      </div>
    );
  });
}

// ── main ────────────────────────────────────────────────────────────────────

function exitToHome() {
  try {
    localStorage.removeItem("ioo_last_visited");
    localStorage.removeItem("ioo_redirect_to");
  } catch {}
  window.location.href = "/";
}

export default function PlayerProfile({
  me, settings, onBack,
  // onSwitchContext: opens the unified ContextSwitcher (other squads, clubs,
  // family, officiating, operator hub via Feed). When provided, the profile
  // shows a non-destructive "Switch team or venue" escape it otherwise lacked.
  onSwitchContext = null,
  // Admin-mode props (ignored in player mode)
  isAdminView = false, adminToken = null, setSquad = null,
  viewer = null, isViceCaptain = false,
}) {
  const [payHist,        setPayHist]        = useState(null);
  const [payHistLoading, setPayHistLoading] = useState(false);
  const [payHistError,   setPayHistError]   = useState(false);

  const [injuries,        setInjuries]        = useState(null);
  const [injuriesLoading, setInjuriesLoading] = useState(false);
  const [injuriesError,   setInjuriesError]   = useState(false);

  // Notification preference (Phase 9 contact-capture) — player-self, keyed by me.token.
  const [contact,        setContact]        = useState(null);
  const [contactPhone,   setContactPhone]   = useState("");
  const [contactChannel, setContactChannel] = useState("push");
  const [contactLoading, setContactLoading] = useState(false);
  const [contactSaving,  setContactSaving]  = useState(false);
  const [contactSaved,   setContactSaved]   = useState(false);
  const [contactError,   setContactError]   = useState(null);
  const [pushMsg,        setPushMsg]        = useState(null); // native push register feedback

  // Leave-squad — two-tap confirm, inline error
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  const [leaving,         setLeaving]         = useState(false);
  const [leaveError,      setLeaveError]      = useState(null);

  // Delete-account — modal + typed DELETE check, error surface
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleteText,    setDeleteText]    = useState("");
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState(null);

  // Auth gate — delete account requires a real auth session (server-side
  // RPC uses auth.uid()). In the home-screen app the user is almost always
  // unauthed; pop the email-OTP modal first, then open the typed-DELETE flow.
  const { requireAuth, gateProps } = useRequireAuth();

  // Sign out — only shown when there's a real auth session. A /p/<token> link
  // can be viewed anonymously, where "sign out" would be meaningless.
  const [isAuthed, setIsAuthed] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setIsAuthed(!!data?.session?.user); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const handleSignOut = async () => {
    try { await signOut(); } catch (e) { console.error("sign out failed", e); }
    window.location.replace("/signin");
  };

  // Match-fitness teammate-sharing consent (mig 457). Loaded lazily when the section expands;
  // written globally across the user's player rows. Default OFF; degrades to OFF if the read fails.
  const [shareFitness, setShareFitness] = useState(null); // null = unloaded
  const [shareSaving,  setShareSaving]  = useState(false);
  const [shareError,   setShareError]   = useState(null);
  const loadShareFitness = async () => {
    if (shareFitness !== null) return;
    try {
      const res = await getMyShareMatchFitness();
      setShareFitness(!!res?.share_match_fitness);
    } catch (e) {
      console.error("[profile] load share consent failed", e);
      setShareFitness(false);
    }
  };
  const toggleShareFitness = async () => {
    if (shareSaving || shareFitness === null) return;
    const next = !shareFitness;
    setShareFitness(next);   // optimistic
    setShareSaving(true);
    setShareError(null);
    try {
      await setShareMatchFitness(next);
    } catch (e) {
      console.error("[profile] save share consent failed", e);
      setShareFitness(!next); // revert
      setShareError("Couldn't save — try again.");
    } finally {
      setShareSaving(false);
    }
  };

  // Fitness-in-balancing consent (mig 502) — a SEPARATE default-OFF switch (new DPIA Purpose 3)
  // permitting match fitness to be used as an admin-only team-balancing signal. Same global-consent
  // shape as the sharing toggle above; loaded lazily when the MATCH FITNESS section expands.
  const [balanceFitness, setBalanceFitness] = useState(null); // null = unloaded
  const [balanceSaving,  setBalanceSaving]  = useState(false);
  const [balanceError,   setBalanceError]   = useState(null);
  const loadBalanceFitness = async () => {
    if (balanceFitness !== null) return;
    try {
      const res = await getMyUseFitnessForBalancing();
      setBalanceFitness(!!res?.use_fitness_for_balancing);
    } catch (e) {
      console.error("[profile] load balancing consent failed", e);
      setBalanceFitness(false);
    }
  };
  const toggleBalanceFitness = async () => {
    if (balanceSaving || balanceFitness === null) return;
    const next = !balanceFitness;
    setBalanceFitness(next);   // optimistic
    setBalanceSaving(true);
    setBalanceError(null);
    try {
      await setUseFitnessForBalancing(next);
    } catch (e) {
      console.error("[profile] save balancing consent failed", e);
      setBalanceFitness(!next); // revert
      setBalanceError("Couldn't save — try again.");
    } finally {
      setBalanceSaving(false);
    }
  };
  // Load both consents when the MATCH FITNESS section expands.
  const loadFitnessConsents = () => { loadShareFitness(); loadBalanceFitness(); };

  // Admin-mode state
  const [editingNick, setEditingNick] = useState(false);
  const [nickname,    setNickname]    = useState(me?.nickname || "");
  const [nickError,   setNickError]   = useState(null);
  const [nickSaving,  setNickSaving]  = useState(false);
  const [newToken,    setNewToken]    = useState(null);
  const [linkCopied,  setLinkCopied]  = useState(false);
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [removing,    setRemoving]    = useState(false);
  const [adminError,  setAdminError]  = useState(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [claimingId,  setClaimingId]  = useState(null);

  // Reset Leave / Remove two-tap confirm after 4s if not actioned
  useEffect(() => {
    if (!leaveConfirming) return;
    const t = setTimeout(() => setLeaveConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [leaveConfirming]);

  useEffect(() => {
    if (!removeConfirming) return;
    const t = setTimeout(() => setRemoveConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [removeConfirming]);

  const loadPayHistory = async () => {
    if (!me?.id && !me?.token) return;
    setPayHistLoading(true); setPayHistError(false);
    try {
      const rows = isAdminView
        ? await adminGetPlayerLedger(adminToken, me.id, 50)
        : await getMyPaymentHistory(me.token, 50);
      setPayHist(rows || []);
    } catch (e) {
      console.error("Failed to load payment history:", e);
      setPayHistError(true);
    } finally {
      setPayHistLoading(false);
    }
  };

  // Player marks a specific unpaid game fee as a CLAIM (awaiting admin confirmation).
  // Optimistic: stamp the row claimed immediately, revert on error. Double-fire guarded.
  const handleClaimPayment = async (ledgerId) => {
    if (!me?.token || claimingId) return;
    setClaimingId(ledgerId);
    const nowIso = new Date().toISOString();
    setPayHist(prev => prev.map(r =>
      r.id === ledgerId ? { ...r, claimedAt: nowIso, claimedBy: "self" } : r));
    try {
      await claimLedgerPayment(me.token, ledgerId);
    } catch (e) {
      console.error("Failed to claim payment:", e);
      setPayHist(prev => prev.map(r =>
        r.id === ledgerId ? { ...r, claimedAt: null, claimedBy: null } : r));
    } finally {
      setClaimingId(null);
    }
  };

  const loadInjuries = async () => {
    if (!me?.id && !me?.token) return;
    setInjuriesLoading(true); setInjuriesError(false);
    try {
      const rows = isAdminView
        ? await getPlayerInjuries(me.id)
        : await getMyInjuries(me.token);
      setInjuries(rows || []);
    } catch (e) {
      console.error("Failed to load injuries:", e);
      setInjuriesError(true);
    } finally {
      setInjuriesLoading(false);
    }
  };

  const loadContact = async () => {
    if (!me?.token) return;
    setContactLoading(true); setContactError(null);
    try {
      const c = await getMyContact(me.token);
      setContact(c);
      setContactPhone(c?.phone || "");
      setContactChannel(c?.notification_channel || "push");
    } catch (e) {
      console.error("Failed to load contact prefs:", e);
      setContactError("Couldn't load preferences");
    } finally {
      setContactLoading(false);
    }
  };

  const saveContact = async () => {
    setContactSaving(true); setContactError(null); setContactSaved(false);
    try {
      await setPlayerContact(me.token, contactPhone, contactChannel);
      // When the user picks in-app push, register the device for native
      // (APNs/FCM) push too — otherwise choosing "Push notification (this app)"
      // saves the preference but never captures a device token. The result is
      // async (the token arrives via a listener), so report the real outcome
      // via callbacks. No-ops on web (returns false → no message).
      if (contactChannel === "push") {
        setPushMsg(null);
        const r = await registerNativePush(me.token, {
          onRegistered: () => setPushMsg({ ok:true,  text:"Push notifications are on ✓" }),
          onError:      () => setPushMsg({ ok:false, text:"Couldn't turn on push — check Settings → In or Out → Notifications." }),
        });
        if (r === "registering") setPushMsg({ ok:true, text:"Turning on push…" });
        else if (r === "denied") setPushMsg({ ok:false, text:"Notifications are blocked. Enable them in Settings → In or Out → Notifications." });
      } else {
        setPushMsg(null);
      }
      setContactSaved(true);
      setTimeout(() => setContactSaved(false), 2000);
    } catch (e) {
      const msg = e?.message || "";
      setContactError(msg.includes("phone_required") ? "Add a phone number to use SMS or WhatsApp." : "Couldn't save");
    } finally {
      setContactSaving(false);
    }
  };

  // ── Admin-mode handlers ────────────────────────────────────────────────
  const saveNick = async () => {
    setNickSaving(true); setNickError(null);
    try {
      await setPlayerNickname(adminToken, me.id, nickname);
      const trimmed = nickname.trim() || null;
      setSquad?.(sq => sq.map(s => s.id === me.id ? { ...s, nickname: trimmed } : s));
      setEditingNick(false);
    } catch (e) {
      setNickError(e?.code === "nickname_taken" ? "Already taken on this squad" : "Failed to save");
    } finally {
      setNickSaving(false);
    }
  };

  const handleResetLink = async () => {
    setAdminError(null);
    try {
      const tok = await resetPlayerToken(adminToken, me.id);
      setNewToken(tok);
    } catch (e) {
      console.error(e);
      setAdminError("Couldn't reset link — try again.");
    }
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/p/${newToken || me?.token}`;
    try { await navigator.clipboard.writeText(url); } catch {}
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleAdminMarkInjured = async () => {
    setAdminError(null);
    try {
      await insertPlayerInjury(adminToken, me.id);
      setSquad?.(sq => sq.map(s => s.id === me.id
        ? { ...s, injured: true, injuredSince: new Date().toISOString(), status: "out" } : s));
    } catch (e) {
      console.error(e);
      setAdminError("Couldn't mark injured — try again.");
    }
  };

  const handleAdminClearInjury = async () => {
    setAdminError(null);
    try {
      await clearPlayerInjury(adminToken, me.id);
      setSquad?.(sq => sq.map(s => s.id === me.id
        ? { ...s, injured: false, injuredSince: null } : s));
    } catch (e) {
      console.error(e);
      setAdminError("Couldn't clear injury — try again.");
    }
  };

  // Admin override of a player's availability (reuses admin_set_player_status,
  // same RPC as the Squad screen's ⋮ menu — surfaced here so it's reachable
  // straight from the player's profile).
  const handleAdminSetStatus = async (next) => {
    if (statusSaving || me?.status === next) return;
    setStatusSaving(true); setAdminError(null);
    const prevStatus = me?.status;
    setSquad?.(sq => sq.map(s => s.id === me.id ? { ...s, status: next } : s));
    try {
      await adminSetPlayerStatus(adminToken, me.id, next);
    } catch (e) {
      console.error(e);
      setSquad?.(sq => sq.map(s => s.id === me.id ? { ...s, status: prevStatus } : s));
      setAdminError("Couldn't update availability — try again.");
    } finally {
      setStatusSaving(false);
    }
  };

  const handleAdminRemove = async () => {
    if (!removeConfirming) { setRemoveConfirming(true); setAdminError(null); return; }
    setRemoving(true); setAdminError(null);
    try {
      await deletePlayer(adminToken, me.id);
      setSquad?.(sq => sq.filter(s => s.id !== me.id));
      onBack();
    } catch (e) {
      console.error(e);
      const msg = e?.message || "";
      if (msg.includes("has_history")) {
        setAdminError("Player has match history — Disable instead from Manage Squad.");
      } else {
        setAdminError("Couldn't remove — try again.");
      }
      setRemoveConfirming(false);
    } finally {
      setRemoving(false);
    }
  };

  const handleToggleVC = async () => {
    const newVal = !me?.isViceCaptain;
    setSquad?.(sq => sq.map(s => s.id === me.id ? { ...s, isViceCaptain: newVal } : s));
    try {
      await toggleViceCaptain(adminToken, me.id, newVal);
    } catch (e) {
      console.error(e);
      setSquad?.(sq => sq.map(s => s.id === me.id ? { ...s, isViceCaptain: !newVal } : s));
    }
  };

  const handleLeave = async () => {
    if (!me?.token) return;
    if (!leaveConfirming) { setLeaveConfirming(true); setLeaveError(null); return; }
    setLeaving(true); setLeaveError(null);
    try {
      await leaveSquad(me.token);
      exitToHome();
    } catch (e) {
      if (e?.code === 'debt_owed') {
        setLeaveError(`Settle £${e.owes || 0} first — head to MY VIEW and pay.`);
      } else {
        setLeaveError("Couldn't leave — try again.");
        console.error(e);
      }
      setLeaveConfirming(false);
    } finally {
      setLeaving(false);
    }
  };

  const handleDelete = async () => {
    if (!me?.token) return;
    if (deleteText.trim().toUpperCase() !== 'DELETE') return;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteMyAccount(me.token);
      exitToHome();
    } catch (e) {
      if (e?.code === 'last_admin') {
        const n = e.teamIds?.length || 1;
        setDeleteError(`You're the only admin on ${n} team${n === 1 ? '' : 's'}. Hand over admin first.`);
      } else {
        setDeleteError("Couldn't delete — try again.");
        console.error(e);
      }
    } finally {
      setDeleting(false);
    }
  };

  const displayName = me?.nickname || me?.name || "Player";

  return (
    <div style={{
      minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:120,
    }}>

      {/* Sticky back header */}
      <div style={{
        position:"sticky", top:0, zIndex:50, background:"var(--bg)",
        borderBottom:"0.5px solid var(--b2)",
        // Pad for the status bar / notch so the back arrow + title aren't
        // tucked under it on a native (Capacitor) build or notched PWA.
        padding:"calc(12px + env(safe-area-inset-top)) 16px 12px",
        display:"flex", alignItems:"center", gap:12,
      }}>
        <div onClick={onBack} style={{
          display:"flex", alignItems:"center",
          cursor:"pointer", color:"var(--gold)",
          WebkitTapHighlightColor:"transparent",
        }}>
          <ArrowLeft size={20} weight="thin"/>
        </div>
        <div style={{
          fontFamily:"var(--font-display)", fontSize:22,
          letterSpacing:"0.04em", color:"var(--t1)", lineHeight:1,
        }}>
          {displayName}
        </div>
        {isAdminView && (
          <span style={{
            fontSize:10, fontWeight:400, letterSpacing:"0.12em",
            color:"var(--gold)", background:"var(--gold2)",
            border:"0.5px solid var(--goldb)", borderRadius:"var(--r-pill)",
            padding:"2px 8px", marginLeft:"auto", textTransform:"uppercase",
          }}>Admin view</span>
        )}
        {!isAdminView && me?.injured && (
          <span style={{
            fontSize:11, color:"var(--red)", background:"var(--red2)",
            border:"0.5px solid var(--redb)", borderRadius:"var(--r-pill)",
            padding:"2px 8px", marginLeft:"auto",
          }}>Injured</span>
        )}
      </div>

      <div style={{ padding:"20px 16px 0" }}>

        {/* Identity block — big avatar + name */}
        <div style={{
          display:"flex", flexDirection:"column", alignItems:"center",
          marginBottom:24,
        }}>
          <motion.div
            layoutId="me-avatar"
            transition={{ type:"spring", stiffness:380, damping:32 }}
            style={{
              width:84, height:84, borderRadius:"50%",
              background:"rgba(255,255,255,0.05)",
              border:"1px solid rgba(255,255,255,0.20)",
              boxShadow:"0 0 24px rgba(232,160,32,0.10)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:"'Bebas Neue', sans-serif", fontSize:30,
              letterSpacing:"0.04em", color:"var(--t1)",
              marginBottom:10,
            }}
          >
            {initials(me?.name)}
          </motion.div>
          <div style={{
            fontFamily:"var(--font-display)", fontSize:30,
            letterSpacing:"0.03em", color:"var(--t1)", lineHeight:1,
            textShadow:"0 0 18px rgba(232,160,32,0.12)",
          }}>
            {displayName}
          </div>
          {settings?.groupName && (
            <div style={{
              fontSize:11, color:"var(--t2)", fontWeight:300,
              letterSpacing:"0.14em", textTransform:"uppercase",
              marginTop:6,
            }}>
              {settings.groupName}
            </div>
          )}
        </div>

        {/* Sections */}
        <Section
          icon={<ChartLineUp size={16} weight="thin" color="var(--gold)"/>}
          label="STATS"
          defaultOpen
        >
          <StatsBody me={me}/>
        </Section>

        <Section
          icon={<Receipt size={16} weight="thin" color="var(--green)"/>}
          label="PAYMENT HISTORY"
          onExpand={loadPayHistory}
        >
          <PaymentHistoryBody
            entries={payHist}
            loading={payHistLoading}
            error={payHistError}
            onClaim={handleClaimPayment}
            claimingId={claimingId}
            canClaim={!isAdminView}
          />
        </Section>

        <Section
          icon={<Bandaids size={16} weight="thin" color={me?.injured ? "var(--red)" : "var(--t2)"}/>}
          label="INJURIES"
          onExpand={loadInjuries}
        >
          <InjuriesBody
            injuries={injuries}
            loading={injuriesLoading}
            error={injuriesError}
            currentlyInjured={me?.injured}
          />
        </Section>

        {/* Notifications preference (player mode only) — Phase 9 contact-capture */}
        {!isAdminView && me?.token && (
          <Section
            icon={<BellSimple size={16} weight="thin" color="var(--t2)"/>}
            label="NOTIFICATIONS"
            onExpand={loadContact}
          >
            <div style={{ padding:"4px 16px 16px" }}>
              {contactLoading ? (
                <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>Loading…</div>
              ) : (
                <>
                  <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, margin:"0 0 6px" }}>How should we reach you?</div>
                  <select value={contactChannel} onChange={e => setContactChannel(e.target.value)}
                    style={{ width:"100%", background:"var(--s3)", border:"0.5px solid var(--border-subtle)",
                      borderRadius:"var(--rs)", padding:"8px 10px", fontSize:13, color:"var(--t1)",
                      fontFamily:"var(--font-body)", outline:"none" }}>
                    <option value="push">Push notification (this app)</option>
                    <option value="email" disabled={!contact?.has_linked_email}>
                      {contact?.has_linked_email ? "Email" : "Email — sign in first"}
                    </option>
                    <option value="sms">Text message (SMS)</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>

                  {(contactChannel === "sms" || contactChannel === "whatsapp") && (
                    <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                      placeholder="+44…" inputMode="tel" autoComplete="tel"
                      style={{ width:"100%", marginTop:8, background:"var(--s3)",
                        border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                        padding:"8px 10px", fontSize:13, color:"var(--t1)",
                        fontFamily:"var(--font-body)", outline:"none" }}/>
                  )}

                  <button onClick={saveContact} disabled={contactSaving}
                    style={{ marginTop:10, background: contactSaved ? "var(--green)" : "var(--gold)",
                      color:"var(--black)", border:"none", borderRadius:"var(--rs)",
                      padding:"8px 16px", fontSize:13, fontWeight:600,
                      cursor: contactSaving ? "not-allowed" : "pointer",
                      fontFamily:"var(--font-body)", opacity: contactSaving ? 0.6 : 1 }}>
                    {contactSaving ? "Saving…" : contactSaved ? "Saved ✓" : "Save"}
                  </button>

                  {contactError && (
                    <div style={{ fontSize:11, color:"var(--red)", fontWeight:300, marginTop:6 }}>{contactError}</div>
                  )}
                  {pushMsg && (
                    <div style={{ fontSize:11, fontWeight:400, marginTop:6,
                      color: pushMsg.ok ? "var(--green)" : "var(--red)" }}>{pushMsg.text}</div>
                  )}
                  <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:8 }}>
                    Used for league fixture reminders. Push is the default.
                  </div>
                </>
              )}
            </div>
          </Section>
        )}

        {/* Match-fitness sharing consent (signed-in players only) — mig 457 */}
        {!isAdminView && isAuthed && (
          <Section
            icon={<Lightning size={16} weight="thin" color="var(--t2)"/>}
            label="MATCH FITNESS"
            onExpand={loadFitnessConsents}
          >
            <div style={{ padding:"4px 16px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <div style={{ fontSize:13, color:"var(--t1)", fontFamily:"var(--font-body)" }}>
                  Share my match fitness with my squad
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={shareFitness === true}
                  aria-label="Share my match fitness with my squad"
                  onClick={toggleShareFitness}
                  disabled={shareFitness === null || shareSaving}
                  style={{
                    position:"relative", width:44, height:26, flexShrink:0, borderRadius:13, border:"none",
                    cursor:(shareFitness === null || shareSaving) ? "not-allowed" : "pointer", padding:0,
                    background: shareFitness ? "var(--green)" : "var(--s3)", transition:"background 0.15s ease",
                    opacity: shareFitness === null ? 0.5 : 1,
                  }}
                >
                  <span style={{
                    position:"absolute", top:3, left: shareFitness ? 21 : 3, width:20, height:20,
                    borderRadius:"50%", background:"var(--t1)", transition:"left 0.15s ease",
                  }}/>
                </button>
              </div>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:8 }}>
                Off by default. When on, your squad can see your Apple Watch stats for casual games you both played. Your route map stays private.
              </div>
              {shareError && (
                <div style={{ fontSize:11, color:"var(--red)", fontWeight:300, marginTop:6 }}>{shareError}</div>
              )}

              {/* Fitness-in-balancing consent (mig 502) — separate default-OFF switch. */}
              <div style={{ height:1, background:"var(--s3)", margin:"16px 0" }}/>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <div style={{ fontSize:13, color:"var(--t1)", fontFamily:"var(--font-body)" }}>
                  Use my match fitness to help balance teams
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={balanceFitness === true}
                  aria-label="Use my match fitness to help balance teams"
                  onClick={toggleBalanceFitness}
                  disabled={balanceFitness === null || balanceSaving}
                  style={{
                    position:"relative", width:44, height:26, flexShrink:0, borderRadius:13, border:"none",
                    cursor:(balanceFitness === null || balanceSaving) ? "not-allowed" : "pointer", padding:0,
                    background: balanceFitness ? "var(--green)" : "var(--s3)", transition:"background 0.15s ease",
                    opacity: balanceFitness === null ? 0.5 : 1,
                  }}
                >
                  <span style={{
                    position:"absolute", top:3, left: balanceFitness ? 21 : 3, width:20, height:20,
                    borderRadius:"50%", background:"var(--t1)", transition:"left 0.15s ease",
                  }}/>
                </button>
              </div>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:8 }}>
                Off by default. When on, your fitness can nudge how the Smart Teams balancer splits sides — admin-only, never shown to other players. Adults only.
              </div>
              {balanceError && (
                <div style={{ fontSize:11, color:"var(--red)", fontWeight:300, marginTop:6 }}>{balanceError}</div>
              )}
            </div>
          </Section>
        )}

        {/* Admin Actions (admin mode only) */}
        {isAdminView && (
          <>
            {/* ROLES — VC toggle */}
            {!me?.isGuest && (
              <div className="pp-section" style={{
                background:"rgba(255,255,255,0.03)",
                backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
                border:"0.5px solid var(--border-subtle)",
                borderRadius:"var(--r)", overflow:"hidden", marginBottom:10,
                padding:"14px 16px",
                display:"flex", alignItems:"center", justifyContent:"space-between",
              }}>
                <div style={{ flex:1, paddingRight:16 }}>
                  <div style={{ fontSize:14, color:"var(--t1)" }}>Vice Captain</div>
                  <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginTop:2 }}>
                    Can access admin view and manage the team
                  </div>
                </div>
                {me?.id === viewer?.id ? (
                  <span style={{ fontSize:13, color:"var(--gold)", flexShrink:0 }}>
                    You're the Admin
                  </span>
                ) : (
                  <div onClick={handleToggleVC} style={{
                    width:44, height:24, borderRadius:12, flexShrink:0,
                    background: me?.isViceCaptain ? "var(--gold)" : "var(--s3)",
                    cursor:"pointer", position:"relative",
                  }}>
                    <div style={{
                      position:"absolute", top:2, left: me?.isViceCaptain ? 22 : 2,
                      width:20, height:20, borderRadius:"50%", background:"var(--t1)",
                    }}/>
                  </div>
                )}
              </div>
            )}

            {/* Admin Actions section */}
            <div style={{
              fontSize:10, fontWeight:400, letterSpacing:"0.14em",
              textTransform:"uppercase", color:"var(--t2)",
              margin:"24px 4px 10px",
            }}>
              Admin Actions
            </div>
            <div className="pp-section" style={{
              background:"rgba(255,255,255,0.03)",
              backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
              border:"0.5px solid var(--border-subtle)",
              borderRadius:"var(--r)", overflow:"hidden", marginBottom:10,
            }}>
              {/* Set availability — admin override (same RPC as Squad ⋮ menu) */}
              <div style={{ padding:"12px 16px", borderBottom:"0.5px solid var(--b2)" }}>
                <div style={{ fontSize:13, color:"var(--t1)", marginBottom:10,
                  display:"flex", alignItems:"center", gap:10 }}>
                  <BellSimple size={16} weight="thin" color="var(--t2)"/>
                  Set availability
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  {[
                    { v:"in",      label:"In",      color:"var(--green)",  bg:"var(--green2)",  border:"var(--greenb)" },
                    { v:"out",     label:"Out",     color:"var(--red)",    bg:"var(--red2)",    border:"var(--redb)" },
                    { v:"maybe",   label:"Maybe",   color:"var(--amber)",  bg:"var(--amber2)",  border:"var(--amberb)" },
                    { v:"reserve", label:"Reserve", color:"var(--purple)", bg:"var(--purple2)", border:"var(--purpleb)" },
                  ].map(({ v, label, color, bg, border }) => {
                    const active = me?.status === v;
                    return (
                      <button key={v} onClick={() => handleAdminSetStatus(v)} disabled={statusSaving}
                        style={{ flex:1, padding:"8px 0", borderRadius:"var(--rs)",
                          border:`0.5px solid ${active ? border : "var(--border-subtle)"}`,
                          background: active ? bg : "transparent",
                          color: active ? color : "var(--t2)",
                          fontFamily:"var(--font-body)", fontSize:12, fontWeight: active ? 600 : 400,
                          cursor: statusSaving ? "not-allowed" : "pointer",
                          WebkitTapHighlightColor:"transparent" }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Rename */}
              {editingNick ? (
                <div style={{ padding:"12px 16px", borderBottom:"0.5px solid var(--b2)" }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <input value={nickname} autoFocus
                      onChange={e => { setNickname(e.target.value); setNickError(null); }}
                      onKeyDown={e => e.key === "Enter" && saveNick()}
                      placeholder="Nickname"
                      style={{ flex:1, background:"var(--s3)",
                        border:`0.5px solid ${nickError ? "var(--red)" : "var(--border-subtle)"}`,
                        borderRadius:"var(--rs)", padding:"6px 10px", fontSize:13,
                        color:"var(--t1)", fontFamily:"var(--font-body)", outline:"none" }}/>
                    <button onClick={saveNick} disabled={nickSaving}
                      style={{ background:"var(--gold)", color:"var(--black)",
                        border:"none", borderRadius:"var(--rs)", padding:"6px 12px",
                        fontSize:12, fontWeight:600, cursor: nickSaving ? "not-allowed" : "pointer",
                        fontFamily:"var(--font-body)", opacity: nickSaving ? 0.6 : 1 }}>
                      {nickSaving ? "…" : "Save"}
                    </button>
                    <button onClick={() => { setEditingNick(false); setNickError(null); }}
                      style={{ background:"transparent", border:"0.5px solid var(--border-subtle)",
                        borderRadius:"var(--rs)", padding:"6px 10px", fontSize:12, color:"var(--t2)",
                        cursor:"pointer", fontFamily:"var(--font-body)" }}>✕</button>
                  </div>
                  {nickError && (
                    <div style={{ fontSize:11, color:"var(--red)", marginTop:6, fontWeight:300 }}>{nickError}</div>
                  )}
                </div>
              ) : (
                <button onClick={() => { setNickname(me?.nickname || ""); setEditingNick(true); }}
                  style={{ width:"100%", padding:"14px 16px", textAlign:"left",
                    background:"transparent", border:"none", cursor:"pointer",
                    fontFamily:"var(--font-body)", fontSize:13, color:"var(--t1)",
                    display:"flex", alignItems:"center", gap:10,
                    borderBottom:"0.5px solid var(--b2)",
                    WebkitTapHighlightColor:"transparent" }}>
                  <PencilSimple size={16} weight="thin" color="var(--t2)"/>
                  Rename
                  <span style={{ marginLeft:"auto", fontSize:11, color:"var(--t2)", fontWeight:300 }}>
                    {me?.nickname ? `"${me.nickname}"` : "Add nickname"}
                  </span>
                </button>
              )}

              {/* Copy / Reset link (regulars only) */}
              {!me?.isGuest && (me?.token || newToken) && (
                <button onClick={handleCopyLink}
                  style={{ width:"100%", padding:"14px 16px", textAlign:"left",
                    background:"transparent", border:"none", cursor:"pointer",
                    fontFamily:"var(--font-body)", fontSize:13, color:"var(--t1)",
                    display:"flex", alignItems:"center", gap:10,
                    borderBottom:"0.5px solid var(--b2)",
                    WebkitTapHighlightColor:"transparent" }}>
                  <LinkIcon size={16} weight="thin"
                    color={linkCopied ? "var(--green)" : "var(--t2)"}/>
                  {linkCopied ? "Link copied" : "Copy personal link"}
                </button>
              )}
              {!me?.isGuest && (
                <button onClick={handleResetLink}
                  style={{ width:"100%", padding:"14px 16px", textAlign:"left",
                    background:"transparent", border:"none", cursor:"pointer",
                    fontFamily:"var(--font-body)", fontSize:13,
                    color: newToken ? "var(--green)" : "var(--t1)",
                    display:"flex", alignItems:"center", gap:10,
                    borderBottom:"0.5px solid var(--b2)",
                    WebkitTapHighlightColor:"transparent" }}>
                  <ArrowsClockwise size={16} weight="thin"
                    color={newToken ? "var(--green)" : "var(--t2)"}/>
                  {newToken ? "Link reset — copy above" : "Reset personal link"}
                </button>
              )}

              {/* Mark Injured / Clear Injury */}
              <button onClick={me?.injured ? handleAdminClearInjury : handleAdminMarkInjured}
                style={{ width:"100%", padding:"14px 16px", textAlign:"left",
                  background:"transparent", border:"none", cursor:"pointer",
                  fontFamily:"var(--font-body)", fontSize:13,
                  color: me?.injured ? "var(--green)" : "var(--amber)",
                  display:"flex", alignItems:"center", gap:10,
                  WebkitTapHighlightColor:"transparent" }}>
                <FirstAid size={16} weight="thin"
                  color={me?.injured ? "var(--green)" : "var(--amber)"}/>
                {me?.injured ? "Clear injury" : "Mark as injured"}
              </button>
            </div>

            {adminError && (
              <div style={{ fontSize:11, color:"var(--red)", fontWeight:300, padding:"0 4px 8px" }}>
                {adminError}
              </div>
            )}

            {/* Remove from squad (admin destructive) */}
            <div style={{ marginTop:24 }}>
              <button
                onClick={handleAdminRemove}
                disabled={removing}
                style={{
                  width:"100%", padding:"14px 16px",
                  borderRadius:"var(--r)",
                  background: removeConfirming ? "var(--red2)" : "transparent",
                  border:`0.5px solid var(--redb)`,
                  color:"var(--red)",
                  fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
                  display:"flex", alignItems:"center", gap:10,
                  cursor: removing ? "not-allowed" : "pointer",
                  opacity: removing ? 0.6 : 1,
                  WebkitTapHighlightColor:"transparent",
                  transition:"background 0.2s",
                }}
              >
                <Trash size={16} weight="thin"/>
                {removing
                  ? "Removing…"
                  : removeConfirming
                    ? "Tap again to confirm — removes from squad"
                    : "Remove from squad"}
              </button>
            </div>
          </>
        )}

        {/* Help & FAQ — neutral, always visible (both player and admin mode). */}
        <button
          onClick={() => { window.location.href = "/faq"; }}
          style={{
            width:"100%", padding:"14px 16px", marginTop:32,
            borderRadius:"var(--r)",
            background:"transparent",
            border:`0.5px solid var(--border-subtle)`,
            color:"var(--t1)",
            fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
            display:"flex", alignItems:"center", gap:10,
            cursor:"pointer",
            WebkitTapHighlightColor:"transparent",
          }}
        >
          <Question size={16} weight="thin"/>
          Help &amp; FAQ
        </button>

        {/* Switch team or venue — the non-destructive escape to your other
            contexts. Opens the unified ContextSwitcher (other squads, clubs,
            family, officiating, and your operator hub via its Feed row). Added
            because this profile previously offered NO way to another context —
            only Create/Leave/Delete — so a multi-context user could get stuck
            in one squad. Purely additive: the avatar still opens this profile. */}
        {!isAdminView && isAuthed && onSwitchContext && (
          <button
            onClick={onSwitchContext}
            style={{
              width:"100%", padding:"14px 16px", marginTop:32,
              borderRadius:"var(--r)",
              background:"transparent",
              border:`0.5px solid var(--border-subtle)`,
              color:"var(--gold)",
              fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
              display:"flex", alignItems:"center", gap:10,
              cursor:"pointer",
              WebkitTapHighlightColor:"transparent",
            }}
          >
            <ArrowsLeftRight size={16} weight="thin"/>
            Switch team or venue
          </button>
        )}

        {/* Create a new squad — player mode + real signed-in session only.
            Routes to the existing squad-setup wizard at /create, where
            create_team (mig 052) makes the signed-in creator the team_admin
            of an independent new squad. Neutral/positive action — NOT
            destructive — so it sits just above the Account zone. */}
        {!isAdminView && isAuthed && (
          <button
            onClick={() => {
              // Carry a returnTo marker so the create-squad wizard shows a
              // Cancel button back to here (onboarded users only — first-time
              // setup navigates to a plain /create with no marker).
              const back = window.location.pathname + window.location.search;
              window.location.href = "/create?returnTo=" + encodeURIComponent(back);
            }}
            style={{
              width:"100%", padding:"14px 16px", marginTop:32,
              borderRadius:"var(--r)",
              background:"transparent",
              border:`0.5px solid var(--border-subtle)`,
              color:"var(--t1)",
              fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
              display:"flex", alignItems:"center", gap:10,
              cursor:"pointer",
              WebkitTapHighlightColor:"transparent",
            }}
          >
            <Plus size={16} weight="thin"/>
            Create a new squad
          </button>
        )}

        {/* Destructive zone — player mode only */}
        {!isAdminView && (
          <div style={{ marginTop:32 }}>
            <div style={{
              fontSize:10, fontWeight:400, letterSpacing:"0.14em",
              textTransform:"uppercase", color:"var(--t2)",
              margin:"0 4px 10px",
            }}>
              Account
            </div>

            {isAuthed && (
              <button
                onClick={handleSignOut}
                style={{
                  width:"100%", padding:"14px 16px",
                  borderRadius:"var(--r)",
                  background:"transparent",
                  border:`0.5px solid var(--border-subtle)`,
                  color:"var(--t1)",
                  fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
                  display:"flex", alignItems:"center", gap:10,
                  cursor:"pointer", marginBottom:8,
                  WebkitTapHighlightColor:"transparent",
                }}
              >
                <SignOut size={16} weight="thin"/>
                Sign out
              </button>
            )}

            <FirstTimeHint
              storageKey="ioo_hint_profile_leave"
              placement="top"
              title="LEAVE IS TWO TAPS"
              body="The first tap is a warning. You get a 4-second window to confirm — accidental taps won't remove you."
            >
            <button
              onClick={handleLeave}
              disabled={leaving}
              style={{
                width:"100%", padding:"14px 16px",
                borderRadius:"var(--r)",
                background: leaveConfirming ? "var(--amber2)" : "transparent",
                border:`0.5px solid var(--amberb)`,
                color:"var(--amber)",
                fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
                display:"flex", alignItems:"center", gap:10,
                cursor: leaving ? "not-allowed" : "pointer",
                opacity: leaving ? 0.6 : 1,
                marginBottom: leaveError ? 6 : 8,
                WebkitTapHighlightColor:"transparent",
                transition:"background 0.2s",
              }}
            >
              <SignOut size={16} weight="thin"/>
              {leaving
                ? "Leaving…"
                : leaveConfirming
                  ? "Tap again to confirm — you can rejoin via invite link"
                  : "Leave this squad"}
            </button>
            </FirstTimeHint>
            {leaveError && (
              <div style={{
                fontSize:11, color:"var(--red)", fontWeight:300,
                padding:"0 4px 8px",
              }}>
                {leaveError}
              </div>
            )}

            <button
              onClick={() => requireAuth(
                () => { setDeleteText(""); setDeleteError(null); setShowDelete(true); },
                { reason: "Deleting your account permanently removes your sign-in. Confirm it's you with a 6-digit code." }
              )}
              style={{
                width:"100%", padding:"14px 16px",
                borderRadius:"var(--r)",
                background:"transparent",
                border:`0.5px solid var(--redb)`,
                color:"var(--red)",
                fontFamily:"var(--font-body)", fontSize:13, fontWeight:500,
                display:"flex", alignItems:"center", gap:10,
                cursor:"pointer",
                WebkitTapHighlightColor:"transparent",
              }}
            >
              <Trash size={16} weight="thin"/>
              Delete my account
            </button>
          </div>
        )}

        <VersionFooter />

      </div>

      {/* Delete-account modal */}
      {showDelete && (
        <div style={{
          position:"fixed", inset:0, zIndex:200,
          background:"rgba(0,0,0,0.75)",
          backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:20,
        }}>
          <div style={{
            width:"100%", maxWidth:380,
            background:"var(--s1)",
            border:"0.5px solid var(--redb)",
            borderRadius:"var(--r)", overflow:"hidden",
            boxShadow:"0 0 60px rgba(255,64,64,0.2)",
          }}>
            <div style={{
              padding:"18px 20px 12px",
              display:"flex", alignItems:"center", justifyContent:"space-between",
              borderBottom:"0.5px solid var(--b2)",
            }}>
              <div style={{
                fontFamily:"var(--font-display)", fontSize:20,
                letterSpacing:"0.04em", color:"var(--red)",
              }}>
                DELETE ACCOUNT
              </div>
              <button onClick={() => !deleting && setShowDelete(false)}
                disabled={deleting}
                style={{
                  background:"none", border:"none",
                  color:"var(--t2)", cursor: deleting ? "not-allowed" : "pointer",
                  padding:0, display:"flex", alignItems:"center",
                }}>
                <XIcon size={18} weight="thin"/>
              </button>
            </div>
            <div style={{ padding:"16px 20px 20px" }}>
              <div style={{ fontSize:13, color:"var(--t1)", fontWeight:400, marginBottom:8 }}>
                This wipes your account and signs you out everywhere.
              </div>
              <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:16, lineHeight:1.45 }}>
                Your name is replaced with "Deleted player" in every team's
                history. Stats, goals, and POTM votes you've already earned
                stay on each match record, but anonymised. This can't be
                undone — you'd start fresh.
              </div>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginBottom:6,
                letterSpacing:"0.06em", textTransform:"uppercase" }}>
                Type DELETE to confirm
              </div>
              <input
                value={deleteText}
                onChange={e => setDeleteText(e.target.value)}
                autoFocus
                placeholder="DELETE"
                style={{
                  width:"100%", padding:"10px 12px",
                  borderRadius:"var(--rs)",
                  background:"var(--s2)",
                  border:`1px solid ${deleteText.trim().toUpperCase() === 'DELETE' ? "var(--red)" : "var(--s3)"}`,
                  color:"var(--t1)",
                  fontFamily:"var(--font-body)", fontWeight:400, fontSize:14,
                  letterSpacing:"0.1em",
                  outline:"none", boxSizing:"border-box",
                  marginBottom: deleteError ? 8 : 16,
                }}
              />
              {deleteError && (
                <div style={{ fontSize:11, color:"var(--red)", fontWeight:300, marginBottom:16 }}>
                  {deleteError}
                </div>
              )}
              <button
                onClick={handleDelete}
                disabled={deleting || deleteText.trim().toUpperCase() !== 'DELETE'}
                style={{
                  width:"100%", padding:"12px 16px",
                  borderRadius:"var(--r-button)",
                  background: deleteText.trim().toUpperCase() === 'DELETE' ? "var(--red)" : "var(--s3)",
                  color: deleteText.trim().toUpperCase() === 'DELETE' ? "var(--white)" : "var(--t2)",
                  border:"none",
                  fontFamily:"var(--font-display)", fontSize:14,
                  letterSpacing:"0.08em",
                  cursor: deleting || deleteText.trim().toUpperCase() !== 'DELETE' ? "not-allowed" : "pointer",
                  opacity: deleting ? 0.7 : 1,
                  marginBottom:8,
                }}
              >
                {deleting ? "DELETING…" : "DELETE ACCOUNT"}
              </button>
              <button
                onClick={() => setShowDelete(false)}
                disabled={deleting}
                style={{
                  width:"100%", padding:"10px 16px",
                  borderRadius:"var(--r-button)",
                  background:"transparent", color:"var(--t2)",
                  border:"0.5px solid var(--border-subtle)",
                  fontFamily:"var(--font-body)", fontSize:13, fontWeight:400,
                  cursor: deleting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <AuthGateModal {...gateProps} />
    </div>
  );
}
