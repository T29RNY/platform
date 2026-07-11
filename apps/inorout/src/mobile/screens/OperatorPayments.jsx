// OperatorPayments.jsx — Operator track, screen 3 ("Payments"), mounted at /hub
// for an operator role (owner | manager — NOT staff), tab "payments".
//
// Honest mobile re-presentation of the laptop venue dashboard's Payments view
// (apps/venue/src/views/PaymentsView.jsx) in the scoped amber theme. Two existing
// reads, no new RPC:
//   • venueGetCharges(venue_id) → summary{owed/collected/outstanding/rate} + charges[]
//   • venueGetState(venue_id)   → teams{} (names + brand colours) + venue.payment_link
// The writer is the existing venueRecordPayment → venue_record_payment.
//
// AUTH: a mobile operator passes their venue_id as the credential. resolve_venue_caller
// stage 1b authenticates them via auth.uid() against venue_admins — the same path the
// laptop app uses. No token, no new RPC. The Payments TAB is owner|manager only (nav.js).
//
// Honest adaptations vs the prototype (see audit):
//   • Record-payment methods = cash / card / bank_transfer / other (the 4 the RPC
//     accepts). The prototype's 5th "Online link" record-method is dropped — there is
//     no operator per-charge pay-link backend.
//   • Charges with no team_id (membership/class/pt/room_hire) carry no person name in
//     the RPC, so they're labelled by run_label or a humanized source.
//   • Headline tiles stay venue-wide (computed from the unfiltered summary); only the
//     ledger rows filter, so filtering never mutates the totals.
//   • The vestigial "read-only — refunds need reverse-money" banner is dropped (no
//     refund control on this screen; recording needs no special cap).

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { venueGetState, venueGetCharges, venueRecordPayment } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Deterministic HSL tint fallback when a team has no stored brand colour.
function hueFor(name) {
  let h = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

const SOURCE_LABEL = {
  fixture: "Fixture",
  booking: "Pitch booking",
  membership: "Membership",
  class: "Class booking",
  class_package: "Class package",
  pt: "PT session",
  room_hire: "Room hire",
};
const SOURCE_ICON = {
  fixture: "shield", booking: "calendar", membership: "card",
  class: "grid", class_package: "grid", pt: "figure", room_hire: "door",
};

// venue_record_payment accepts these four methods only. "bank" maps to bank_transfer.
const PAY_METHODS = [
  { id: "cash", method: "cash",          label: "Cash",          desc: "Taken at reception", icon: "pound" },
  { id: "card", method: "card",          label: "Card",          desc: "Venue terminal",     icon: "card" },
  { id: "bank", method: "bank_transfer", label: "Bank transfer", desc: "Needs a reference",  icon: "globe", needsRef: true },
  { id: "other", method: "other",        label: "Other",         desc: "Add a note",         icon: "dots",  needsNote: true },
];

function fmtDue(d) {
  if (!d) return null;
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch { return null; }
}

// Brand-colour crest for team charges; the colour is DB-sourced (not a hardcoded literal).
function Crest({ team, name, size = 34, r = 9 }) {
  const label = team?.name || name || "—";
  const c1 = team?.primary_colour || null;
  const c2 = team?.secondary_colour || team?.primary_colour || null;
  const hue = hueFor(label);
  const bg = c1
    ? `linear-gradient(135deg, ${c1} 0 55%, ${c2} 100%)`
    : `linear-gradient(135deg, hsl(${hue} 46% 42%) 0 52%, hsl(${hue} 46% 30%) 100%)`;
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: bg, color: "white", fontSize: size * 0.34, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(label)}</div>
  );
}

function SourceTile({ source, size = 34, r = 9 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s3)",
    }}><MIcon name={SOURCE_ICON[source] || "pound"} size={size * 0.5} color="var(--ink2)" /></div>
  );
}

function StatusPill({ status }) {
  const map = {
    paid:     { label: "Paid",      bg: "var(--ok-soft)",    fg: "var(--ok-ink)" },
    unpaid:   { label: "Unpaid",    bg: "var(--amber-soft)", fg: "var(--amber)" },
    partial:  { label: "Part-paid", bg: "var(--info-soft)",  fg: "var(--info-ink)" },
    refunded: { label: "Void",      bg: "var(--s3)",         fg: "var(--ink3)" },
  };
  const m = map[status] || map.unpaid;
  return (
    <span style={{
      height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center",
      background: m.bg, color: m.fg, fontSize: 11, fontWeight: 800, letterSpacing: "0.02em",
    }}>{m.label}</span>
  );
}

const FILTERS = [["all", "All"], ["unpaid", "Unpaid"], ["partial", "Part"], ["paid", "Paid"]];

export default function OperatorPayments({ venueId, venueName, toast }) {
  const [state, setState] = useState({ loading: true, error: false, charges: null, summary: null, teams: {}, payLink: null });
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState(""); // name search (payer / team / run label) — rides mig 523 payer_name
  const [recordFor, setRecordFor] = useState(null); // charge object or null

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, charges: null, summary: null, teams: {}, payLink: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Fetch ALL charges (status null) so the headline tiles stay venue-wide; the
      // ledger filters client-side. venueGetState supplies team names + brand colours
      // + the venue pay link.
      const [charges, vstate] = await Promise.all([
        venueGetCharges(venueId, { status: null, limit: 500 }),
        venueGetState(venueId),
      ]);
      setState({
        loading: false, error: false,
        charges: charges?.charges || [],
        summary: charges?.summary || {},
        teams: vstate?.teams || {},
        payLink: vstate?.venue?.payment_link || null,
      });
    } catch {
      setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, charges, summary, teams, payLink } = state;
  const needle = q.trim().toLowerCase();

  const rows = useMemo(() => {
    if (!charges) return [];
    let r = filter === "all" ? charges : charges.filter((c) => c.status === filter);
    if (needle) {
      r = r.filter((c) => {
        const tName = c.team_id ? (teams[c.team_id]?.name || "") : "";
        return String(c.payer_name || "").toLowerCase().includes(needle)
          || tName.toLowerCase().includes(needle)
          || String(c.run_label || "").toLowerCase().includes(needle);
      });
    }
    return r;
  }, [charges, filter, needle, teams]);

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Payments</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading payments for {venueName || "your venue"}…</p>
      </div>
    );
  }
  if (error || !charges) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Payments</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load payments right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  const rate = summary?.collection_rate; // 0–100 or null
  const teamName = (id) => (id ? teams[id]?.name : null);

  const copyLink = async () => {
    if (!payLink) return;
    try { await navigator.clipboard?.writeText(payLink); toast?.({ icon: "check", text: "Link copied" }); }
    catch { toast?.({ icon: "info", text: payLink }); }
  };

  return (
    <div>
      {/* ── stat tiles 2×2 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
        <BigStat label="Owed" value={gbp(summary?.owed_pence)} tone="ink" onClick={() => setFilter("all")} />
        <BigStat label="Collected" value={gbp(summary?.collected_pence)} tone="ok" onClick={() => setFilter("paid")} />
        <BigStat label="Outstanding" value={gbp(summary?.outstanding_pence)} tone="amber" onClick={() => setFilter("unpaid")} />
        <div className="m-card" style={{ padding: "13px 14px" }}>
          <span className="m-eyebrow" style={{ fontSize: 10.5 }}>Collection</span>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 5, fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
            {rate == null ? "—" : Math.round(rate) + "%"}
          </div>
          <div style={{ height: 5, borderRadius: 3, background: "var(--s3)", marginTop: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: (rate == null ? 0 : Math.max(0, Math.min(100, rate))) + "%", background: "var(--ok)", borderRadius: 3, transition: "width .3s" }} />
          </div>
        </div>
      </div>

      {/* ── online pay link ── */}
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", marginTop: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <MIcon name="globe" size={18} color="var(--amber)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, letterSpacing: "0.04em" }}>ONLINE PAY LINK</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: payLink ? "var(--ink)" : "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {payLink ? payLink.replace(/^https?:\/\//, "") : "No online pay link set"}
          </div>
        </div>
        {payLink && (
          <button onClick={copyLink} aria-label="Copy pay link" style={{
            width: 34, height: 34, borderRadius: 10, flex: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--s3)", border: "1px solid var(--hair2)",
          }}><MIcon name="qr" size={17} color="var(--ink2)" /></button>
        )}
      </div>

      {/* ── name search (payer · team · run) — rides mig 523 payer_name ── */}
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 14px", height: 44, marginTop: 14, background: "var(--s2)" }}>
        <MIcon name="search" size={18} color="var(--ink3)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…"
          style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15 }} />
        {q && (
          <button onClick={() => setQ("")} aria-label="Clear search" style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}>
            <MIcon name="x" size={16} color="var(--ink3)" />
          </button>
        )}
      </div>

      {/* ── filters ── */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 0 4px", scrollbarWidth: "none" }}>
        {FILTERS.map(([id, label]) => {
          const on = filter === id;
          return (
            <button key={id} onClick={() => setFilter(id)} style={{
              height: 30, padding: "0 13px", borderRadius: "var(--r-pill)", cursor: "pointer", flex: "none",
              fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13,
              background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--amber)" : "var(--ink2)",
              border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)",
            }}>{label}</button>
          );
        })}
      </div>

      {/* ── charges ledger ── */}
      <div style={{ marginTop: 10 }}>
        {rows.length === 0 ? (
          <div className="m-card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink3)" }}>
            <MIcon name="pound" size={24} color="var(--ink4)" />
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>
              {needle
                ? "No charges match that search"
                : filter === "all" ? "No charges yet" : `No ${FILTERS.find((f) => f[0] === filter)?.[1].toLowerCase()} charges`}
            </div>
          </div>
        ) : rows.map((c) => {
          const tName = teamName(c.team_id);
          const srcLabel = SOURCE_LABEL[c.source_type] || c.source_type;
          // Who + what: team charges show the team; membership/class/PT/room-hire show
          // the payer's name (mig 523 payer_name), then a run label, then the source.
          const title = tName || c.payer_name || c.run_label || srcLabel;
          const subParts = [];
          if (title !== srcLabel) subParts.push(srcLabel);
          subParts.push(gbp(c.amount_due_pence));
          const due = fmtDue(c.due_date);
          if (due) subParts.push(`due ${due}`);
          const actionable = c.status === "unpaid" || c.status === "partial";
          const Tag = actionable ? "button" : "div";
          return (
            <Tag key={c.id} onClick={actionable ? () => setRecordFor(c) : undefined}
              className="m-card" style={{
                width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: actionable ? "pointer" : "default",
                padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, marginBottom: 9,
              }}>
              {c.team_id ? <Crest team={teams[c.team_id]} name={tName} /> : <SourceTile source={c.source_type} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink)" }}>{title}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{subParts.join(" · ")}</div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <StatusPill status={c.status} />
                {c.status !== "paid" && c.status !== "refunded" && (
                  <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{gbp(c.balance_pence)} due</div>
                )}
                {c.pay_intent_method && actionable && (
                  <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 2, fontWeight: 700 }}>says {c.pay_intent_method === "cash" ? "cash" : "bank"}</div>
                )}
                {c.last_reminded_at && (
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>reminded{c.last_reminder_stage ? ` · ${c.last_reminder_stage}` : ""}</div>
                )}
              </div>
              {actionable && <MIcon name="chevron" size={15} color="var(--ink4)" />}
            </Tag>
          );
        })}
      </div>

      {recordFor && (
        <RecordPaymentSheet
          charge={recordFor}
          teamName={teamName(recordFor.team_id)}
          team={recordFor.team_id ? teams[recordFor.team_id] : null}
          venueId={venueId}
          onClose={() => setRecordFor(null)}
          onDone={async () => { setRecordFor(null); await load(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

function BigStat({ label, value, tone, onClick }) {
  const color = { ink: "var(--ink)", ok: "var(--ok-ink)", amber: "var(--amber)" }[tone] || "var(--ink)";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="m-card" style={{
      padding: "13px 14px", width: "100%", textAlign: "left",
      cursor: onClick ? "pointer" : "default", fontFamily: "var(--m-font)", color: "inherit",
    }}>
      <span className="m-eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 5, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </Tag>
  );
}

// Progressive step (port of the prototype's Step): collapsed summary w/ Edit once done,
// expanded content while active, greyed + uneditable while locked.
function Step({ n, done, active, locked, label, value, onEdit, children }) {
  const badgeBg = active ? "var(--amber)" : done ? "var(--ok-soft)" : "var(--s3)";
  const badgeFg = active ? "var(--amber-ink)" : done ? "var(--ok-ink)" : "var(--ink3)";
  return (
    <div className="m-card" style={{ padding: "13px 14px", marginBottom: 10, opacity: locked ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{
          width: 26, height: 26, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
          background: badgeBg, color: badgeFg, fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
        }}>{done && !active ? <MIcon name="check" size={14} color="var(--ok-ink)" /> : n}</span>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: active ? "var(--ink)" : "var(--ink2)" }}>{label}</span>
        {done && !active && (
          <>
            {value ? <span style={{ fontSize: 13, color: "var(--ink2)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span> : null}
            {!locked && (
              <button onClick={onEdit} style={{
                background: "none", border: "none", cursor: "pointer", color: "var(--amber)", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13, padding: "2px 4px",
              }}>Edit</button>
            )}
          </>
        )}
      </div>
      {active && <div style={{ marginTop: 13 }}>{children}</div>}
    </div>
  );
}

function FieldLabel({ children }) {
  return <div className="m-eyebrow" style={{ margin: "14px 2px 7px" }}>{children}</div>;
}

const inputStyle = {
  width: "100%", height: 46, padding: "0 14px", borderRadius: 12, boxSizing: "border-box",
  background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 15, outline: "none",
};

function RecordPaymentSheet({ charge, teamName, team, venueId, onClose, onDone, toast }) {
  const balance = charge.balance_pence;
  const title = teamName || charge.payer_name || charge.run_label || SOURCE_LABEL[charge.source_type] || charge.source_type;
  const srcLabel = SOURCE_LABEL[charge.source_type] || charge.source_type;

  const [open, setOpen] = useState("amount"); // 'amount' | 'method'
  const [mode, setMode] = useState("full"); // 'full' | 'custom'
  const [custom, setCustom] = useState("");
  const [methodId, setMethodId] = useState(null);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  const amountPence = mode === "full" ? balance : Math.round((parseFloat(custom) || 0) * 100);
  const amtValid = amountPence > 0 && amountPence <= balance;
  const m = PAY_METHODS.find((x) => x.id === methodId);
  const detailOk = !m ? false : m.needsRef ? ref.trim() !== "" : m.needsNote ? note.trim() !== "" : true;
  const dAmtDone = amtValid;
  const dMethodDone = !!m && detailOk;
  const allDone = dAmtDone && dMethodDone;

  const hint = !amtValid ? "Enter an amount" : !m ? "Choose a method" : m.needsRef ? "Add a reference" : m.needsNote ? "Add a note" : "";
  const cta = `Record ${gbp(amountPence)} · ${m ? m.label : ""}`;

  const confirm = async () => {
    if (!allDone || savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      await venueRecordPayment(venueId, charge.id, amountPence, m.method, {
        externalRef: m.needsRef ? ref.trim() : null,
        note: m.needsNote ? note.trim() : null,
      });
      const full = amountPence >= balance;
      toast?.({
        icon: "check", text: `${gbp(amountPence)} recorded`,
        sub: full ? `${title} · paid in full` : `${title} · ${gbp(balance - amountPence)} still due`,
      });
      await onDone();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't record — try again" });
      savingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <MobileSheet title="Record payment" onClose={busy ? undefined : onClose} footer={
      <button onClick={confirm} disabled={!allDone || busy} style={{
        width: "100%", height: 48, borderRadius: 14, border: "none", cursor: allDone && !busy ? "pointer" : "default",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: allDone ? "var(--amber)" : "var(--s3)", color: allDone ? "var(--amber-ink)" : "var(--ink3)", opacity: busy ? 0.7 : 1,
      }}>
        {allDone ? (busy ? "Recording…" : cta) : hint}
      </button>
    }>
      {/* context header */}
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--s2)", marginBottom: 14 }}>
        {charge.team_id ? <Crest team={team} name={teamName} size={40} r={11} /> : <SourceTile source={charge.source_type} size={40} r={11} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink)" }}>{title}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{srcLabel} · {gbp(charge.amount_due_pence)} total</div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div className="m-eyebrow" style={{ fontSize: 10 }}>Balance</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--amber)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{gbp(balance)}</div>
        </div>
      </div>

      {/* 1 · amount */}
      <Step n={1} done={dAmtDone && open !== "amount"} active={open === "amount"} locked={false}
        label={dAmtDone && open !== "amount" ? "Amount" : "How much are they paying?"}
        value={`${gbp(amountPence)}${mode === "full" ? " · full" : ""}`} onEdit={() => setOpen("amount")}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setMode("full"); setOpen("method"); }} style={chipStyle(mode === "full")}>Full · {gbp(balance)}</button>
          <button onClick={() => setMode("custom")} style={{ ...chipStyle(mode === "custom"), flex: "none", padding: "0 18px" }}>Part</button>
        </div>
        {mode === "custom" && (
          <>
            <FieldLabel>Amount received</FieldLabel>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, fontWeight: 700, color: "var(--ink3)", pointerEvents: "none" }}>£</span>
              <input type="number" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)}
                placeholder={(balance / 100).toFixed(2)} style={{ ...inputStyle, paddingLeft: 28 }} />
            </div>
            {custom !== "" && !amtValid && <div style={{ fontSize: 12.5, color: "var(--live-ink)", marginTop: 7 }}>Enter an amount up to {gbp(balance)}.</div>}
            {mode === "custom" && amtValid && (
              <button onClick={() => setOpen("method")} style={{
                width: "100%", height: 42, marginTop: 12, borderRadius: 12, border: "none", cursor: "pointer",
                background: "var(--amber-soft)", color: "var(--amber)", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 14,
              }}>Continue</button>
            )}
          </>
        )}
      </Step>

      {/* 2 · method */}
      <Step n={2} done={dMethodDone && open !== "method"} active={open === "method"} locked={!dAmtDone}
        label={dMethodDone && open !== "method" ? "Method" : "How did they pay?"}
        value={m ? m.label + (m.needsRef && ref ? ` · ${ref}` : "") : ""} onEdit={() => setOpen("method")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PAY_METHODS.map((o) => {
            const on = methodId === o.id;
            return (
              <button key={o.id} onClick={() => setMethodId(o.id)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 13, cursor: "pointer", textAlign: "left",
                background: "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)", color: "inherit",
              }}>
                <span style={{
                  width: 38, height: 38, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                  background: on ? "var(--amber)" : "var(--s3)",
                }}><MIcon name={o.icon} size={18} color={on ? "var(--amber-ink)" : "var(--ink2)"} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", display: "block" }}>{o.label}</span>
                  <span style={{ fontSize: 12.5, color: "var(--ink3)", display: "block", marginTop: 1 }}>{o.desc}</span>
                </span>
                {on && <MIcon name="check" size={18} color="var(--amber)" />}
              </button>
            );
          })}
        </div>
        {m && m.needsRef && (
          <>
            <FieldLabel>Bank reference</FieldLabel>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. DEMOFC-0612" style={inputStyle} />
          </>
        )}
        {m && m.needsNote && (
          <>
            <FieldLabel>Note</FieldLabel>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="How was this paid?" style={inputStyle} />
          </>
        )}
      </Step>
    </MobileSheet>
  );
}

function chipStyle(on) {
  return {
    flex: 1, height: 44, borderRadius: 12, cursor: "pointer",
    fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 14,
    background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--amber)" : "var(--ink2)",
    border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)",
  };
}
