import { useState, useEffect } from "react";
import {
  getPaymentState,
  handleResetPayment,
  toggleViceCaptain,
  confirmPayment,
} from "@platform/core";
import {
  deletePlayer,
  resetPlayerToken, insertPlayerInjury, clearPlayerInjury, getPlayerInjuries,
  setPlayerNickname,
} from "@platform/supabase";
import {
  CaretRight, ArrowLeft, Link as LinkIcon,
  PencilSimple, Bandaids,
} from "@phosphor-icons/react";

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

export default function PlayerProfile({ player, squad, schedule, teamId, adminToken, setSquad, onBack, me, isViceCaptain }) {
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
