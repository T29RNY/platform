import { useState } from "react";
import { handleMarkPaid, handleResetPayment, handleWaiveDebt } from "@platform/core";
import { getLedgerForPlayer } from "@platform/supabase";
import { ArrowLeft } from "@phosphor-icons/react";

// ── constants ─────────────────────────────────────────────────────────────────

const TYPE_LABEL = {
  game_fee: 'Game', guest_fee: 'Guest +1',
  debt_payment: 'Debt', waiver: 'Waived', refund: 'Refund',
};

const STATUS_STYLE = {
  paid:     { bg:"var(--green2)",               border:"var(--greenb)",               color:"var(--green)"  },
  unpaid:   { bg:"var(--amber2)",               border:"var(--amberb)",               color:"var(--amber)"  },
  waived:   { bg:"var(--purple2)",              border:"var(--purpleb)",              color:"var(--purple)" },
  refunded: { bg:"rgba(96,160,255,0.12)",       border:"rgba(96,160,255,0.3)",        color:"#60A0FF"       },
  disputed: { bg:"var(--red2)",                border:"var(--redb)",                 color:"var(--red)"    },
};

const STATUS_PILL = {
  in:      { label:"IN",          color:"var(--green)",  bg:"var(--green2)",  border:"var(--greenb)"  },
  out:     { label:"OUT",         color:"var(--red)",    bg:"var(--red2)",    border:"var(--redb)"    },
  maybe:   { label:"MAYBE",       color:"var(--amber)",  bg:"var(--amber2)",  border:"var(--amberb)"  },
  reserve: { label:"RESERVE",     color:"var(--purple)", bg:"var(--purple2)", border:"var(--purpleb)" },
  none:    { label:"NO RESPONSE", color:"var(--t2)",     bg:"rgba(255,255,255,0.06)", border:"rgba(255,255,255,0.15)" },
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

  const pill = (label, bg, border, color) => (
    <span style={{
      fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:"var(--r-pill)",
      background:bg, border:`0.5px solid ${border}`, color, letterSpacing:"0.05em",
      whiteSpace:"nowrap",
    }}>{label}</span>
  );

  return (
    <div style={{ borderTop:"0.5px solid var(--b2)" }}>
      {/* Collapsed row */}
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
          {isGuest && hostName && (
            <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300 }}>guest of {hostName}</div>
          )}
          <div style={{ marginTop:3 }}>
            {pill(sp.label, sp.bg, sp.border, sp.color)}
          </div>
        </div>
        {/* Right badges */}
        <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
          {owes > 0 && pill(`£${owes}`, "var(--red2)", "var(--redb)", "var(--red)")}
          {isPaid
            ? pill("✓ Paid",   "var(--green2)", "var(--greenb)", "var(--green)")
            : pill(`£${price} due`, "var(--amber2)", "var(--amberb)", "var(--amber)")
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
                </div>
              </div>
            );
          })}

          {/* Action row */}
          <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
            {!isPaid ? (
              <button onClick={async () => {
                await handleMarkPaid(player.id, teamId, schedule.activeMatchId || null, price).catch(console.error);
                setSquad(sq => sq.map(p => p.id === player.id ? { ...p, paid:true } : p));
                setLedger(null);
              }} style={{ padding:"6px 14px", borderRadius:"var(--r-pill)", border:"none",
                background:"var(--gold)", color:"#000", fontSize:11, fontWeight:600,
                cursor:"pointer", fontFamily:"var(--font-body)" }}>
                Mark Paid
              </button>
            ) : (
              <button onClick={async () => {
                await handleResetPayment(player.id, teamId, schedule.activeMatchId || null).catch(console.error);
                setSquad(sq => sq.map(p => p.id === player.id ? { ...p, paid:false, selfPaid:false, paidBy:null } : p));
                setLedger(null);
              }} style={{ padding:"6px 14px", borderRadius:"var(--r-pill)",
                border:"0.5px solid var(--border-subtle)", background:"transparent",
                color:"var(--t2)", fontSize:11, cursor:"pointer",
                fontFamily:"var(--font-body)" }}>
                Reset
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

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div style={{ padding:"0 16px 6px", fontFamily:"var(--font-display)",
      fontSize:13, letterSpacing:"0.1em", color:"var(--t2)" }}>
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
  const price = schedule.pricePerPlayer || 0;

  const activePlayers = squad.filter(p => !p.disabled && !p.isGuest);
  const guestPlayers  = squad.filter(p => p.isGuest && !p.disabled);

  const sorted = [...activePlayers].sort((a, b) => {
    const aOwes = a.owes || 0;
    const bOwes = b.owes || 0;
    if (aOwes > 0 && bOwes === 0) return -1;
    if (aOwes === 0 && bOwes > 0) return  1;
    if (aOwes > 0 && bOwes > 0)  return bOwes - aOwes;
    const aPaid = a.paid || a.selfPaid;
    const bPaid = b.paid || b.selfPaid;
    if (aPaid && !bPaid) return -1;
    if (!aPaid && bPaid) return  1;
    return (a.nickname || a.name).localeCompare(b.nickname || b.name);
  });

  const totalOwed  = activePlayers.reduce((s, p) => s + (p.owes || 0), 0);
  const paidCount  = activePlayers.filter(p => p.paid || p.selfPaid).length;

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

        {/* Summary chips */}
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
          <div style={{ padding:"5px 12px", borderRadius:"var(--r-pill)",
            background:"var(--red2)", border:"0.5px solid var(--redb)",
            fontFamily:"var(--font-display)", fontSize:13, letterSpacing:"0.08em",
            color:"var(--red)" }}>
            £{totalOwed} OUTSTANDING
          </div>
          <div style={{ padding:"5px 12px", borderRadius:"var(--r-pill)",
            background:"var(--green2)", border:"0.5px solid var(--greenb)",
            fontFamily:"var(--font-display)", fontSize:13, letterSpacing:"0.08em",
            color:"var(--green)" }}>
            {paidCount} PAID THIS WEEK
          </div>
        </div>
      </div>

      {/* Squad list */}
      <PlayerCard>
        {sorted.length ? sorted.map(p => (
          <PlayerRow key={p.id} player={p} teamId={teamId} schedule={schedule} setSquad={setSquad} />
        )) : (
          <div style={{ padding:"16px", fontSize:12, color:"var(--t2)", fontWeight:300 }}>No players</div>
        )}
      </PlayerCard>

      {/* Guests */}
      {guestPlayers.length > 0 && (
        <>
          <SectionLabel>GUESTS</SectionLabel>
          <PlayerCard>
            {guestPlayers.map(p => {
              const host = squad.find(h => h.id === p.guestOf);
              return (
                <PlayerRow key={p.id} player={p} teamId={teamId} schedule={schedule}
                  setSquad={setSquad} isGuest hostName={host?.nickname || host?.name || null} />
              );
            })}
          </PlayerCard>
        </>
      )}

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
