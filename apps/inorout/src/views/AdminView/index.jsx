import { useState, useEffect, useRef } from "react";
import {
  sendTemplate, notificationTemplates,
  getPaymentState,
  handleMarkPaid, handleResetPayment,
  toggleViceCaptain,
  confirmPayment,
  getPlayerLeagueTable,
  reopenWeek,
} from "@platform/core";
import {
  deletePlayer,
  resetPlayerToken, insertPlayerInjury, clearPlayerInjury, getPlayerInjuries,
  closePOTMVoting, setPlayerNickname,
  upsertSchedule, adminCancelMatch, addPlayerToTeam,
  getRecentNotification,
} from "@platform/supabase";
import {
  CaretRight, Megaphone, XCircle, PaperPlaneTilt,
  UsersThree, FlagCheckered, UserList, CalendarBlank,
  Bell, TShirt, Users, ArrowLeft, Link as LinkIcon,
  PencilSimple, Bandaids, Money,
} from "@phosphor-icons/react";
import NavBar      from "../../components/ui/NavBar.jsx";
import TeamsScreen    from "./TeamsScreen.jsx";
import ScoreScreen    from "./ScoreScreen.jsx";
import BibsScreen     from "./BibsScreen.jsx";
import SquadScreen    from "./SquadScreen.jsx";
import ScheduleScreen   from "./ScheduleScreen.jsx";
import RemindersScreen  from "./RemindersScreen.jsx";
import PaymentsScreen   from "./PaymentsScreen.jsx";

// ── Admin POTM Tiebreak Modal ─────────────────────────────────────────────────
function POTMTiebreakModal({ match, squad, teamId, adminToken, onDecide }) {
  const [selected,   setSelected]   = useState(null);
  const [phase,      setPhase]      = useState("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);

  const tiedIds    = match.tiedCandidates || [];
  const candidates = tiedIds.map(id => squad.find(p => p.id === id)).filter(Boolean);

  const handleLock = async () => {
    if (!selected) return;
    if (phase === "selected") { setPhase("confirming"); return; }
    setSubmitting(true);
    try {
      await closePOTMVoting(adminToken, match.id, selected.id, true);
      // Send potmResult push — notify attendees only (tiedCandidates = all eligible players set by cron)
      const attendeeIds = pendingTiebreak?.tiedCandidates || [];
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "potmResult", teamId,
          playerIds: attendeeIds,
          payload: { title: "🏆 POTM Result", body: `${selected.nickname || selected.name} wins POTM tonight!`, winnerId: selected.id, winnerName: selected.nickname || selected.name },
        }),
      }).catch(console.error);
      onDecide();
    } catch(e) {
      setError("Failed to submit. Try again.");
      setPhase("selected");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.9)", backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 380, background: "var(--s1)", borderRadius: 20,
        boxShadow: "0 0 0 1px var(--goldb), 0 0 60px rgba(232,160,32,0.2)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "20px 20px 16px", textAlign: "center", borderBottom: "0.5px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--gold)", letterSpacing: "0.05em" }}>
            POTM TIE — YOUR CALL
          </div>
          <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 6, fontWeight: 300 }}>
            The lads couldn't decide. You pick.
          </div>
        </div>
        <div style={{ padding: "16px 20px 20px" }}>
          {candidates.map(player => {
            const isSel = selected?.id === player.id;
            const isConf = isSel && phase === "confirming";
            return (
              <div key={player.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", borderRadius: 10,
                background: isSel ? "var(--gold2)" : "var(--s2)",
                border: `0.5px solid ${isSel ? "var(--goldb)" : "rgba(255,255,255,0.06)"}`,
                marginBottom: 8,
              }}>
                <span style={{ fontSize: 14, color: "var(--t1)", fontWeight: 400 }}>{player.nickname || player.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {isSel && (
                    <button onClick={() => { setSelected(null); setPhase("idle"); }}
                      style={{ fontSize: 11, color: "var(--red)", background: "none",
                        border: "0.5px solid rgba(255,64,64,0.3)", borderRadius: 6,
                        padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
                      Change
                    </button>
                  )}
                  <button
                    onClick={() => { if (!isSel) { setSelected(player); setPhase("selected"); } else handleLock(); }}
                    disabled={submitting}
                    style={{
                      fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 8,
                      cursor: submitting ? "not-allowed" : "pointer",
                      background: isSel ? (isConf ? "var(--gold)" : "rgba(232,160,32,0.2)") : "transparent",
                      color: isSel ? (isConf ? "var(--bg)" : "var(--gold)") : "var(--t2)",
                      border: isSel
                        ? (isConf ? "none" : "0.5px solid rgba(232,160,32,0.4)")
                        : "0.5px solid rgba(255,255,255,0.1)",
                    }}>
                    {isSel ? (isConf ? "Lock In ✓" : "Confirm →") : "Pick"}
                  </button>
                </div>
              </div>
            );
          })}
          {error && <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center", marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

// ── inject animation ──────────────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("adm-styles")) {
  const el = document.createElement("style");
  el.id = "adm-styles";
  el.textContent = `@keyframes ioo-blink{0%,100%{opacity:1}50%{opacity:0.3}}`;
  document.head.appendChild(el);
}

// ── helpers ───────────────────────────────────────────────────────────────────
function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.14em",
      textTransform:"uppercase", color:"var(--t2)",
      margin:"16px 0 8px", display:"flex", alignItems:"center", gap:8 }}>
      {children}
      <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,0.06)" }}/>
    </div>
  );
}

// ── PlayerProfile ─────────────────────────────────────────────────────────────
function PlayerProfile({ player, squad, schedule, teamId, adminToken, setSquad, onBack, me, isViceCaptain }) {
  const [injuries,    setInjuries]    = useState([]);
  const [showInj,     setShowInj]     = useState(false);
  const [editingNick, setEditingNick] = useState(false);
  const [nickname,    setNickname]    = useState(player.nickname || "");
  const [nickError,   setNickError]   = useState(null);
  const [nickSaving,  setNickSaving]  = useState(false);
  const [linkCopied,  setLinkCopied]  = useState(false);
  const [newToken,    setNewToken]    = useState(null);
  const [removing,    setRemoving]    = useState(false);

  useEffect(() => {
    if (showInj) getPlayerInjuries(player.id).then(setInjuries).catch(() => {});
  }, [showInj, player.id]);

  const p  = squad.find(s => s.id === player.id) || player;
  const ps = getPaymentState(p);

  const copyLink = async () => {
    const url = `${window.location.origin}/p/${newToken || p.token}`;
    try { await navigator.clipboard.writeText(url); } catch {}
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const saveNick = async () => {
    setNickSaving(true); setNickError(null);
    try {
      await setPlayerNickname(adminToken, p.id, nickname);
      const trimmed = nickname.trim() || null;
      setSquad(sq => sq.map(s => s.id === p.id ? { ...s, nickname: trimmed } : s));
      setEditingNick(false);
    } catch(e) {
      setNickError(e?.code === "nickname_taken" ? "Already taken on this squad" : "Failed to save");
    } finally {
      setNickSaving(false);
    }
  };

  const handleMarkInjured = async () => {
    try {
      await insertPlayerInjury(adminToken, p.id);
      setSquad(sq => sq.map(s => s.id === p.id
        ? { ...s, injured: true, injuredSince: new Date().toISOString(), status: "out" } : s));
    } catch(e) { console.error(e); }
  };

  const handleClearInj = async () => {
    try {
      await clearPlayerInjury(adminToken, p.id);
      setSquad(sq => sq.map(s => s.id === p.id
        ? { ...s, injured: false, injuredSince: null } : s));
    } catch(e) { console.error(e); }
  };

  const handleResetLink = async () => {
    try { const tok = await resetPlayerToken(adminToken, p.id); setNewToken(tok); }
    catch(e) { console.error(e); }
  };

  const handleRemove = async () => {
    if (!removing) { setRemoving(true); setTimeout(() => setRemoving(false), 3000); return; }
    try {
      await deletePlayer(adminToken, p.id);
      setSquad(sq => sq.filter(s => s.id !== p.id));
      onBack();
    } catch(e) { console.error(e); }
  };

  const STATUS_BADGE = {
    in:      { label:"✓ In",      bg:"var(--green2)",  border:"var(--greenb)",  color:"var(--green)"  },
    out:     { label:"✕ Out",     bg:"var(--red2)",    border:"var(--redb)",    color:"var(--red)"    },
    maybe:   { label:"? Maybe",   bg:"var(--amber2)",  border:"var(--amberb)",  color:"var(--amber)"  },
    reserve: { label:"↓ Reserve", bg:"var(--purple2)", border:"var(--purpleb)", color:"var(--purple)" },
  };
  const sb = STATUS_BADGE[p.status];

  const card = (content, mb = 8) => (
    <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
      borderRadius:"var(--r)", overflow:"hidden", marginBottom:mb }}>
      {content}
    </div>
  );

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:110 }}>

      {/* Sticky header */}
      <div style={{ position:"sticky", top:0, zIndex:50, background:"var(--bg)",
        borderBottom:"0.5px solid var(--b2)", padding:"12px 16px",
        display:"flex", alignItems:"center", gap:12 }}>
        <div onClick={onBack} style={{ display:"flex", alignItems:"center", gap:4,
          cursor:"pointer", color:"var(--gold)", WebkitTapHighlightColor:"transparent" }}>
          <ArrowLeft size={20} weight="thin"/>
        </div>
        <div style={{ fontFamily:"var(--font-display)", fontSize:22, letterSpacing:"0.04em",
          color:"var(--t1)", lineHeight:1 }}>
          {p.nickname || p.name}
        </div>
        {p.injured && (
          <span style={{ fontSize:11, color:"var(--red)", background:"var(--red2)",
            border:"0.5px solid var(--redb)", borderRadius:"var(--r-pill)",
            padding:"2px 8px", marginLeft:"auto" }}>Injured</span>
        )}
      </div>

      <div style={{ padding:"12px 16px 0" }}>

        {/* Identity card */}
        {card(<>
          <div style={{ padding:"14px 16px", display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:48, height:48, borderRadius:"50%", flexShrink:0,
              background:"var(--s3)", border:"0.5px solid var(--border-subtle)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:16, fontWeight:600, color:"var(--t2)" }}>
              {initials(p.name)}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"var(--font-display)", fontSize:28,
                letterSpacing:"0.03em", lineHeight:1, color:"var(--t1)" }}>
                {p.nickname || p.name}
              </div>
              {editingNick ? (
                <div style={{ marginTop:5 }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <input value={nickname} onChange={e => { setNickname(e.target.value); setNickError(null); }}
                      placeholder="Add nickname" autoFocus
                      onKeyDown={e => e.key === "Enter" && saveNick()}
                      style={{ flex:1, background:"var(--s3)", border:`0.5px solid ${nickError ? "var(--red)" : "var(--border-subtle)"}`,
                        borderRadius:"var(--rs)", padding:"5px 8px", fontSize:12, color:"var(--t1)",
                        fontFamily:"var(--font-body)", outline:"none" }}/>
                    <button onClick={saveNick} disabled={nickSaving} style={{ background:"var(--gold)", color:"var(--black)",
                      border:"none", borderRadius:"var(--rs)", padding:"5px 10px", fontSize:11,
                      fontWeight:600, cursor: nickSaving ? "not-allowed" : "pointer", fontFamily:"var(--font-body)",
                      opacity: nickSaving ? 0.6 : 1 }}>
                      {nickSaving ? "…" : "Save"}
                    </button>
                    <button onClick={() => { setEditingNick(false); setNickError(null); }} style={{ background:"transparent",
                      border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)",
                      padding:"5px 8px", fontSize:11, color:"var(--t2)", cursor:"pointer",
                      fontFamily:"var(--font-body)" }}>✕</button>
                  </div>
                  {nickError && (
                    <div style={{ fontSize:11, color:"var(--red)", marginTop:4, fontWeight:300 }}>{nickError}</div>
                  )}
                </div>
              ) : (
                <div onClick={() => setEditingNick(true)}
                  style={{ display:"flex", alignItems:"center", gap:6, marginTop:3, cursor:"pointer" }}>
                  <span style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>
                    {p.nickname ? `"${p.nickname}"` : "Add nickname"}
                  </span>
                  <PencilSimple size={12} weight="thin" color="var(--t2)"/>
                </div>
              )}
            </div>
          </div>

          {/* Player link */}
          {(p.token || newToken) && (
            <div style={{ padding:"10px 16px", borderTop:"0.5px solid var(--b2)",
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <span style={{ fontSize:11, color:"var(--t2)", fontWeight:300, flex:1,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {window.location.origin}/p/{newToken || p.token}
              </span>
              <div onClick={copyLink} style={{ display:"flex", alignItems:"center", gap:4,
                padding:"4px 10px", borderRadius:"var(--r-pill)", cursor:"pointer",
                background:"var(--s2)", border:"0.5px solid var(--border-subtle)",
                flexShrink:0 }}>
                <LinkIcon size={12} weight="thin" color={linkCopied ? "var(--green)" : "var(--t2)"}/>
                <span style={{ fontSize:10, color: linkCopied ? "var(--green)" : "var(--t2)" }}>
                  {linkCopied ? "Copied!" : "Copy"}
                </span>
              </div>
            </div>
          )}
        </>)}

        {/* Career stats */}
        {card(
          <div style={{ display:"flex" }}>
            {[
              { label:"Played", val: p.attended   || 0 },
              { label:"Goals",  val: p.goals       || 0 },
              { label:"POTM",   val: p.motm        || 0 },
              { label:"Bibs",   val: p.bibCount    || 0 },
              { label:"Late",   val: p.lateDropouts|| 0 },
            ].map(({ label, val }, i) => (
              <div key={label} style={{ flex:1, textAlign:"center", padding:"10px 0",
                borderRight: i < 4 ? "0.5px solid var(--b2)" : "none" }}>
                <div style={{ fontFamily:"var(--font-display)", fontSize:24,
                  lineHeight:1, color:"var(--t1)" }}>{val}</div>
                <div style={{ fontSize:9, color:"var(--t2)", fontWeight:300,
                  letterSpacing:"0.06em", textTransform:"uppercase", marginTop:2 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* This Game */}
        {card(<>
          <div style={{ padding:"12px 16px", display:"flex",
            justifyContent:"space-between", alignItems:"center",
            borderBottom: sb ? "0.5px solid var(--b2)" : "none" }}>
            <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300,
              textTransform:"uppercase", letterSpacing:"0.1em" }}>This Game</div>
            {sb && (
              <div style={{ padding:"5px 12px", borderRadius:"var(--r-pill)", fontSize:12,
                background:sb.bg, border:`0.5px solid ${sb.border}`, color:sb.color }}>
                {sb.label}
              </div>
            )}
          </div>
          <div style={{ padding:"10px 16px" }}>
            <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:
              (p.status === 'in' && ps !== 'paid') ? 8 : 0 }}>
              {ps === 'paid'         ? "✓ Paid" :
               ps === 'cash_pending' ? "Cash pending confirmation" :
               p.owes > 0           ? `Owes £${p.owes + (p.status === 'in' ? (schedule.pricePerPlayer || 0) : 0)}` :
               p.status === 'in'    ? `£${schedule.pricePerPlayer || 0} due this week` :
               "Nothing owed"}
            </div>
            {p.status === 'in' && ps !== 'paid' && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <button onClick={async () => {
                  try { await confirmPayment(adminToken, p.id, schedule?.activeMatchId || null); }
                  catch(e) { console.error(e); return; }
                  setSquad(sq => sq.map(s => s.id === p.id
                    ? { ...s, selfPaid:true, paidBy:'admin' } : s));
                }} style={{ padding:"6px 12px", borderRadius:"var(--r-pill)", border:"none",
                  background:"var(--gold)", color:"var(--black)", fontSize:11, fontWeight:600,
                  cursor:"pointer", fontFamily:"var(--font-body)" }}>
                  Mark Cash Paid
                </button>
                {(p.paid || p.selfPaid) && (
                  <button onClick={async () => {
                    await handleResetPayment(adminToken, p.id, schedule.activeMatchId || null).catch(console.error);
                    setSquad(sq => sq.map(s => s.id === p.id
                      ? { ...s, paid:false, selfPaid:false, paidBy:null } : s));
                  }} style={{ padding:"6px 12px", borderRadius:"var(--r-pill)",
                    border:"0.5px solid var(--border-subtle)", background:"transparent",
                    color:"var(--t2)", fontSize:11, cursor:"pointer",
                    fontFamily:"var(--font-body)" }}>
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>
        </>)}

        {/* Injury history */}
        {card(<>
          <div onClick={() => setShowInj(o => !o)}
            style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"0 14px", minHeight:48, cursor:"pointer",
              borderBottom: showInj ? "0.5px solid var(--b2)" : "none" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Bandaids size={16} weight="thin" color={p.injured ? "var(--red)" : "var(--t2)"}/>
              <span style={{ fontSize:12, color: p.injured ? "var(--red)" : "var(--t2)" }}>
                {p.injured ? "Currently Injured" : "Injury History"}
              </span>
            </div>
            <CaretRight size={14} weight="thin" color="var(--t2)"
              style={{ transform: showInj ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}/>
          </div>
          {showInj && (
            injuries.length === 0
              ? <div style={{ padding:"10px 16px", fontSize:12, color:"var(--t2)", fontWeight:300 }}>
                  No injuries recorded.
                </div>
              : injuries.map(inj => {
                  const from = new Date(inj.injured_at);
                  const to   = inj.cleared_at ? new Date(inj.cleared_at) : new Date();
                  const days = Math.max(0, Math.round((to - from) / 86400000));
                  return (
                    <div key={inj.id} style={{ padding:"10px 16px", borderBottom:"0.5px solid var(--b2)" }}>
                      <div style={{ fontSize:12, color:"var(--t1)" }}>
                        {from.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
                        {inj.cleared_at
                          ? ` → ${new Date(inj.cleared_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`
                          : " → ongoing"}
                      </div>
                      <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:2 }}>
                        {days} day{days !== 1 ? "s" : ""}
                        {inj.marked_by ? ` · marked by ${inj.marked_by}` : ""}
                      </div>
                    </div>
                  );
                })
          )}
        </>)}

        {/* ROLES */}
        {!p.isGuest && !isViceCaptain && (
          <>
            <div style={{ fontFamily:"'Bebas Neue', sans-serif", fontSize:13, color:"var(--t2)",
              letterSpacing:"0.08em", marginTop:20, marginBottom:10 }}>
              ROLES
            </div>
            {card(
              <div style={{ padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ flex:1, paddingRight:16 }}>
                  <div style={{ fontFamily:"'DM Sans', sans-serif", fontWeight:400, fontSize:14, color:"var(--t1)" }}>
                    Vice Captain
                  </div>
                  <div style={{ fontFamily:"'DM Sans', sans-serif", fontWeight:400, fontSize:12, color:"var(--t2)", marginTop:2 }}>
                    Can access admin view and manage the team
                  </div>
                </div>
                {p.id === me?.id ? (
                  <span style={{ fontFamily:"'DM Sans', sans-serif", fontWeight:400, fontSize:13,
                    color:"var(--gold)", flexShrink:0 }}>
                    You're the Admin
                  </span>
                ) : (
                  <div
                    onClick={async () => {
                      const newVal = !p.isViceCaptain;
                      setSquad(sq => sq.map(s => s.id === p.id ? { ...s, isViceCaptain: newVal } : s));
                      try {
                        await toggleViceCaptain(adminToken, p.id, newVal);
                      } catch {
                        setSquad(sq => sq.map(s => s.id === p.id ? { ...s, isViceCaptain: !newVal } : s));
                      }
                    }}
                    style={{
                      width:44, height:24, borderRadius:12, flexShrink:0,
                      background: p.isViceCaptain ? "var(--gold)" : "var(--s3)",
                      cursor:"pointer", position:"relative",
                    }}
                  >
                    <div style={{
                      position:"absolute", top:2,
                      left: p.isViceCaptain ? 22 : 2,
                      width:20, height:20, borderRadius:"50%",
                      background:"var(--t1)",
                    }}/>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        {card(<>
          {[
            { label: newToken ? "Link reset — copy above" : "Reset Player Link",
              color: newToken ? "var(--green)" : "var(--t2)", action: handleResetLink },
            { label: p.injured ? "Clear Injury" : "Mark as Injured",
              color: p.injured ? "var(--green)" : "var(--red)",
              action: p.injured ? handleClearInj : handleMarkInjured },
            p.attended > 0
              ? { label:"Has match history — use Disable instead", color:"var(--t2)", action:null, disabled:true }
              : { label: removing ? "Tap again to confirm remove" : "Remove from Squad", color:"var(--red)", action: handleRemove },
          ].map(({ label, color, action, disabled }, i) => (
            <div key={i} onClick={disabled ? undefined : action}
              style={{ padding:"14px 16px", cursor: disabled ? "default" : "pointer",
                borderBottom: i < 2 ? "0.5px solid var(--b2)" : "none",
                fontSize:13, color, opacity: disabled ? 0.4 : 1,
                pointerEvents: disabled ? "none" : "auto" }}>
              {label}
            </div>
          ))}
        </>)}
      </div>
    </div>
  );
}

// ── AnnounceModal ─────────────────────────────────────────────────────────────
function AnnounceModal({ squad, settings, teamId, schedule, onClose }) {
  const [targets, setTargets] = useState(new Set(["in", "maybe", "reserve"]));
  const [msg,     setMsg]     = useState("");

  const groups = [
    { key:"in",      label:"In",          players: squad.filter(p => p.status==="in"      && !p.disabled && !p.injured) },
    { key:"out",     label:"Out",         players: squad.filter(p => p.status==="out"     && !p.disabled && !p.injured) },
    { key:"maybe",   label:"Maybe",       players: squad.filter(p => p.status==="maybe"   && !p.disabled && !p.injured) },
    { key:"reserve", label:"Reserve",     players: squad.filter(p => p.status==="reserve" && !p.disabled && !p.injured) },
    { key:"none",    label:"No Response", players: squad.filter(p => p.status==="none"    && !p.disabled && !p.injured) },
    { key:"injured", label:"Injured",     players: squad.filter(p => p.injured && !p.disabled) },
  ];

  const toggle = (key) => setTargets(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const selectedCount = groups.reduce((sum, g) => targets.has(g.key) ? sum + g.players.length : sum, 0);

  const send = () => {
    if (!msg.trim() || !selectedCount) return;
    const ids = groups.filter(g => targets.has(g.key)).flatMap(g => g.players.map(p => p.id));
    fetch("/api/notify", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        type:"announce", teamId, playerIds: ids,
        payload: { title: settings?.groupName || "In or Out ⚽", body: msg, icon:"/icons/icon-192.png" },
        gameDate: schedule.gameDateTime?.split("T")[0],
      }),
    }).catch(console.error);
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200 }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)" }}/>
      <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430, background:"var(--s1)",
        borderRadius:"var(--r) var(--r) 0 0", padding:"20px 16px 44px",
        border:"0.5px solid var(--border-subtle)" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:26, letterSpacing:"0.04em",
          marginBottom:16, color:"var(--t1)" }}>Announce to Squad</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
          {groups.map(({ key, label, players }) => {
            const checked = targets.has(key);
            return (
              <div key={key} onClick={() => toggle(key)}
                style={{ display:"flex", alignItems:"center",
                  justifyContent:"space-between", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:18, height:18, borderRadius:4,
                    border:`0.5px solid ${checked ? "var(--green)" : "var(--border-subtle)"}`,
                    background: checked ? "var(--green2)" : "transparent",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    flexShrink:0 }}>
                    {checked && <span style={{ fontSize:10, color:"var(--green)" }}>✓</span>}
                  </div>
                  <span style={{ fontSize:13, color:"var(--t1)" }}>{label}</span>
                </div>
                <span style={{ fontSize:12, color:"var(--t2)", fontWeight:300 }}>{players.length}</span>
              </div>
            );
          })}
        </div>
        <textarea value={msg} onChange={e => setMsg(e.target.value)}
          placeholder="Write your message..."
          rows={3}
          style={{ width:"100%", background:"var(--s2)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--rs)", padding:"10px 12px", fontSize:13, color:"var(--t1)",
            fontFamily:"var(--font-body)", outline:"none", resize:"none",
            marginBottom:12, boxSizing:"border-box" }}/>
        <button onClick={send} disabled={!msg.trim() || !selectedCount}
          style={{ width:"100%", padding:"13px 0", borderRadius:"var(--r)", border:"none",
            background: msg.trim() && selectedCount ? "var(--gold)" : "var(--s3)",
            color: msg.trim() && selectedCount ? "var(--black)" : "var(--t2)",
            fontFamily:"var(--font-body)", fontSize:14, fontWeight:600,
            cursor: msg.trim() && selectedCount ? "pointer" : "not-allowed" }}>
          Send to {selectedCount} player{selectedCount !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────
export default function AdminView({
  squad, setSquad, bibHistory, setBibHistory,
  schedule, setSchedule, matchHistory, setMatchHistory,
  settings, setSettings, coverPool, setCoverPool, teamId,
  screen, setScreen, onGoPlayer, onGoStats, onGoHistory, onGoMyIO,
  isDemoMode = false, onResetDemo, isViceCaptain = false, me = null,
  adminToken = null,
}) {
  const [showCancel,       setShowCancel]       = useState(false);
  const [demoResetState,   setDemoResetState]   = useState(null);
  const [cancelReason,     setCancelReason]     = useState("");
  const [cancelLoading,    setCancelLoading]    = useState(false);
  const [gameOpenLoading,  setGameOpenLoading]  = useState(false);
  const cancelWeekRef = useRef(null);
  const [dragId,           setDragId]           = useState(null);
  const [dismissedOrphans, setDismissedOrphans] = useState(new Set());
  const [selectedPlayer,   setSelectedPlayer]   = useState(null);
  const [openSections,     setOpenSections]     = useState(
    { in:true, reserve:true, maybe:true, out:false, injured:false, noResp:false }
  );
  const [showCoverPool,    setShowCoverPool]    = useState(false);
  const [showAnnounce,     setShowAnnounce]     = useState(false);
  const [chaseToast,       setChaseToast]       = useState(false);
  const [chaseRecentMsg,   setChaseRecentMsg]   = useState(null);
  const [tiebreakDismissed, setTiebreakDismissed] = useState(false);
  const [gameLiveHintDismissed, setGameLiveHintDismissed] = useState(
    () => !!localStorage.getItem('ioo_game_live_hint_dismissed')
  );
  // Win-rate data for the Group Balancer prediction. Fetched here (rather
  // than in TeamsScreen) so the admin shell holds it once and survives
  // screen switches. StatsView still owns its own fetch — dedup is a
  // Phase 2 concern.
  const [tableData, setTableData] = useState({ players: [] });

  // Fetch tableData on mount (and when teamId resolves). All-time period
  // matches what generateBalancedTeams expects — predictions are based on
  // career win rates, not period-filtered.
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getPlayerLeagueTable(teamId, 'all');
        if (!cancelled) setTableData(result ?? { players: [] });
      } catch (err) {
        console.error('AdminView tableData fetch error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // ── derived ──────────────────────────────────────────────────────────────
  const inPlayers      = squad.filter(p => p.status==="in"      && !p.disabled && !p.injured);
  const reservePlayers = squad.filter(p => p.status==="reserve" && !p.disabled && !p.injured);
  const maybePlayers   = squad.filter(p => p.status==="maybe"   && !p.disabled && !p.injured);
  const outPlayers     = squad.filter(p => p.status==="out"     && !p.disabled && !p.injured);
  const injuredPlayers = squad.filter(p => p.injured && !p.disabled);
  const noRespPlayers  = squad.filter(p => p.status==="none"    && !p.disabled && !p.injured);
  const paidCount      = inPlayers.filter(p => p.paid || (p.selfPaid && p.paidBy)).length;
  const totalOwed      = squad.filter(p => !p.disabled).reduce((s, p) => s + (p.owes || 0), 0);
  const teamsSet       = inPlayers.filter(p => !p.isGuest).length > 0
                      && inPlayers.filter(p => !p.isGuest).every(p => p.team);
  const pendingResults = matchHistory.filter(m =>
    !m.cancelled && m.winner == null && new Date(m.matchDate) < new Date()
  ).length;
  const pendingTiebreak = !tiebreakDismissed
    ? matchHistory.find(m => m.adminDecisionPending && m.tiedCandidates?.length > 0)
    : null;
  const orphanedGuests = squad.filter(p =>
    p.isGuest && !p.disabled &&
    squad.find(h => h.id === p.guestOf)?.status !== "in" &&
    !dismissedOrphans.has(p.id)
  );
  const selfPaidPending = inPlayers.filter(p => p.selfPaid === true && p.paid !== true);

  const handleDemoReset = async () => {
    setDemoResetState("resetting");
    try { await onResetDemo?.(); } catch(e) { console.error(e); }
    setDemoResetState("done");
    setTimeout(() => setDemoResetState(null), 3000);
  };

  // ── functions (all preserved from original) ───────────────────────────────
  const dismissOrphan = (id) => setDismissedOrphans(prev => new Set([...prev, id]));
  const reserveGuest  = (id) => { setSquad(squad.map(p => p.id===id ? { ...p, status:"reserve" } : p)); dismissOrphan(id); };
  const removeGuest   = async (id) => {
    try { await deletePlayer(adminToken, id); setSquad(squad.filter(p => p.id !== id)); dismissOrphan(id); }
    catch(e) { console.error(e); }
  };

  const moveReserve = (fromId, toId) => {
    if (fromId === toId) return;
    const idxs    = squad.map((p, i) => ({ p, i })).filter(({ p }) => p.status==="reserve" && !p.disabled).map(({ i }) => i);
    const inOrder = idxs.map(i => squad[i]);
    const from    = inOrder.findIndex(p => p.id === fromId);
    const to      = inOrder.findIndex(p => p.id === toId);
    const reord   = [...inOrder];
    const [moved] = reord.splice(from, 1);
    reord.splice(to, 0, moved);
    const next = [...squad];
    idxs.forEach((si, i) => { next[si] = reord[i]; });
    setSquad(next);
  };

  const cancelWeek = async () => {
    try {
      setCancelLoading(true);

      await adminCancelMatch(adminToken, cancelReason);

      // Push notification to IN+MAYBE+RESERVE
      const notifyIds = squad
        .filter(p => ['in', 'maybe', 'reserve'].includes(p.status) && !p.injured && !p.disabled)
        .map(p => p.id);
      if (notifyIds.length) {
        fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'gameCancelled', teamId,
            playerIds: notifyIds,
            payload: {
              title: 'Game Cancelled',
              body: cancelReason
                ? `❌ ${schedule.dayOfWeek}'s game cancelled: ${cancelReason}`
                : `❌ ${schedule.dayOfWeek}'s game is cancelled.`,
              icon: '/icons/icon-192.png',
            },
            gameDate: schedule.gameDateTime?.split('T')[0],
          }),
        }).catch(console.error);
      }

      // Update local state
      setSquad(sq => sq.map(p => ({
        ...p, status: 'none', paid: false,
        selfPaid: false, paidBy: null, paidAt: null,
      })));
      setSchedule(s => ({
        ...s,
        isCancelled: true,
        gameIsLive: false,
        cancelReason,
        lineupLocked: false,
        activeMatchId: null,
        votingOpen: false,
        votingClosesAt: null,
      }));

      setShowCancel(false);
      setCancelReason('');

    } catch (err) {
      console.error('cancelWeek error:', err);
    } finally {
      setCancelLoading(false);
    }
  };

  const openNextWeek = async () => {
    setGameOpenLoading(true);
    try {
      // Cancel-then-relive needs the reopen RPC — admin_upsert_schedule
      // doesn't touch is_cancelled / active_match_id, so a plain
      // upsertSchedule leaves the schedule in a conflicting state.
      // Plain (non-cancelled) game-live flips stay on the cheap path.
      if (schedule.isCancelled) {
        const result = await reopenWeek(adminToken);
        setSchedule(s => ({
          ...s,
          isCancelled: false,
          gameIsLive: true,
          isDraft: false,
          cancelReason: null,
          activeMatchId: result?.match_id ?? s.activeMatchId,
        }));
      } else {
        await upsertSchedule(adminToken, { ...schedule, gameIsLive:true, isDraft:false });
        setSchedule(s => ({ ...s, gameIsLive:true, isDraft:false }));
      }
      sendTemplate(notificationTemplates.gameOpen, schedule.dayOfWeek);
      const ids = squad.filter(p => !p.disabled && !p.injured).map(p => p.id);
      fetch("/api/notify", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          type:"gameLive", teamId, playerIds: ids,
          payload: { title:"In or Out ⚽", body:`⚽ ${schedule.dayOfWeek}'s game is open — are you in or out?`, icon:"/icons/icon-192.png" },
          gameDate: schedule.gameDateTime?.split("T")[0],
        }),
      }).catch(console.error);
    } catch(e) {
      console.error('openNextWeek error:', e);
    } finally {
      setGameOpenLoading(false);
    }
  };

  // Toggle row only renders when game is NOT live (see JSX), so this
  // handler only needs the "turn on" path. Cancel This Week handles
  // going offline.
  const toggleGameLive = () => {
    if (!schedule.gameIsLive) openNextWeek();
  };

  const chaseNoResponders = async () => {
    const ids = noRespPlayers.map(p => p.id);
    if (!ids.length) return;
    const gameDate = schedule.gameDateTime?.split("T")[0] || new Date().toISOString().split("T")[0];
    const recentCount = await getRecentNotification(teamId, "chaseNoResp", gameDate, 120);
    if (recentCount > 0) {
      setChaseRecentMsg(`Already chased ${recentCount} time${recentCount > 1 ? "s" : ""} in the last 2 hours`);
      setTimeout(() => setChaseRecentMsg(null), 4000);
      return;
    }
    setChaseRecentMsg(null);
    fetch("/api/notify", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        type:"chaseNoResp", teamId, playerIds: ids,
        payload: { title:"In or Out ⚽", body:`⏰ Are you in or out for ${schedule.dayOfWeek}? Quick reply needed!`, icon:"/icons/icon-192.png" },
        gameDate,
      }),
    }).catch(console.error);
    setChaseToast(true);
    setTimeout(() => setChaseToast(false), 3000);
  };

  const handleClearInjury = async (p) => {
    try {
      await clearPlayerInjury(adminToken, p.id);
      setSquad(squad.map(s => s.id === p.id ? { ...s, injured:false, injuredSince:null } : s));
    } catch(e) { console.error(e); }
  };

  const markPaid = async (id) => {
    await handleMarkPaid(adminToken, id, schedule.activeMatchId || null).catch(console.error);
    setSquad(squad.map(p => p.id===id ? { ...p, paid:true } : p));
  };

  // ── screen routing ────────────────────────────────────────────────────────
  if (screen === "teams")    return <TeamsScreen    teamId={teamId} adminToken={adminToken} squad={squad} schedule={schedule} matchHistory={matchHistory} tableData={tableData} settings={settings} onBack={() => setScreen("main")}/>;
  if (screen === "score")    return <ScoreScreen    squad={squad} setSquad={setSquad} teamId={teamId} adminToken={adminToken} schedule={schedule} matchHistory={matchHistory} setMatchHistory={setMatchHistory} payments={Object.fromEntries(squad.map(p => [p.id, p.paid]))} bibHistory={bibHistory} onBack={() => setScreen("main")}/>;
  if (screen === "bibs")     return <BibsScreen     squad={squad} setSquad={setSquad} bibHistory={bibHistory} setBibHistory={setBibHistory} schedule={schedule} onBack={() => setScreen("main")}/>;
  if (screen === "squad")    return <SquadScreen    squad={squad} setSquad={setSquad} onBack={() => setScreen("main")} teamId={teamId} adminToken={adminToken} isViceCaptain={isViceCaptain} me={me} onPlayerTap={(p) => { setScreen("main"); setSelectedPlayer(p); }} squadSize={schedule?.squadSize || 14}/>;
  if (screen === "schedule") return <ScheduleScreen schedule={schedule} setSchedule={setSchedule} settings={settings} setSettings={setSettings} onBack={() => setScreen("main")} teamId={teamId} adminToken={adminToken}/>;
  if (screen === "reminders") return <RemindersScreen schedule={schedule} setSchedule={setSchedule} onBack={() => setScreen("main")} teamId={teamId} adminToken={adminToken}/>;
  if (screen === "payments")  return <PaymentsScreen squad={squad} setSquad={setSquad} schedule={schedule} teamId={teamId} adminToken={adminToken} coverPool={coverPool} onBack={() => setScreen("main")}/> ;

  if (selectedPlayer) return (
    <PlayerProfile
      player={selectedPlayer} squad={squad} schedule={schedule}
      teamId={teamId} adminToken={adminToken} setSquad={setSquad} onBack={() => setSelectedPlayer(null)}
      me={me} isViceCaptain={isViceCaptain}
    />
  );

  // ── helpers ───────────────────────────────────────────────────────────────
  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  const AV_STYLE = {
    in:      { bg:"var(--green2)",  border:"var(--greenb)",  color:"var(--green)"  },
    reserve: { bg:"var(--purple2)", border:"var(--purpleb)", color:"var(--purple)" },
    maybe:   { bg:"var(--amber2)",  border:"var(--amberb)",  color:"var(--amber)"  },
    out:     { bg:"var(--red2)",    border:"var(--redb)",    color:"var(--red)"    },
    injured: { bg:"var(--red2)",    border:"var(--redb)",    color:"var(--red)"    },
    noResp:  { bg:"rgba(255,255,255,0.05)", border:"var(--border-subtle)", color:"var(--t2)" },
  };

  const renderPlayerRow = (p, sectionKey, idx, isLast) => {
    const av   = AV_STYLE[sectionKey] || AV_STYLE.noResp;
    const host = p.isGuest ? squad.find(h => h.id === p.guestOf) : null;
    const sub  = p.note ? `"${p.note}"` :
      host          ? `+1 of ${host.name}` :
      sectionKey === "in"      ? "Confirmed" :
      sectionKey === "reserve" ? (idx === 0 ? "Next in queue" : "On standby") :
      sectionKey === "injured" && p.injuredSince
        ? `Since ${new Date(p.injuredSince).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}` :
      sectionKey === "noResp"  ? "No reply yet" : "";

    return (
      <div key={p.id}
        style={{ display:"flex", alignItems:"center", padding:"10px 14px",
          borderBottom: isLast ? "none" : "0.5px solid var(--b2)",
          gap:10, cursor: p.isGuest ? "default" : "pointer" }}
        onClick={() => !p.isGuest && setSelectedPlayer(p)}>

        {sectionKey === "reserve" && (
          <span
            draggable
            onDragStart={() => setDragId(p.id)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => { moveReserve(dragId, p.id); setDragId(null); }}
            onClick={e => e.stopPropagation()}
            style={{ color:"var(--t2)", fontSize:16, cursor:"grab",
              flexShrink:0, userSelect:"none" }}>
            ⠿
          </span>
        )}

        {/* Avatar */}
        <div style={{ width:34, height:34, borderRadius:"50%", flexShrink:0,
          background:av.bg, border:`0.5px solid ${av.border}`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:10, fontWeight:600, color:av.color }}>
          {initials(p.name)}
        </div>

        {/* Name + sub */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, color:"var(--t1)", fontWeight:400,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {p.nickname || p.name}
            {sectionKey === "reserve" && (
              <span style={{ fontSize:10, color:"var(--purple)", fontWeight:400 }}> · #{idx+1}</span>
            )}
          </div>
          {sub && (
            <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:1 }}>{sub}</div>
          )}
        </div>

        {/* Right actions */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}
          onClick={e => e.stopPropagation()}>

          {sectionKey === "in" && (
            <>
              {p.paid || p.selfPaid
                ? <span style={{ background:"var(--green2)", border:"0.5px solid var(--greenb)",
                    borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11,
                    color:"var(--green)", whiteSpace:"nowrap" }}>✓ Paid</span>
                : <span style={{ background:"var(--red2)", border:"0.5px solid var(--redb)",
                    borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11,
                    color:"var(--red)", whiteSpace:"nowrap" }}>Unpaid</span>
              }
              {p.owes > 0 && (
                <span style={{ background:"var(--amber2)", border:"0.5px solid var(--amberb)",
                  borderRadius:"var(--r-pill)", padding:"4px 8px", fontSize:11,
                  color:"var(--amber)", whiteSpace:"nowrap" }}>+£{p.owes}</span>
              )}
            </>
          )}

          {sectionKey === "injured" && (
            <button onClick={() => handleClearInjury(p)}
              style={{ background:"var(--red2)", border:"0.5px solid var(--redb)",
                borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11, color:"var(--red)",
                cursor:"pointer", fontFamily:"var(--font-body)", whiteSpace:"nowrap" }}>
              Clear
            </button>
          )}

          {p.token && (
            <div onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/p/${p.token}`).catch(()=>{})}
              style={{ width:28, height:28, background:"var(--s2)",
                border:"0.5px solid var(--border-subtle)", borderRadius:6,
                display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", flexShrink:0 }}>
              <LinkIcon size={14} weight="thin" color="var(--t2)"/>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (key, icon, label, color, players) => {
    const open = openSections[key];
    const inDebtors = key === "in" && players.filter(p => p.owes > 0);

    return (
      <div key={key} style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
        borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>
        <div onClick={() => toggleSection(key)}
          style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"0 14px", minHeight:48, cursor:"pointer",
            borderBottom: open ? "0.5px solid var(--b2)" : "none" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:14 }}>{icon}</span>
            <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em",
              textTransform:"uppercase", color }}>{label}</span>
            <span style={{ fontFamily:"var(--font-display)", fontSize:20,
              lineHeight:1, color:"var(--t1)" }}>{players.length}</span>
          </div>
          <CaretRight size={16} weight="thin" color="var(--t2)"
            style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}/>
        </div>
        {open && players.map((p, i) =>
          renderPlayerRow(p, key, i, i === players.length - 1 && (!inDebtors || !inDebtors.length))
        )}
        {open && key === "in" && inDebtors.length > 0 && (
          <div style={{ padding:"8px 14px", borderTop:"0.5px solid var(--b2)",
            fontSize:11, color:"var(--t2)", fontWeight:300 }}>
            💸 {inDebtors.length} player{inDebtors.length!==1?"s":""} owe a total of £{inDebtors.reduce((s,p)=>s+p.owes,0)}
          </div>
        )}
      </div>
    );
  };

  const tile = ({ icon: Icon, iconColor, bg, border, title, sub, status, badge, onClick: act }) => (
    <div onClick={act} style={{ background:bg, border:`0.5px solid ${border}`,
      borderRadius:"var(--r)", padding:14, display:"flex", flexDirection:"column",
      gap:6, cursor:"pointer", position:"relative", overflow:"hidden",
      WebkitTapHighlightColor:"transparent" }}>
      <Icon size={22} weight="thin" color={iconColor}/>
      <div style={{ fontSize:13, fontWeight:500, color:"var(--t1)" }}>{title}</div>
      <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, lineHeight:1.3 }}>{sub}</div>
      {status && (
        <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.06em",
          textTransform:"uppercase", color: status.ok ? "var(--green)" : "var(--amber)" }}>
          {status.label}
        </div>
      )}
      {badge > 0 && (
        <div style={{ position:"absolute", top:10, right:10, background:"var(--red)",
          borderRadius:10, padding:"2px 7px", fontSize:9, fontWeight:700, color:"var(--white)" }}>
          {badge}
        </div>
      )}
    </div>
  );

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:110 }}>

      {pendingTiebreak && (
        <POTMTiebreakModal
          match={pendingTiebreak}
          squad={squad}
          teamId={teamId}
          adminToken={adminToken}
          onDecide={() => setTiebreakDismissed(true)}
        />
      )}

      {/* ── Hero card ── */}
      <div style={{ position:"sticky", top:0, zIndex:10 }}>
      <div style={{ position:"relative", height:140, overflow:"hidden", background:"var(--bg)" }}>
        {isDemoMode && (
          <div style={{ position:"absolute", top:12, right:12, zIndex:10 }}>
            <button onClick={handleDemoReset} style={{
              background:"rgba(255,255,255,0.12)", backdropFilter:"blur(12px)",
              border:"0.5px solid rgba(255,255,255,0.15)", borderRadius:"var(--r-pill)",
              padding:"5px 12px", fontSize:10, color:"var(--white)", fontFamily:"var(--font-body)",
              cursor:"pointer", letterSpacing:"0.05em", WebkitTapHighlightColor:"transparent",
            }}>
              {demoResetState === "resetting" ? "Resetting..." : demoResetState === "done" ? "Demo Reset ✓" : "🔄 Reset Demo"}
            </button>
          </div>
        )}
        <img src="https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80"
          alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%",
            objectFit:"cover", filter:"brightness(0.35) saturate(0.6)" }}/>
        <div style={{ position:"absolute", inset:0,
          background:"linear-gradient(180deg,rgba(10,10,8,0.2) 0%,rgba(10,10,8,0.82) 100%)" }}/>
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"12px 16px",
          display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
          {/* Left */}
          <div>
            {settings?.groupName && (
              <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.14em",
                textTransform:"uppercase", color:"var(--gold)", marginBottom:2 }}>
                {settings.groupName}
              </div>
            )}
            <div style={{ fontFamily:"var(--font-display)", fontSize:34, lineHeight:0.95,
              letterSpacing:"0.02em", fontStyle:"italic", color:"var(--t1)" }}>
              ADMIN <span style={{ color:"var(--green)" }}>PANEL</span>
            </div>
          </div>
          {/* Right — glass chips */}
          <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
            {[
              { num: inPlayers.length, label:"In this week", color:"var(--green)", glow:true },
              { num: paidCount,        label:"Paid",         color:"var(--green)", glow:true },
              { num: `£${totalOwed}`,  label:"Outstanding",  color:"var(--red)",   glow:false },
            ].map(({ num, label, color, glow }) => (
              <div key={label} style={{ background:"rgba(255,255,255,0.1)",
                backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
                border:"0.5px solid rgba(255,255,255,0.18)", borderRadius:"var(--rs)",
                width:80, height:56, flexShrink:0,
                display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                <div style={{ fontFamily:"var(--font-display)", fontSize:26, lineHeight:1, color,
                  textShadow: glow ? "0 0 10px rgba(61,220,106,0.4)" : "none" }}>
                  {num}
                </div>
                <div style={{ fontSize:9, fontWeight:300, letterSpacing:"0.08em",
                  textTransform:"uppercase", color:"rgba(242,240,234,0.6)", marginTop:1 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding:"10px 16px 0" }}>

        {/* Alert banners */}
        {orphanedGuests.map(guest => {
          const host = squad.find(h => h.id === guest.guestOf);
          return (
            <div key={guest.id} style={{ background:"var(--amber2)", border:"0.5px solid var(--amberb)",
              borderRadius:"var(--r)", padding:"12px 14px", marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:500, color:"var(--amber)", marginBottom:4 }}>
                👤 {guest.name}'s host dropped out
              </div>
              <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:10 }}>
                {host?.name || "Their host"} is now out. What should happen to {guest.name}?
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {[
                  { label:"Keep IN",        action:() => dismissOrphan(guest.id),  color:"var(--green)",  bg:"var(--green2)",  border:"var(--greenb)" },
                  { label:"Move to reserve",action:() => reserveGuest(guest.id),  color:"var(--purple)", bg:"var(--purple2)", border:"var(--purpleb)" },
                  { label:`Remove ${guest.name}`,action:() => removeGuest(guest.id), color:"var(--red)",   bg:"var(--red2)",    border:"var(--redb)" },
                ].map(({ label, action, color, bg, border }) => (
                  <button key={label} onClick={action} style={{ padding:"6px 12px",
                    borderRadius:"var(--r-pill)", border:`0.5px solid ${border}`,
                    background:bg, color, fontFamily:"var(--font-body)",
                    fontSize:12, fontWeight:500, cursor:"pointer" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {selfPaidPending.length > 0 && (
          <>
            <style>{`@keyframes ioo-gold-pulse{0%{box-shadow:0 0 0px var(--goldb)}50%{box-shadow:0 0 16px var(--goldb)}100%{box-shadow:0 0 0px var(--goldb)}}`}</style>
            <div style={{
              background:"var(--gold2)", border:"0.5px solid var(--goldb)",
              borderLeft:"3px solid var(--gold)",
              borderRadius:"var(--r)", padding:"12px 14px", marginBottom:8,
              animation:"ioo-gold-pulse 2s ease-in-out infinite",
            }}>
              <div style={{ fontFamily:"var(--font-display)", fontSize:15,
                letterSpacing:"0.08em", color:"var(--gold)", marginBottom:8 }}>
                💰 PAYMENT CONFIRMATIONS · {selfPaidPending.length}
              </div>
              {selfPaidPending.map((p, i) => (
                <div key={p.id} style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  gap:8, paddingTop: i === 0 ? 0 : 8,
                  borderTop: i === 0 ? "none" : "0.5px solid rgba(232,160,32,0.2)",
                }}>
                  <div style={{ fontSize:13, color:"var(--t1)", fontWeight:400, flex:1, minWidth:0 }}>
                    {p.paidBy === 'host'
                      ? `Host paid for ${p.nickname || p.name}`
                      : (
                          <>
                            {p.nickname || p.name} · £{schedule.pricePerPlayer || 0} cash
                            {p.owes > 0 && <span style={{ color:"var(--red)" }}> + £{p.owes} debt</span>}
                          </>
                        )
                    }
                  </div>
                  <button onClick={() => markPaid(p.id)} style={{
                    padding:"5px 14px", borderRadius:"var(--r-pill)", border:"none",
                    background:"var(--gold)", color:"var(--black)",
                    fontFamily:"var(--font-display)", fontSize:13,
                    letterSpacing:"0.06em", cursor:"pointer", flexShrink:0,
                  }}>CONFIRM ✓</button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Make game live hint — shown until dismissed or game goes live */}
        {!schedule.gameIsLive && !gameLiveHintDismissed && (
          <div style={{
            background:"var(--gold2)", border:"0.5px solid var(--goldb)",
            borderLeft:"3px solid var(--gold)",
            borderRadius:"var(--r)", padding:"12px 14px", marginBottom:8,
            display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10,
          }}>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"var(--font-display)", fontSize:14,
                letterSpacing:"0.08em", color:"var(--gold)", marginBottom:4 }}>
                ⚽ MAKE YOUR GAME LIVE
              </div>
              <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:10, lineHeight:1.5 }}>
                Players can only confirm their spot once the game is open. Flip the switch below or in Match Settings.
              </div>
              <button onClick={() => setScreen("schedule")} style={{
                padding:"6px 14px", borderRadius:"var(--r-pill)",
                border:"0.5px solid var(--goldb)", background:"transparent",
                color:"var(--gold)", fontFamily:"var(--font-body)",
                fontSize:12, fontWeight:500, cursor:"pointer",
              }}>
                Go to Match Settings
              </button>
            </div>
            <button
              onClick={() => {
                localStorage.setItem('ioo_game_live_hint_dismissed', '1');
                setGameLiveHintDismissed(true);
              }}
              style={{ background:"none", border:"none", color:"var(--t3)",
                fontSize:18, cursor:"pointer", padding:0, lineHeight:1, flexShrink:0 }}
              aria-label="Dismiss"
            >×</button>
          </div>
        )}

        {/* Game live state.
            When NOT live: full toggle row with clear "Make this week's
            game live" label.
            When live: status badge only — no toggle. Going offline is
            via Cancel This Week below. */}
        {schedule.gameIsLive ? (
          <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--r)", padding:"14px 16px",
            display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", flexShrink:0,
              background:"var(--green)",
              boxShadow:"0 0 8px rgba(61,220,106,0.6)",
              animation:"ioo-blink 2s infinite" }}/>
            <div style={{
              fontFamily:"'Bebas Neue', sans-serif", fontSize:15,
              color:"var(--t1)", letterSpacing:"0.08em",
            }}>
              LIVE
            </div>
          </div>
        ) : (
          <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
            borderRadius:"var(--r)", padding:"14px 16px",
            display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom:10,
            opacity: gameOpenLoading ? 0.6 : 1,
            pointerEvents: gameOpenLoading ? "none" : "auto" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", flexShrink:0,
                background:"var(--t2)" }}/>
              <div style={{ fontSize:15, fontWeight:400, color:"var(--t1)" }}>
                Make this week's game live
              </div>
            </div>
            <div onClick={toggleGameLive} style={{ width:44, height:26, borderRadius:13,
              background:"var(--s3)", position:"relative", flexShrink:0,
              cursor:"pointer", transition:"all 0.2s" }}>
              <div style={{ width:20, height:20, background:"var(--white)", borderRadius:"50%",
                position:"absolute", top:3, left:3, transition:"all 0.2s",
                boxShadow:"0 1px 4px rgba(0,0,0,0.3)" }}/>
            </div>
          </div>
        )}

        {/* This Week tiles — Make Teams + Input Result.
            Moved up from below the roster (was hidden way down) so the
            screen reads top-to-bottom as a workflow: live status →
            tonight's work → live actions → roster admin. */}
        <SectionLabel>This Week</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          {tile({
            icon:UsersThree, iconColor:"#60A0FF",
            bg:"linear-gradient(135deg,rgba(96,160,255,0.14) 0%,rgba(96,160,255,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(96,160,255,0.25)",
            title:"Make Teams", sub:"Split squad into A and B",
            status:{ ok:teamsSet, label: teamsSet ? "Teams confirmed ✓" : "Not confirmed" },
            badge:0, onClick:() => setScreen("teams"),
          })}
          {tile({
            icon:FlagCheckered, iconColor:"var(--green)",
            bg:"linear-gradient(135deg,rgba(61,220,106,0.14) 0%,rgba(61,220,106,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(61,220,106,0.25)",
            title:"Input Result", sub:"Score, scorers, POTM, bibs",
            badge:pendingResults, onClick:() => setScreen("score"),
          })}
        </div>

        {/* Actions section */}
        <SectionLabel>Actions</SectionLabel>
        {chaseToast && (
          <div style={{ background:"var(--green2)", border:"0.5px solid var(--greenb)",
            borderRadius:"var(--rs)", padding:"8px 14px", marginBottom:8,
            fontSize:12, color:"var(--green)" }}>
            ✓ Chase sent to {noRespPlayers.length} player{noRespPlayers.length!==1?"s":""}
          </div>
        )}
        {chaseRecentMsg && (
          <div style={{ padding:"6px 14px", marginBottom:8,
            fontSize:12, color:"var(--amber)", fontWeight:300 }}>
            {chaseRecentMsg}
          </div>
        )}
        <div ref={cancelWeekRef} style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
          borderRadius:"var(--r)", overflow:"hidden", marginBottom:10 }}>
          {[
            {
              key:"chase", iconEl:<Megaphone size={18} weight="thin" color="var(--amber)"/>,
              iconBg:"var(--amber2)", iconBorder:"var(--amberb)",
              title:"Chase No-Responses",
              sub:`Nudge the ${noRespPlayers.length} player${noRespPlayers.length!==1?"s":""} who haven't replied`,
              badge: noRespPlayers.length, action: chaseNoResponders,
            },
            {
              key:"cancel", iconEl:<XCircle size={18} weight="thin" color="var(--red)"/>,
              iconBg:"var(--red2)", iconBorder:"var(--redb)",
              title:"Cancel This Week",
              sub:"Notify all confirmed players",
              badge:0, action:() => setShowCancel(true),
            },
            {
              key:"announce", iconEl:<PaperPlaneTilt size={18} weight="thin" color="var(--purple)"/>,
              iconBg:"var(--purple2)", iconBorder:"var(--purpleb)",
              title:"Announce to Squad",
              sub:"Choose who receives your message",
              badge:0, action:() => setShowAnnounce(true),
            },
          ].map(({ key, iconEl, iconBg, iconBorder, title, sub, badge, action }, i) => (
            <div key={key} onClick={action}
              style={{ display:"flex", alignItems:"center", padding:"12px 14px",
                borderBottom: i < 2 ? "0.5px solid var(--b2)" : "none",
                cursor:"pointer", gap:12,
                WebkitTapHighlightColor:"transparent" }}>
              <div style={{ width:36, height:36, borderRadius:"var(--rs)", flexShrink:0,
                background:iconBg, border:`0.5px solid ${iconBorder}`,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                {iconEl}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:"var(--t1)" }}>{title}</div>
                <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:2 }}>{sub}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                {badge > 0 && (
                  <div style={{ background:"var(--amber)", borderRadius:10, padding:"2px 8px",
                    fontSize:10, fontWeight:600, color:"var(--black)" }}>{badge}</div>
                )}
                <CaretRight size={16} weight="thin" color="var(--t2)"
                  style={{ transform: key==="cancel" && showCancel ? "rotate(90deg)" : "none",
                    transition:"transform 0.2s" }}/>
              </div>
            </div>
          ))}
        </div>

        {/* Cancel modal */}
        {showCancel && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
            backdropFilter:"blur(8px)", zIndex:300,
            display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"var(--s2)", border:"0.5px solid var(--redb)",
              borderRadius:16, width:"100%", maxWidth:380, padding:24 }}>
              <div style={{ fontFamily:"'Bebas Neue', sans-serif", fontSize:28,
                color:"var(--red)", marginBottom:8, letterSpacing:"0.04em" }}>
                CANCEL THIS WEEK?
              </div>
              <div style={{ fontFamily:"var(--font-body)", fontWeight:300, fontSize:13,
                color:"var(--t2)", marginBottom:20 }}>
                This will clear all responses and refund any payments made this week
              </div>
              <input
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason e.g. Venue flooded (optional)"
                onFocus={e => { e.target.style.border = "0.5px solid var(--t2)"; }}
                onBlur={e  => { e.target.style.border = "0.5px solid var(--s3)";  }}
                style={{ width:"100%", background:"var(--s3)", color:"var(--t1)",
                  border:"0.5px solid var(--s3)", borderRadius:10, padding:"10px 14px",
                  fontFamily:"var(--font-body)", fontWeight:300, fontSize:13,
                  outline:"none", boxSizing:"border-box", marginBottom:16 }}/>
              <button
                onClick={cancelWeek}
                disabled={cancelLoading}
                style={{ width:"100%", background:"var(--red)", color:"var(--white)",
                  fontFamily:"'Bebas Neue', sans-serif", fontSize:18, letterSpacing:"0.08em",
                  border:"none", borderRadius:24, padding:12, marginBottom:8,
                  cursor: cancelLoading ? "default" : "pointer",
                  opacity: cancelLoading ? 0.6 : 1 }}>
                {cancelLoading ? "CANCELLING…" : "CANCEL THIS WEEK"}
              </button>
              <button
                onClick={() => { setShowCancel(false); setCancelReason(""); }}
                disabled={cancelLoading}
                style={{ width:"100%", background:"var(--s3)", color:"var(--t2)",
                  fontFamily:"'Bebas Neue', sans-serif", fontSize:18, letterSpacing:"0.08em",
                  border:"none", borderRadius:24, padding:12,
                  cursor: cancelLoading ? "default" : "pointer",
                  opacity: cancelLoading ? 0.6 : 1 }}>
                Keep it on
              </button>
            </div>
          </div>
        )}

        {/* Live Board */}
        <SectionLabel>Live Board</SectionLabel>
        {renderSection("in",      "✅", "In",          "var(--green)",  inPlayers)}
        {renderSection("reserve", "🟣", "Reserve",     "var(--purple)", reservePlayers)}
        {renderSection("maybe",   "❓", "Maybe",       "var(--amber)",  maybePlayers)}
        {renderSection("out",     "❌", "Out",          "var(--red)",    outPlayers)}
        {renderSection("injured", "🤕", "Injured",     "var(--red)",    injuredPlayers)}
        {renderSection("noResp",  "⏳", "No Response", "var(--t2)",     noRespPlayers)}

        {/* Manage tiles */}
        <SectionLabel>Manage</SectionLabel>
        <div style={{ marginBottom:8 }}>
          {tile({
            icon: Money, iconColor:"var(--green)",
            bg:"linear-gradient(135deg, var(--green2), transparent)",
            border:"var(--greenb)",
            title:"Payments",
            sub:`£${totalOwed} outstanding`,
            badge:0, onClick:() => setScreen("payments"),
          })}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          {tile({
            icon:UserList, iconColor:"var(--gold)",
            bg:"linear-gradient(135deg,rgba(232,160,32,0.14) 0%,rgba(232,160,32,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(232,160,32,0.25)",
            title:"Squad",
            sub:`${squad.filter(p=>!p.disabled&&!p.isGuest).length} players · ${squad.filter(p=>p.isGuest&&!p.disabled).length} guests`,
            badge:0, onClick:() => setScreen("squad"),
          })}
          {tile({
            icon:CalendarBlank, iconColor:"var(--purple)",
            bg:"linear-gradient(135deg,rgba(176,96,240,0.14) 0%,rgba(176,96,240,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(176,96,240,0.25)",
            title:"Match Settings",
            sub:[schedule.dayOfWeek, schedule.venue, schedule.pricePerPlayer != null ? `£${schedule.pricePerPlayer}` : null].filter(Boolean).join(" · ") || "Not configured",
            badge:0, onClick:() => setScreen("schedule"),
          })}
          {tile({
            icon:Bell, iconColor:"var(--amber)",
            bg:"linear-gradient(135deg,rgba(255,176,32,0.14) 0%,rgba(255,176,32,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(255,176,32,0.25)",
            title:"Reminders", sub:"Quiet hours · triggers",
            badge:0, onClick:() => setScreen("reminders"),
          })}
          {tile({
            icon:TShirt, iconColor:"var(--gold)",
            bg:"linear-gradient(135deg,rgba(232,160,32,0.14) 0%,rgba(232,160,32,0.03) 60%,rgba(10,10,8,0.5) 100%)",
            border:"rgba(232,160,32,0.25)",
            title:"Bibs",
            sub: bibHistory[0]?.returned === false
              ? `${bibHistory[0].name} has them`
              : "Not assigned",
            badge:0, onClick:() => setScreen("bibs"),
          })}
        </div>

        {/* Cover Pool */}
        <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
          borderRadius:"var(--r)", overflow:"hidden", marginBottom:10 }}>
          <div onClick={() => setShowCoverPool(o => !o)}
            style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"0 14px", minHeight:48, cursor:"pointer",
              borderBottom: showCoverPool && coverPool.length ? "0.5px solid var(--b2)" : "none" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8,
              fontSize:11, fontWeight:600, letterSpacing:"0.08em",
              textTransform:"uppercase", color:"var(--t2)" }}>
              <Users size={16} weight="thin"/>
              Cover Pool · {coverPool.length} player{coverPool.length!==1?"s":""}
            </div>
            <CaretRight size={14} weight="thin" color="var(--t2)"
              style={{ transform: showCoverPool ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}/>
          </div>
          {showCoverPool && coverPool.map(cp => (
            <div key={cp.id} style={{ display:"flex", alignItems:"center", padding:"9px 14px",
              borderTop:"0.5px solid var(--b2)", gap:10 }}>
              <div style={{ width:30, height:30, borderRadius:"50%", background:"var(--s3)",
                border:"0.5px solid var(--border-subtle)", display:"flex", alignItems:"center",
                justifyContent:"center", fontSize:9, fontWeight:600, color:"var(--t2)",
                flexShrink:0 }}>
                {initials(cp.name)}
              </div>
              <div style={{ flex:1, fontSize:12, color:"var(--t2)" }}>{cp.name}</div>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginRight:8 }}>
                {cp.played} game{cp.played!==1?"s":""}
              </div>
              <button onClick={async () => {
                try {
                  const guest = await addPlayerToTeam(adminToken, cp.name, 'regular', false);
                  setSquad([...squad, guest]);
                } catch(e) { console.error(e); }
              }} style={{ background:"var(--s2)", border:"0.5px solid var(--border-subtle)",
                borderRadius:"var(--r-pill)", padding:"4px 10px", fontSize:11,
                color:"var(--t2)", cursor:"pointer", fontFamily:"var(--font-body)" }}>
                + Add
              </button>
            </div>
          ))}
        </div>

      </div>

      {/* Announce modal */}
      {showAnnounce && (
        <AnnounceModal
          squad={squad} settings={settings} teamId={teamId} schedule={schedule}
          onClose={() => setShowAnnounce(false)}
        />
      )}

      {/* NavBar */}
      <NavBar
        activeTab="admin"
        onTabChange={(id) => {
          if (id === "my-view") onGoPlayer?.();
          else if (id === "stats") onGoStats?.();
          else if (id === "history") onGoHistory?.();
          else if (id === "my-io") onGoMyIO?.();
        }}
        onAdminClick={() => {}}
      />
    </div>
  );
}
