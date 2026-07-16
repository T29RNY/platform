import { useState, useEffect, useRef } from "react";
import { handleMarkPaid, handleResetPayment, handleWaiveDebt, isDormantGuest, adminRejectClaim, adminSettlePlayer, adminChasePayment } from "@platform/core";
import { adminGetPlayerLedger } from "@platform/core/storage/supabase.js";
import { ArrowLeft, CaretDown, CaretUp, DotsThreeVertical, Megaphone } from "@phosphor-icons/react";
import FirstTimeHint from "../../components/FirstTimeHint.jsx";
import ChaseSheet from "./ChaseSheet.jsx";

// ── constants ─────────────────────────────────────────────────────────────────

const TYPE_LABEL = {
  game_fee: 'Game', guest_fee: 'Guest +1',
  debt_payment: 'Debt', waiver: 'Waived', refund: 'Refund',
  cancelled: 'Cancelled',
};

const STATUS_STYLE = {
  paid:      { bg:"var(--green2)",         border:"var(--greenb)",         color:"var(--green)"  },
  unpaid:    { bg:"var(--amber2)",         border:"var(--amberb)",         color:"var(--amber)"  },
  claimed:   { bg:"var(--amber2)",         border:"var(--amberb)",         color:"var(--amber)"  },
  waived:    { bg:"var(--purple2)",        border:"var(--purpleb)",        color:"var(--purple)" },
  refunded:  { bg:"rgba(96,160,255,0.12)", border:"rgba(96,160,255,0.3)", color:"#60A0FF"       },
  disputed:  { bg:"var(--red2)",           border:"var(--redb)",           color:"var(--red)"    },
  cancelled: { bg:"var(--s3)",             border:"0.5px solid var(--t2)", color:"var(--t2)"     },
};

const STATUS_PILL = {
  in:      { label:"IN",          color:"var(--green)",  bg:"var(--green2)",              border:"var(--greenb)"              },
  out:     { label:"OUT",         color:"var(--red)",    bg:"var(--red2)",                border:"var(--redb)"                },
  maybe:   { label:"MAYBE",       color:"var(--amber)",  bg:"var(--amber2)",              border:"var(--amberb)"              },
  reserve: { label:"RESERVE",     color:"var(--purple)", bg:"var(--purple2)",             border:"var(--purpleb)"             },
  none:    { label:"NO RESPONSE", color:"var(--t2)",     bg:"rgba(255,255,255,0.06)",     border:"rgba(255,255,255,0.15)"     },
};

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
  : '—';

function ini(name) {
  const parts = (name || '').trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || '?').slice(0, 2).toUpperCase();
}

function pill(label, bg, border, color) {
  return (
    <span style={{
      fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:"var(--r-pill)",
      background:bg, border:`0.5px solid ${border}`, color, letterSpacing:"0.05em",
      whiteSpace:"nowrap",
    }}>{label}</span>
  );
}

function payPill(label, bg, border, color) {
  return (
    <span style={{
      fontSize:13, fontWeight:400, padding:"2px 8px", borderRadius:"var(--r-pill)",
      background:bg, border:`0.5px solid ${border}`, color, letterSpacing:"0.02em",
      whiteSpace:"nowrap",
    }}>{label}</span>
  );
}

// ── inline keyframes ──────────────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("pm-styles")) {
  const el = document.createElement("style");
  el.id = "pm-styles";
  el.textContent = `
    @keyframes pm-fade-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
    @keyframes pm-green-flash { 0% { background:rgba(61,220,106,0.20); } 100% { background:transparent; } }
    .pm-row { animation: pm-fade-in 280ms ease both; }
    .pm-row.pm-just-paid { animation: pm-green-flash 1100ms ease both; }
  `;
  document.head.appendChild(el);
}

// ── PlayerRow ─────────────────────────────────────────────────────────────────

function PlayerRow({
  player, adminToken, schedule, setSquad, idx,
  isGuest = false, hostName = null,
  openMenuId, setOpenMenuId,
}) {
  const [open,         setOpen]         = useState(false);
  const [ledger,       setLedger]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [waiverOpen,   setWaiverOpen]   = useState(false);
  const [waiverAmount, setWaiverAmount] = useState(player.owes || 0);
  const [waiverNote,   setWaiverNote]   = useState("");
  const [justPaid,     setJustPaid]     = useState(false);
  const menuRef = useRef(null);

  const isMenuOpen = openMenuId === player.id;

  const isPaid    = player.paid === true;                              // admin-CONFIRMED
  const isClaimed = player.selfPaid === true && player.paid !== true;  // pending claim (mig 211)
  const owes   = player.owes || 0;
  const price  = schedule.pricePerPlayer || 0;
  const sp     = STATUS_PILL[player.status] || STATUS_PILL.none;
  const isIn   = player.status === 'in';

  // Avatar ring colour mirrors payment state. A claim is amber (needs your confirm)
  // even though owes is still > 0.
  const ringColor =
      isClaimed      ? "rgba(255,176,32,0.55)"
    : owes > 0       ? "rgba(255,80,80,0.55)"
    : isPaid         ? "rgba(61,220,106,0.55)"
    : isIn           ? "rgba(255,176,32,0.55)"
    : "var(--border-subtle)";
  const ringGlow =
      isClaimed      ? "0 0 10px rgba(255,176,32,0.18)"
    : owes > 0       ? "0 0 10px rgba(255,80,80,0.22)"
    : isPaid         ? "0 0 10px rgba(61,220,106,0.20)"
    : isIn           ? "0 0 10px rgba(255,176,32,0.18)"
    : "none";

  const guestLine = isGuest
    ? player.paidBy === 'host' ? `Host: ${hostName || 'unknown'}`
    : player.paidBy === 'self' ? 'Self pay'
    : hostName ? `guest of ${hostName}` : null
    : null;

  const refreshLedger = () =>
    adminGetPlayerLedger(adminToken, player.id, 20).then(setLedger).catch(() => setLedger([]));

  const expandRow = async () => {
    if (!open && ledger === null) {
      setLoading(true);
      try { setLedger(await adminGetPlayerLedger(adminToken, player.id, 20)); }
      catch { setLedger([]); }
      finally { setLoading(false); }
    }
    setOpen(true);
  };

  const toggle = async () => {
    if (!open) await expandRow();
    else { setOpen(false); setWaiverOpen(false); }
  };

  const doMarkPaid = async () => {
    // A CLAIM ("claims paid · CONFIRM") settles the player's WHOLE outstanding balance —
    // the debt can be on earlier weeks, not the active match. The "£X PAY" action (an in
    // player, not yet claimed) marks just this week paid on the active match.
    if (isClaimed) {
      await adminSettlePlayer(adminToken, player.id).catch(console.error);
    } else {
      await handleMarkPaid(adminToken, player.id, schedule.activeMatchId || null).catch(console.error);
    }
    // confirm clears the debt — reflect optimistically; broadcast reconciles
    setSquad(sq => sq.map(p => p.id === player.id ? { ...p, paid:true, owes:0, selfPaid:false } : p));
    setJustPaid(true);
    setTimeout(() => setJustPaid(false), 1100);
    if (open) refreshLedger();
  };

  const doReset = async () => {
    await handleResetPayment(adminToken, player.id, schedule.activeMatchId || null).catch(console.error);
    setSquad(sq => sq.map(p => p.id === player.id ? { ...p, paid:false, selfPaid:false, paidBy:null } : p));
    if (open) refreshLedger();
  };

  const startWaive = async () => {
    setWaiverAmount(owes);
    await expandRow();
    setWaiverOpen(true);
  };

  // Click-outside menu
  useEffect(() => {
    if (!isMenuOpen) return;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuId(null); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isMenuOpen, setOpenMenuId]);

  return (
    <div
      className={`pm-row ${justPaid ? "pm-just-paid" : ""}`}
      style={{
        borderTop:"0.5px solid var(--b2)",
        animationDelay: `${Math.min(idx ?? 0, 12) * 28}ms`,
        position:"relative",
        zIndex: isMenuOpen ? 30 : "auto",
      }}
    >
      {/* Collapsed row */}
      <div onClick={toggle} style={{ padding:"10px 16px", display:"flex",
        alignItems:"center", gap:10, cursor:"pointer",
        WebkitTapHighlightColor:"transparent" }}>
        {/* Avatar with status ring */}
        <div style={{ width:36, height:36, borderRadius:"50%", flexShrink:0,
          background:"rgba(255,255,255,0.04)",
          border:`1px solid ${ringColor}`,
          boxShadow:ringGlow,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontFamily:"'Bebas Neue', sans-serif", fontSize:13, letterSpacing:"0.04em",
          color:"var(--t1)",
          transition:"box-shadow 0.3s ease, border 0.3s ease" }}>
          {ini(player.nickname || player.name)}
        </div>
        {/* Name + status */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:400, color:"var(--t1)",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {player.nickname || player.name}
          </div>
          {guestLine && (
            <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300 }}>{guestLine}</div>
          )}
          <div style={{ marginTop:3 }}>
            {pill(sp.label, sp.bg, sp.border, sp.color)}
          </div>
        </div>
        {/* Right side: owed pill, paid/PAY action, ⋯ */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}
          onClick={e => e.stopPropagation()}>
          {owes > 0 && payPill(`£${owes}`, "var(--red2)", "var(--redb)", "var(--red)")}
          {isPaid
            ? payPill("✓ Paid", "var(--green2)", "var(--greenb)", "var(--green)")
            : isClaimed
              ? (
                <button onClick={doMarkPaid}
                  style={{ padding:"4px 12px", borderRadius:"var(--r-pill)",
                    border:"0.5px solid var(--amberb)", background:"var(--amber2)",
                    color:"var(--amber)", fontFamily:"var(--font-body)", fontSize:12,
                    fontWeight:600, letterSpacing:"0.04em", cursor:"pointer" }}>
                  claims paid · CONFIRM
                </button>
              )
              : isIn && (
                <button onClick={doMarkPaid}
                  style={{ padding:"4px 12px", borderRadius:"var(--r-pill)", border:"none",
                    background:"var(--gold)", color:"var(--black)",
                    fontFamily:"var(--font-body)", fontSize:12, fontWeight:600,
                    letterSpacing:"0.04em", cursor:"pointer",
                    boxShadow:"0 0 10px rgba(232,160,32,0.35)" }}>
                  £{price} PAY
                </button>
              )
          }
          {/* ⋯ menu */}
          <div ref={isMenuOpen ? menuRef : null} style={{ position:"relative" }}>
            <button
              onClick={() => setOpenMenuId(isMenuOpen ? null : player.id)}
              style={{ width:28, height:28, borderRadius:"var(--rs)",
                background: isMenuOpen ? "var(--s3)" : "transparent",
                border:`0.5px solid ${isMenuOpen ? "var(--s3)" : "transparent"}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", WebkitTapHighlightColor:"transparent" }}
              title="More actions"
            >
              <DotsThreeVertical size={16} weight="thin"
                color={isMenuOpen ? "var(--t1)" : "var(--t2)"} />
            </button>
            {isMenuOpen && (
              <div style={{
                position:"absolute", top:"100%", right:0, marginTop:6, zIndex:20,
                background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
                borderRadius:12, padding:6, minWidth:200,
                boxShadow:"0 12px 30px rgba(0,0,0,0.55)",
                backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
              }}>
                {!isPaid && (
                  <MenuItem onClick={() => { setOpenMenuId(null); doMarkPaid(); }}>
                    {isClaimed ? "Confirm payment" : "Mark paid — this week"}
                  </MenuItem>
                )}
                {(isPaid || isClaimed) && (
                  <MenuItem onClick={() => { setOpenMenuId(null); doReset(); }}>
                    {isClaimed ? "Reject claim" : "Reset payment"}
                  </MenuItem>
                )}
                {owes > 0 && (
                  <MenuItem danger onClick={() => { setOpenMenuId(null); startWaive(); }}>
                    Waive debt
                  </MenuItem>
                )}
                <MenuItem onClick={() => { setOpenMenuId(null); toggle(); }}>
                  {open ? "Hide ledger" : "Open ledger"}
                </MenuItem>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {open && (
        <div style={{ borderTop:"0.5px solid var(--b2)", padding:"10px 16px 12px" }}>
          {/* Ledger history */}
          {loading ? (
            <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, paddingBottom:8 }}>Loading…</div>
          ) : !ledger?.length ? (
            <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, paddingBottom:8 }}>No payment history yet</div>
          ) : ledger.map((entry, i) => {
            // A claim = an unpaid ledger row the player has marked; admin confirms/rejects it.
            const isClaimed = entry.status === 'unpaid' && !!entry.claimedAt;
            const ss = STATUS_STYLE[isClaimed ? 'claimed' : entry.status] || STATUS_STYLE.unpaid;
            return (
              <div key={entry.id || i} style={{
                padding:"6px 0", display:"flex", alignItems:"center",
                justifyContent:"space-between", gap:8,
                borderTop: i === 0 ? "none" : "0.5px solid var(--b2)",
              }}>
                <div style={{ display:"flex", flexDirection:"column", gap:1, minWidth:0 }}>
                  <div style={{ fontSize:11, color:"var(--t1)", fontWeight:400 }}>
                    {TYPE_LABEL[entry.type] || entry.type}
                  </div>
                  <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300 }}>
                    {fmtDate(entry.createdAt)}
                    {entry.method && <span style={{ opacity:0.6 }}> · {entry.method}</span>}
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                  <span style={{
                    fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:"var(--r-pill)",
                    border:`0.5px solid ${ss.border}`, background:ss.bg, color:ss.color,
                    letterSpacing:"0.04em",
                  }}>
                    {isClaimed ? "CLAIMED" : entry.status.toUpperCase()}
                  </span>
                  <span style={{ fontSize:11, fontWeight:600, color:"var(--t1)", minWidth:28, textAlign:"right" }}>
                    £{Number(entry.amount || 0).toFixed(0)}
                  </span>
                  {/* Claimed week → per-week Confirm (settles just this week) / Reject (clears the claim). */}
                  {isClaimed && entry.type === 'game_fee' && (
                    <>
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        // per-week confirm — admin_confirm_payment(matchId) settles just this week;
                        // owes recomputes server-side (mig 460), broadcast reconciles the squad.
                        await handleMarkPaid(adminToken, player.id, entry.matchId || null).catch(console.error);
                        refreshLedger();
                      }} style={{ marginLeft:8, padding:"3px 8px", borderRadius:"var(--rs)",
                        background:"var(--green2)", color:"var(--green)", fontSize:11, fontWeight:400,
                        border:"0.5px solid var(--greenb)", cursor:"pointer", fontFamily:"var(--font-body)" }}>
                        Confirm
                      </button>
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        await adminRejectClaim(adminToken, player.id, entry.id).catch(console.error);
                        refreshLedger();
                      }} style={{ padding:"3px 8px", borderRadius:"var(--rs)",
                        background:"var(--red2)", color:"var(--red)", fontSize:11, fontWeight:400,
                        border:"0.5px solid var(--redb)", cursor:"pointer", fontFamily:"var(--font-body)" }}>
                        Reject
                      </button>
                    </>
                  )}
                  {/* Unpaid week, nobody has claimed it → let the admin/VC settle THIS week.
                      Until now the per-week Confirm only appeared on a CLAIMED row, so the
                      only way to settle a week the player hadn't claimed was the whole-player
                      "mark paid" (all weeks) or a waiver — neither of which is "Damo gave me
                      a fiver for the 6th".

                      It also repairs players.owes. owes is a CACHE recomputed only by
                      admin_confirm_payment / _reset / _settle — so a player who has never had
                      a payment confirmed keeps owes=0 while unpaid ledger rows pile up, and
                      the OWES MONEY section can't see them. Found on the operator's real squad
                      2026-07-16: the screen said 5 players / £70, the ledger said 14 / £235 —
                      eight players with real unpaid games sitting invisible in NOT PLAYING.
                      Every settle here recomputes that player's owes (mig 460), so the screen
                      heals as the admin works. The ledger is the source of truth (mig 460's own
                      header); owes is just its cache. */}
                  {entry.status === 'unpaid' && entry.type === 'game_fee' && !isClaimed && (
                    <button onClick={async (e) => {
                      e.stopPropagation();
                      await handleMarkPaid(adminToken, player.id, entry.matchId || null).catch(console.error);
                      refreshLedger();
                    }} style={{ marginLeft:8, padding:"3px 8px", borderRadius:"var(--rs)",
                      background:"var(--green2)", color:"var(--green)", fontSize:11, fontWeight:400,
                      border:"0.5px solid var(--greenb)", cursor:"pointer", fontFamily:"var(--font-body)" }}>
                      Mark paid
                    </button>
                  )}
                  {entry.status === 'paid' && entry.type === 'game_fee' && (
                    <button onClick={async (e) => {
                      e.stopPropagation();
                      await handleResetPayment(adminToken, player.id, entry.matchId || null).catch(console.error);
                      setSquad(sq => sq.map(p => p.id === player.id ? { ...p, paid:false, selfPaid:false, paidBy:null } : p));
                      refreshLedger();
                    }} style={{ marginLeft:8, padding:"3px 8px", borderRadius:"var(--rs)",
                      background:"var(--s3)", color:"var(--t2)", fontSize:11, fontWeight:400,
                      border:"none", cursor:"pointer", fontFamily:"var(--font-body)" }}>
                      Reset
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Inline waiver form */}
          {waiverOpen && (
            <div style={{ marginTop:10, padding:"10px 12px", background:"var(--s2)",
              borderRadius:"var(--rs)", border:"0.5px solid var(--redb)" }}>
              <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginBottom:8,
                letterSpacing:"0.06em", textTransform:"uppercase" }}>Waive debt</div>
              <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>£</span>
                  <input
                    type="number"
                    value={waiverAmount}
                    onChange={e => setWaiverAmount(Number(e.target.value))}
                    style={{ width:64, background:"var(--s3)", border:"0.5px solid var(--border-subtle)",
                      borderRadius:"var(--rs)", padding:"5px 8px", fontSize:12, color:"var(--t1)",
                      fontFamily:"var(--font-body)", outline:"none" }}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={waiverNote}
                  onChange={e => setWaiverNote(e.target.value)}
                  style={{ flex:1, minWidth:120, background:"var(--s3)",
                    border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                    padding:"5px 8px", fontSize:12, color:"var(--t1)",
                    fontFamily:"var(--font-body)", outline:"none" }}
                />
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={async () => {
                  await handleWaiveDebt(adminToken, player.id, waiverNote || null).catch(console.error);
                  setSquad(sq => sq.map(p => p.id === player.id ? { ...p, owes:0 } : p));
                  setWaiverOpen(false);
                  setLedger(null);
                }} style={{ padding:"5px 14px", borderRadius:"var(--r-pill)", border:"none",
                  background:"var(--red)", color:"var(--white)", fontSize:11, fontWeight:600,
                  cursor:"pointer", fontFamily:"var(--font-body)" }}>
                  Confirm Waiver
                </button>
                <button onClick={() => setWaiverOpen(false)}
                  style={{ padding:"5px 12px", borderRadius:"var(--r-pill)",
                    border:"0.5px solid var(--border-subtle)", background:"transparent",
                    color:"var(--t2)", fontSize:11, cursor:"pointer",
                    fontFamily:"var(--font-body)" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MenuItem helper ───────────────────────────────────────────────────────────

function MenuItem({ children, onClick, danger = false }) {
  return (
    <button onClick={onClick}
      style={{
        display:"block", width:"100%", textAlign:"left",
        padding:"8px 10px", borderRadius:"var(--rs)",
        background:"transparent", border:"none",
        fontFamily:"var(--font-body)", fontSize:12,
        color: danger ? "var(--red)" : "var(--t1)",
        cursor:"pointer", WebkitTapHighlightColor:"transparent",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--s2)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      {children}
    </button>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ children, color = "var(--t2)", glow = null }) {
  return (
    <div style={{
      padding:"0 16px 6px", fontFamily:"var(--font-display)",
      fontSize:13, letterSpacing:"0.1em", color,
      textShadow: glow || "none",
    }}>
      {children}
    </div>
  );
}

// ── PlayerCard ────────────────────────────────────────────────────────────────

function PlayerCard({ children, accent = null }) {
  return (
    <div style={{
      background:"rgba(255,255,255,0.03)",
      backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
      border:`0.5px solid ${accent || "var(--border-subtle)"}`,
      borderRadius:"var(--r)", overflow:"hidden", margin:"0 16px 12px",
      boxShadow: accent ? `0 0 24px ${accent}` : "none",
    }}>
      {children}
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────

export default function PaymentsScreen({ squad, setSquad, schedule, teamId, adminToken = null, coverPool = [], onBack }) {
  const [showNotPlaying, setShowNotPlaying] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  // ── Chase (mig 591) ────────────────────────────────────────────────────────
  // The audience is resolved SERVER-SIDE from adminToken — never from `squad`. The
  // client's owesSection below is NOT the same set: it includes pending claimants
  // (see :490-491 — "a self-claim still has owes > 0 and lands in owesSection"),
  // whom the RPC deliberately excludes because they've paid and are only waiting on
  // the admin. It also can't know about guest-fee roll-up or known minors. So the
  // button's own count comes from the dry-run, not from owesSection — otherwise it
  // would say "Chase 5" and chase 4.
  const [chasePreview, setChasePreview] = useState(null);
  const [chaseOpen,    setChaseOpen]    = useState(false);
  const [chaseBusy,    setChaseBusy]    = useState(false);
  const [chaseErr,     setChaseErr]     = useState(null);
  const [chaseResult,  setChaseResult]  = useState(null);
  const chasingRef = useRef(false);

  const chaseError = (e) => {
    const m = e?.message || "";
    if (m.includes("chase_rate_limited")) return "Everyone who owes was already chased in the last 24 hours.";
    if (m.includes("no_one_owes"))        return "Nobody owes anything right now.";
    if (m.includes("invalid_admin_token") || m.includes("not_authorised")) return "You're not allowed to chase on this squad.";
    return "Couldn't reach the server — try again.";
  };

  // Quiet hours (notify.js:676-712 defaults 22:00–08:00). A send inside the window is
  // QUEUED, not dropped — so we disclose it rather than silently implying it went now.
  // Deliberately not overridable: money at 22:30 is what turns a fiver into a falling-out.
  const rc         = schedule?.remindersConfig || {};
  const quietStart = rc.quietStart || "22:00";
  const quietEnd   = rc.quietEnd   || "08:00";
  const inQuiet = (() => {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = quietStart.split(":").map(Number);
    const [eh, em] = quietEnd.split(":").map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em;
    return s > e ? (mins >= s || mins < e) : (mins >= s && mins < e);
  })();

  const openChase = async () => {
    if (chasingRef.current) return;      // double-fire guard (CLAUDE.md conventions)
    chasingRef.current = true;
    setChaseBusy(true); setChaseErr(null); setChaseResult(null);
    try {
      const preview = await adminChasePayment(adminToken, { dryRun: true });
      setChasePreview(preview);
      setChaseOpen(true);
    } catch (e) {
      console.error("PaymentsScreen: chase preview failed", e);
      setChaseErr(chaseError(e));
      setChaseOpen(true);
      setChasePreview({ targets: [], unreachable: [], total_owed: 0 });
    } finally {
      setChaseBusy(false);
      chasingRef.current = false;
    }
  };

  const sendChase = async () => {
    if (chasingRef.current) return;
    chasingRef.current = true;
    setChaseBusy(true); setChaseErr(null);
    try {
      const res = await adminChasePayment(adminToken, { dryRun: false });
      setChaseOpen(false);
      // "attempted", never "sent" — the RPC returns before pg_net actually delivers and
      // cannot know the outcome. Claiming delivery here would be the same lie as
      // chaseNoResponders' toast.
      setChaseResult(res);
      setTimeout(() => setChaseResult(null), 5000);
    } catch (e) {
      console.error("PaymentsScreen: chase send failed", e);
      setChaseErr(chaseError(e));
    } finally {
      setChaseBusy(false);
      chasingRef.current = false;
    }
  };

  const activePlayers = squad.filter(p => !p.disabled && !p.isGuest);
  const guestPlayers  = squad.filter(p => p.isGuest && !p.disabled && !isDormantGuest(p));

  const byName = (a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name);

  const owesSection = activePlayers
    .filter(p => (p.owes || 0) > 0)
    .sort((a, b) => (b.owes || 0) - (a.owes || 0));

  // paid = admin-CONFIRMED only (mig 211). A self-claim still has owes > 0 and lands
  // in owesSection (with a "claims paid · CONFIRM" action), i.e. still outstanding.
  const unpaidIn = activePlayers
    .filter(p => !(p.owes > 0) && p.status === 'in' && !p.paid)
    .sort(byName);

  const paidUp = activePlayers
    .filter(p => !(p.owes > 0) && p.paid)
    .sort(byName);

  const notPlaying = activePlayers
    .filter(p => !(p.owes > 0) && !p.paid && p.status !== 'in')
    .sort(byName);

  const totalOwed = activePlayers.reduce((s, p) => s + (p.owes || 0), 0);
  const paidCount = activePlayers.filter(p => p.paid).length;

  const rowProps = { adminToken, schedule, setSquad, openMenuId, setOpenMenuId };

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:40 }}>

      {/* Header */}
      <div style={{ padding:"calc(12px + env(safe-area-inset-top)) 16px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer",
            padding:0, display:"flex", alignItems:"center", color:"var(--t2)" }}>
            <ArrowLeft size={20} weight="thin" />
          </button>
          <div style={{ fontFamily:"var(--font-display)", fontSize:28,
            letterSpacing:"0.06em", color:"var(--gold)",
            textShadow:"0 0 18px rgba(232,160,32,0.22)" }}>
            PAYMENTS
          </div>
        </div>

        {/* Summary chips — glass */}
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
          <div style={{ padding:"6px 14px", borderRadius:"var(--r-pill)",
            background:"rgba(255,64,64,0.10)", backdropFilter:"blur(10px)",
            WebkitBackdropFilter:"blur(10px)",
            border:"0.5px solid var(--redb)",
            fontFamily:"var(--font-display)", fontSize:14, fontWeight:600, letterSpacing:"0.08em",
            color:"var(--t1)" }}>
            £{totalOwed} OUTSTANDING
          </div>
          <div style={{ padding:"6px 14px", borderRadius:"var(--r-pill)",
            background:"rgba(61,220,106,0.10)", backdropFilter:"blur(10px)",
            WebkitBackdropFilter:"blur(10px)",
            border:"0.5px solid var(--greenb)",
            fontFamily:"var(--font-display)", fontSize:14, fontWeight:600, letterSpacing:"0.08em",
            color:"var(--t1)" }}>
            {paidCount === 1 ? "1 PLAYER PAID" : `${paidCount} PLAYERS PAID`}
          </div>
        </div>
      </div>

      {/* Section 1: OWES MONEY — red glow */}
      {owesSection.length > 0 && (
        <>
          <SectionLabel color="var(--red)" glow="0 0 14px rgba(255,64,64,0.30)">
            OWES MONEY · {owesSection.length}
          </SectionLabel>
          <PlayerCard accent="rgba(255,64,64,0.12)">
            {owesSection.map((p, i) => (
              <PlayerRow key={p.id} player={p} idx={i} {...rowProps} />
            ))}
            {/* Chase footer — lives INSIDE the card so it self-hides with the section
                (no debtors → no card → no orphan button), inherits the red accent, and
                sits with the people it acts on. Deliberately NOT an Actions tile: that
                list is this-week's-match actions, and debt is a cross-week concept. */}
            {adminToken && (
              <button onClick={openChase} disabled={chaseBusy}
                style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center",
                  gap:8, padding:"13px 0", background:"transparent", border:"none",
                  borderTop:"0.5px solid var(--b2)", color:"var(--red)",
                  fontFamily:"var(--font-body)", fontSize:13, fontWeight:600,
                  cursor: chaseBusy ? "wait" : "pointer", opacity: chaseBusy ? 0.5 : 1 }}>
                <Megaphone size={16} weight="thin" />
                {chaseBusy ? "Checking…" : "Chase everyone who owes"}
              </button>
            )}
          </PlayerCard>
        </>
      )}

      {/* Result — the honest count. "attempted", never "sent". */}
      {chaseResult && (
        <div style={{ margin:"0 16px 12px", padding:"10px 12px", borderRadius:"var(--rs)",
          background:"rgba(61,220,106,0.10)", border:"0.5px solid var(--greenb)",
          fontSize:12, color:"var(--t1)", fontWeight:300 }}>
          Chased {chaseResult.attempted_count}
          {chaseResult.unreachable?.length > 0 && ` · ${chaseResult.unreachable.length} couldn't be reached`}
          {chaseResult.suppressed_count > 0 && ` · ${chaseResult.suppressed_count} already chased today`}
        </div>
      )}

      {chaseOpen && (
        <ChaseSheet
          preview={chasePreview}
          squad={squad}
          quietHours={inQuiet}
          sending={chaseBusy}
          error={chaseErr}
          onSend={sendChase}
          onClose={() => { setChaseOpen(false); setChaseErr(null); }}
        />
      )}

      {/* Section 2: IN — NOT YET PAID — amber glow */}
      {unpaidIn.length > 0 && (
        <>
          <SectionLabel color="var(--amber)" glow="0 0 14px rgba(255,176,32,0.28)">
            IN — NOT YET PAID · {unpaidIn.length}
          </SectionLabel>
          <FirstTimeHint
            storageKey="ioo_hint_payments_pay"
            placement="bottom"
            title="MARK AS PAID"
            body="Tap the gold £X PAY button to mark a player as paid. Anything still owing carries over as debt."
          >
            <PlayerCard accent="rgba(255,176,32,0.10)">
              {unpaidIn.map((p, i) => (
                <PlayerRow key={p.id} player={p} idx={i} {...rowProps} />
              ))}
            </PlayerCard>
          </FirstTimeHint>
        </>
      )}

      {/* Section 3: PAID UP — green glow */}
      {paidUp.length > 0 && (
        <>
          <SectionLabel color="var(--green)" glow="0 0 14px rgba(61,220,106,0.28)">
            PAID UP · {paidUp.length}
          </SectionLabel>
          <PlayerCard accent="rgba(61,220,106,0.10)">
            {paidUp.map((p, i) => (
              <PlayerRow key={p.id} player={p} idx={i} {...rowProps} />
            ))}
          </PlayerCard>
        </>
      )}

      {/* Section 4: NOT PLAYING — always shown, collapsed by default */}
      <SectionLabel>NOT PLAYING · {notPlaying.length}</SectionLabel>
      <div style={{ margin:"0 16px 12px" }}>
        <div style={{
          background:"rgba(255,255,255,0.03)",
          backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
          border:"0.5px solid var(--border-subtle)",
          borderRadius:"var(--r)", overflow:"hidden" }}>
          <div onClick={() => setShowNotPlaying(o => !o)}
            style={{ padding:"12px 16px", display:"flex", alignItems:"center",
              justifyContent:"space-between", cursor:"pointer",
              WebkitTapHighlightColor:"transparent" }}>
            <span style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>
              {showNotPlaying
                ? "Hide players"
                : `Show ${notPlaying.length} player${notPlaying.length !== 1 ? "s" : ""}`}
            </span>
            {showNotPlaying
              ? <CaretUp   size={14} weight="thin" color="var(--t2)"/>
              : <CaretDown size={14} weight="thin" color="var(--t2)"/>
            }
          </div>
          {/* NOT PLAYING rows are full PlayerRows — tappable, with the ledger and per-week
              Mark paid — not the inert avatar+name+pill <div> they used to be.
              WHY THIS MATTERED: this section is where the invisible debtors live. notPlaying
              is filtered on `!(p.owes > 0)`, and players.owes is a CACHE that only recomputes
              when an admin confirms/resets a payment for that player — so anyone never
              touched keeps owes=0 forever while their unpaid ledger rows pile up, and lands
              HERE instead of in OWES MONEY. On the operator's real squad that was 8 players
              and £165 (Karan £30 across 6 games, showing as owing nothing).
              With the old read-only <div> there was NO WAY to open their ledger and settle
              it — the per-week Mark paid couldn't reach the exact players who needed it, so
              the cache could never heal for them. Found by the operator's walk 2026-07-16:
              "tapping on his name, or any in the not playing, does not open their ledger". */}
          {showNotPlaying && notPlaying.map((p, i) => (
            <PlayerRow key={p.id} player={p} idx={i} {...rowProps} />
          ))}
        </div>
      </div>

      {/* Guests */}
      <SectionLabel>GUESTS</SectionLabel>
      <PlayerCard>
        {guestPlayers.length === 0 ? (
          <div style={{ padding:"12px 16px", fontSize:13, color:"var(--t2)", fontWeight:300 }}>
            No guests this week
          </div>
        ) : guestPlayers.map((p, i) => {
          const host = squad.find(h => h.id === p.guestOf);
          return (
            <PlayerRow key={p.id} player={p} idx={i} {...rowProps}
              isGuest hostName={host?.nickname || host?.name || null} />
          );
        })}
      </PlayerCard>

      {/* Cover Pool */}
      {coverPool.length > 0 && (
        <>
          <SectionLabel>COVER POOL</SectionLabel>
          <PlayerCard>
            {coverPool.map((cp, i) => (
              <div key={cp.id} style={{ display:"flex", alignItems:"center",
                padding:"10px 16px", borderTop: i === 0 ? "none" : "0.5px solid var(--b2)", gap:10 }}>
                <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0,
                  background:"var(--s3)", border:"0.5px solid var(--border-subtle)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:9, fontWeight:600, color:"var(--t2)" }}>
                  {ini(cp.name)}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:"var(--t1)", fontWeight:400 }}>{cp.name}</div>
                  <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300 }}>
                    {cp.played} game{cp.played !== 1 ? "s" : ""}
                  </div>
                </div>
                {cp.owes > 0 && (
                  <span style={{ fontSize:10, fontWeight:600, padding:"2px 7px",
                    borderRadius:"var(--r-pill)", background:"var(--red2)",
                    border:"0.5px solid var(--redb)", color:"var(--red)" }}>
                    £{cp.owes}
                  </span>
                )}
              </div>
            ))}
          </PlayerCard>
        </>
      )}
    </div>
  );
}
