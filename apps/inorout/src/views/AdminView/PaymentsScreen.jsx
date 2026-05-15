import { useState } from "react";
import { handleMarkPaid, handleResetPayment, handleWaiveDebt } from "@platform/core";
import { getLedgerForPlayer } from "@platform/supabase";
import { ArrowLeft, CaretDown, CaretUp } from "@phosphor-icons/react";

// ── constants ─────────────────────────────────────────────────────────────────

const TYPE_LABEL = {
  game_fee: 'Game', guest_fee: 'Guest +1',
  debt_payment: 'Debt', waiver: 'Waived', refund: 'Refund',
};

const STATUS_STYLE = {
  paid:     { bg:"var(--green2)",         border:"var(--greenb)",         color:"var(--green)"  },
  unpaid:   { bg:"var(--amber2)",         border:"var(--amberb)",         color:"var(--amber)"  },
  waived:   { bg:"var(--purple2)",        border:"var(--purpleb)",        color:"var(--purple)" },
  refunded: { bg:"rgba(96,160,255,0.12)", border:"rgba(96,160,255,0.3)", color:"#60A0FF"       },
  disputed: { bg:"var(--red2)",           border:"var(--redb)",           color:"var(--red)"    },
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

// Small pill for status labels (IN / OUT / MAYBE etc.)
function pill(label, bg, border, color) {
  return (
    <span style={{
      fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:"var(--r-pill)",
      background:bg, border:`0.5px solid ${border}`, color, letterSpacing:"0.05em",
      whiteSpace:"nowrap",
    }}>{label}</span>
  );
}

// FIX 2 — Larger pill for payment amounts / paid status
function payPill(label, bg, border, color) {
  return (
    <span style={{
      fontSize:13, fontWeight:400, padding:"2px 8px", borderRadius:"var(--r-pill)",
      background:bg, border:`0.5px solid ${border}`, color, letterSpacing:"0.02em",
      whiteSpace:"nowrap",
    }}>{label}</span>
  );
}

// ── PlayerRow accordion ───────────────────────────────────────────────────────

function PlayerRow({ player, teamId, schedule, setSquad, isGuest = false, hostName = null }) {
  const [open,         setOpen]         = useState(false);
  const [ledger,       setLedger]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [waiverOpen,   setWaiverOpen]   = useState(false);
  const [waiverAmount, setWaiverAmount] = useState(player.owes || 0);
  const [waiverNote,   setWaiverNote]   = useState("");

  const toggle = async () => {
    if (!open && ledger === null) {
      setLoading(true);
      try {
        const rows = await getLedgerForPlayer(player.id, teamId, 20);
        setLedger(rows);
      } catch { setLedger([]); }
      finally { setLoading(false); }
    }
    if (open) setWaiverOpen(false);
    setOpen(o => !o);
  };

  const isPaid = player.paid === true || player.selfPaid === true;
  const owes   = player.owes || 0;
  const price  = schedule.pricePerPlayer || 0;
  const sp     = STATUS_PILL[player.status] || STATUS_PILL.none;

  // FIX 6 — guest responsibility text derived from paid_by
  const guestLine = isGuest
    ? player.paidBy === 'host' ? `Host: ${hostName || 'unknown'}`
    : player.paidBy === 'self' ? 'Self pay'
    : hostName ? `guest of ${hostName}` : null
    : null;

  return (
    <div style={{ borderTop:"0.5px solid var(--b2)" }}>
      {/* Collapsed row — FIX 1: chevron added far right */}
      <div onClick={toggle} style={{ padding:"10px 16px", display:"flex",
        alignItems:"center", gap:10, cursor:"pointer",
        WebkitTapHighlightColor:"transparent" }}>
        {/* Initials circle */}
        <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0,
          background:"var(--s3)", border:"0.5px solid var(--border-subtle)",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:9, fontWeight:600, color:"var(--t2)" }}>
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
        {/* Right badges — FIX 2: payPill; FIX 7: £ due only for IN */}
        <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
          {owes > 0 && payPill(`£${owes}`, "var(--red2)", "var(--redb)", "var(--red)")}
          {isPaid
            ? payPill(owes > 0 ? "✓ This week" : "✓ Paid", "var(--green2)", "var(--greenb)", "var(--green)")
            : player.status === 'in' && payPill(`£${price} due`, "var(--amber2)", "var(--amberb)", "var(--amber)")
          }
          {open
            ? <CaretUp   size={16} weight="thin" color="var(--t2)" style={{ flexShrink:0 }}/>
            : <CaretDown size={16} weight="thin" color="var(--t2)" style={{ flexShrink:0 }}/>
          }
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
            const ss = STATUS_STYLE[entry.status] || STATUS_STYLE.unpaid;
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
                    {entry.status.toUpperCase()}
                  </span>
                  <span style={{ fontSize:11, fontWeight:600, color:"var(--t1)", minWidth:28, textAlign:"right" }}>
                    £{Number(entry.amount || 0).toFixed(0)}
                  </span>
                  {/* FIX 2 — inline Reset on paid game_fee rows only */}
                  {entry.status === 'paid' && entry.type === 'game_fee' && (
                    <button onClick={async (e) => {
                      e.stopPropagation();
                      await handleResetPayment(player.id, teamId, entry.matchId || null).catch(console.error);
                      setSquad(sq => sq.map(p => p.id === player.id ? { ...p, paid:false, selfPaid:false, paidBy:null } : p));
                      getLedgerForPlayer(player.id, teamId, 20).then(rows => setLedger(rows)).catch(() => setLedger([]));
                    }} style={{ marginLeft:8, padding:"3px 8px", borderRadius:6,
                      background:"var(--s3)", color:"var(--t2)", fontSize:11, fontWeight:400,
                      border:"none", cursor:"pointer", fontFamily:"var(--font-body)" }}>
                      Reset
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Action row — Reset moved inline to ledger rows (FIX 2) */}
          <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
            {isPaid && (
              <button onClick={async () => {
                await handleResetPayment(player.id, teamId,
                  schedule.activeMatchId || null).catch(console.error);
                setSquad(sq => sq.map(p => p.id === player.id
                  ? { ...p, paid:false, selfPaid:false, paidBy:null } : p));
                getLedgerForPlayer(player.id, teamId, 20)
                  .then(rows => setLedger(rows))
                  .catch(() => setLedger([]));
              }} style={{
                background:'transparent',
                border:'0.5px solid var(--t2)',
                color:'var(--t2)',
                borderRadius:20,
                padding:'8px 16px',
                fontSize:13,
                fontFamily:'DM Sans, sans-serif',
                cursor:'pointer'
              }}>
                Reset Payment
              </button>
            )}
            {!isPaid && (
              <button onClick={async () => {
                await handleMarkPaid(player.id, teamId, schedule.activeMatchId || null, price).catch(console.error);
                setSquad(sq => sq.map(p => p.id === player.id ? { ...p, paid:true } : p));
                getLedgerForPlayer(player.id, teamId, 20).then(rows => setLedger(rows)).catch(() => setLedger([]));
              }} style={{ padding:"6px 14px", borderRadius:"var(--r-pill)", border:"none",
                background:"var(--gold)", color:"#000", fontSize:11, fontWeight:600,
                cursor:"pointer", fontFamily:"var(--font-body)" }}>
                Mark Paid — This Week
              </button>
            )}
            {owes > 0 && !waiverOpen && (
              <button onClick={() => { setWaiverAmount(owes); setWaiverOpen(true); }}
                style={{ padding:"6px 14px", borderRadius:"var(--r-pill)",
                  border:"0.5px solid var(--redb)", background:"transparent",
                  color:"var(--red)", fontSize:11, cursor:"pointer",
                  fontFamily:"var(--font-body)" }}>
                Waive Debt
              </button>
            )}
          </div>

          {/* Inline waiver form */}
          {waiverOpen && (
            <div style={{ marginTop:10, padding:"10px 12px", background:"var(--s2)",
              borderRadius:8, border:"0.5px solid var(--redb)" }}>
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
                      borderRadius:6, padding:"5px 8px", fontSize:12, color:"var(--t1)",
                      fontFamily:"var(--font-body)", outline:"none" }}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={waiverNote}
                  onChange={e => setWaiverNote(e.target.value)}
                  style={{ flex:1, minWidth:120, background:"var(--s3)",
                    border:"0.5px solid var(--border-subtle)", borderRadius:6,
                    padding:"5px 8px", fontSize:12, color:"var(--t1)",
                    fontFamily:"var(--font-body)", outline:"none" }}
                />
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={async () => {
                  await handleWaiveDebt(player.id, teamId, waiverAmount, waiverNote || null).catch(console.error);
                  setSquad(sq => sq.map(p => p.id === player.id ? { ...p, owes:0 } : p));
                  setWaiverOpen(false);
                  setLedger(null);
                }} style={{ padding:"5px 14px", borderRadius:"var(--r-pill)", border:"none",
                  background:"var(--red)", color:"#fff", fontSize:11, fontWeight:600,
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

// ── SectionLabel — FIX 8: color prop added ───────────────────────────────────

function SectionLabel({ children, color = "var(--t2)" }) {
  return (
    <div style={{ padding:"0 16px 6px", fontFamily:"var(--font-display)",
      fontSize:13, letterSpacing:"0.1em", color }}>
      {children}
    </div>
  );
}

// ── PlayerCard wrapper ────────────────────────────────────────────────────────

function PlayerCard({ children }) {
  return (
    <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
      borderRadius:"var(--r)", overflow:"hidden", margin:"0 16px 12px" }}>
      {children}
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────

export default function PaymentsScreen({ squad, setSquad, schedule, teamId, coverPool = [], onBack }) {
  const [showNotPlaying, setShowNotPlaying] = useState(false);

  const price = schedule.pricePerPlayer || 0;

  const activePlayers = squad.filter(p => !p.disabled && !p.isGuest);
  const guestPlayers  = squad.filter(p => p.isGuest && !p.disabled);

  // FIX 8 — 4 mutually exclusive sections, priority: owes → unpaid-in → paid → notPlaying
  const byName = (a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name);

  const owesSection = activePlayers
    .filter(p => (p.owes || 0) > 0)
    .sort((a, b) => (b.owes || 0) - (a.owes || 0));

  const unpaidIn = activePlayers
    .filter(p => !(p.owes > 0) && p.status === 'in' && !(p.paid || p.selfPaid))
    .sort(byName);

  const paidUp = activePlayers
    .filter(p => !(p.owes > 0) && (p.paid || p.selfPaid))
    .sort(byName);

  const notPlaying = activePlayers
    .filter(p => !(p.owes > 0) && !(p.paid || p.selfPaid) && p.status !== 'in')
    .sort(byName);

  const totalOwed = activePlayers.reduce((s, p) => s + (p.owes || 0), 0);
  // FIX 3 — count all paid this week across all sections
  const paidCount = activePlayers.filter(p => p.paid || p.selfPaid).length;

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:40 }}>

      {/* Header */}
      <div style={{ padding:"12px 16px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer",
            padding:0, display:"flex", alignItems:"center", color:"var(--t2)" }}>
            <ArrowLeft size={20} weight="thin" />
          </button>
          <div style={{ fontFamily:"var(--font-display)", fontSize:28,
            letterSpacing:"0.06em", color:"var(--gold)" }}>
            PAYMENTS
          </div>
        </div>

        {/* Summary chips — FIX 3: "{paidCount} PLAYERS PAID" */}
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
          <div style={{ padding:"6px 14px", borderRadius:"var(--r-pill)",
            background:"var(--red2)", border:"0.5px solid var(--redb)",
            fontFamily:"var(--font-display)", fontSize:14, fontWeight:600, letterSpacing:"0.08em",
            color:"var(--t1)" }}>
            £{totalOwed} OUTSTANDING
          </div>
          <div style={{ padding:"6px 14px", borderRadius:"var(--r-pill)",
            background:"var(--green2)", border:"0.5px solid var(--greenb)",
            fontFamily:"var(--font-display)", fontSize:14, fontWeight:600, letterSpacing:"0.08em",
            color:"var(--t1)" }}>
            {paidCount === 1 ? "1 PLAYER PAID" : `${paidCount} PLAYERS PAID`}
          </div>
        </div>
      </div>

      {/* FIX 8 — Section 1: OWES MONEY (hidden when empty) */}
      {owesSection.length > 0 && (
        <>
          <SectionLabel color="var(--red)">OWES MONEY · {owesSection.length}</SectionLabel>
          <PlayerCard>
            {owesSection.map(p => (
              <PlayerRow key={p.id} player={p} teamId={teamId} schedule={schedule} setSquad={setSquad} />
            ))}
          </PlayerCard>
        </>
      )}

      {/* FIX 8 — Section 2: IN — NOT YET PAID (hidden when empty) */}
      {unpaidIn.length > 0 && (
        <>
          <SectionLabel color="var(--amber)">IN — NOT YET PAID · {unpaidIn.length}</SectionLabel>
          <PlayerCard>
            {unpaidIn.map(p => (
              <PlayerRow key={p.id} player={p} teamId={teamId} schedule={schedule} setSquad={setSquad} />
            ))}
          </PlayerCard>
        </>
      )}

      {/* FIX 8 — Section 3: PAID UP (hidden when empty) */}
      {paidUp.length > 0 && (
        <>
          <SectionLabel color="var(--green)">PAID UP · {paidUp.length}</SectionLabel>
          <PlayerCard>
            {paidUp.map(p => (
              <PlayerRow key={p.id} player={p} teamId={teamId} schedule={schedule} setSquad={setSquad} />
            ))}
          </PlayerCard>
        </>
      )}

      {/* FIX 8 — Section 4: NOT PLAYING — always shown, collapsed by default */}
      <SectionLabel>NOT PLAYING · {notPlaying.length}</SectionLabel>
      <div style={{ margin:"0 16px 12px" }}>
        <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)",
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
          {showNotPlaying && notPlaying.map(p => {
            const sp = STATUS_PILL[p.status] || STATUS_PILL.none;
            return (
              <div key={p.id} style={{ display:"flex", alignItems:"center",
                padding:"9px 16px", borderTop:"0.5px solid var(--b2)", gap:10 }}>
                <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0,
                  background:"var(--s3)", border:"0.5px solid var(--border-subtle)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:9, fontWeight:600, color:"var(--t2)" }}>
                  {ini(p.nickname || p.name)}
                </div>
                <div style={{ flex:1, minWidth:0, fontSize:13, color:"var(--t2)",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {p.nickname || p.name}
                </div>
                <span style={{
                  fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:"var(--r-pill)",
                  background:sp.bg, border:`0.5px solid ${sp.border}`, color:sp.color,
                  letterSpacing:"0.05em", whiteSpace:"nowrap",
                }}>{sp.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* FIX 6 — Guests: always shown, empty state if no guests */}
      <SectionLabel>GUESTS</SectionLabel>
      <PlayerCard>
        {guestPlayers.length === 0 ? (
          <div style={{ padding:"12px 16px", fontSize:13, color:"var(--t2)", fontWeight:300 }}>
            No guests this week
          </div>
        ) : guestPlayers.map(p => {
          const host = squad.find(h => h.id === p.guestOf);
          return (
            <PlayerRow key={p.id} player={p} teamId={teamId} schedule={schedule}
              setSquad={setSquad} isGuest hostName={host?.nickname || host?.name || null} />
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
