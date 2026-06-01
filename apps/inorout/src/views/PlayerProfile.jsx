import { useState, useEffect } from "react";
import {
  ArrowLeft, CaretRight, ChartLineUp, Bandaids, Receipt,
  SignOut, Trash, X as XIcon,
  PencilSimple, Link as LinkIcon, ArrowsClockwise, FirstAid, BellSimple,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import {
  getMyPaymentHistory, getMyInjuries,
  leaveSquad, deleteMyAccount,
  setPlayerNickname, resetPlayerToken,
  insertPlayerInjury, clearPlayerInjury, getPlayerInjuries,
  deletePlayer, getMyContact, setPlayerContact,
} from "@platform/core/storage/supabase.js";
import { adminGetPlayerLedger, toggleViceCaptain } from "@platform/core";
import FirstTimeHint from "../components/FirstTimeHint.jsx";
import AuthGateModal from "../components/AuthGateModal.jsx";
import useRequireAuth from "../hooks/useRequireAuth.js";

// ── helpers ─────────────────────────────────────────────────────────────────

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

function PaymentHistoryBody({ entries, loading, error }) {
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
    const ss = STATUS_STYLE[entry.status] || STATUS_STYLE.unpaid;
    return (
      <div key={entry.id || i} style={{
        padding:"10px 16px", display:"flex", alignItems:"center",
        justifyContent:"space-between", gap:8,
        borderTop: i === 0 ? "none" : "0.5px solid var(--b2)",
      }}>
        <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
          <div style={{ fontSize:12, color:"var(--t1)", fontWeight:400 }}>
            {TYPE_LABEL[entry.type] || entry.type}
          </div>
          <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300 }}>
            {fmtDate(entry.createdAt)}
            {entry.method && <span style={{ opacity:0.6 }}> · {entry.method}</span>}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{
            fontSize:10, fontWeight:600, padding:"2px 7px",
            borderRadius:"var(--r-pill)",
            border:`0.5px solid ${ss.border}`,
            background:ss.bg, color:ss.color, letterSpacing:"0.04em",
          }}>
            {(entry.status || "").toUpperCase()}
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
        borderBottom:"0.5px solid var(--b2)", padding:"12px 16px",
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
                  <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:8 }}>
                    Used for league fixture reminders. Push is the default.
                  </div>
                </>
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
