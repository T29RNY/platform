import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  supabase,
  venueGetCharges, venueRecordPayment, venueVoidCharge,
  venueAddFixtureCharge, venueUpdateBookingSettings,
  venueVoidPayment, venueSetChargeDue,
  venueBulkChargePreview, venueBulkChargeCommit, venueVoidBillingRun, venueListBillingRuns,
  venuePaymentReconciliation,
  venuePriceChangePreview, venueBulkPriceChangeCommit, venueRefundChargeResolve, venueRecordRefund,
  venueListMembershipTiers, venueListClubs, clubListTeams,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

const API_BASE = import.meta.env.VITE_INOROUT_API_URL ?? "";

// Venue Payments — record cash/transfer, balances + collection rate, add/void
// per-fixture charges, edit the hosted pay link. RPCs: venueGetCharges /
// venueRecordPayment / venueVoidCharge / venueAddFixtureCharge /
// venueUpdateBookingSettings.

const gbp = (pence) => (pence == null ? "—" : "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS = {
  unpaid:   { label: "Unpaid",    cls: "pill-muted" },
  partial:  { label: "Part-paid", cls: "pill-warn" },
  paid:     { label: "Paid",      cls: "pill-ok" },
  refunded: { label: "Refunded",  cls: "pill-muted" }, // status covers refunds AND voids; the row disambiguates via refunded_pence
};
// status='refunded' is overloaded (venue_void_charge sets it too). A refund has refunded_pence>0;
// a void has 0 (payments kept). Row label reflects the real thing.
function chargeStatusChip(c) {
  if (c.status === "refunded") {
    return (c.refunded_pence || 0) > 0
      ? { label: "Refunded", cls: "pill-muted" }
      : { label: "Voided",   cls: "pill-muted" };
  }
  return STATUS[c.status] || { label: c.status, cls: "pill-muted" };
}
// The pseudo-status a charge FILTERS by — same split as the chip, so 'refunded' and 'voided' are
// distinct filter options even though they share the DB status='refunded'.
function chargeStatusKey(c) {
  if (c.status === "refunded") return (c.refunded_pence || 0) > 0 ? "refunded" : "voided";
  return c.status; // unpaid | partial | paid
}
const STATUS_OPTIONS = [
  { key: "unpaid",   label: "Unpaid" },
  { key: "partial",  label: "Part-paid" },
  { key: "paid",     label: "Paid" },
  { key: "refunded", label: "Refunded" },
  { key: "voided",   label: "Voided" },
];

// A checkbox multi-select dropdown (matches .btn styling). Empty selection = All.
function StatusMultiSelect({ options, selected, onChange, counts }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // fixed-position coords, measured from the trigger on open
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const summary = selected.size === 0
    ? "Status: All"
    : "Status: " + options.filter((o) => selected.has(o.key)).map((o) => o.label).join(", ");
  const toggle = (k) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    onChange(next);
  };
  // Open with a fixed-position panel (escapes the .dt-card overflow:hidden clip that would cut off
  // the menu when the charges table is short). The panel stays a DOM child of ref, so click-outside
  // (ref.contains) still works.
  const toggleOpen = () => {
    if (open) { setOpen(false); return; }
    const r = ref.current?.getBoundingClientRect();
    setPos(r ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : null);
    setOpen(true);
  };
  const row = { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn btn-sm" onClick={toggleOpen} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
        {summary} <span style={{ opacity: 0.6, marginLeft: 4 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "fixed", top: pos?.top ?? 0, right: pos?.right ?? 8, zIndex: 1000, background: "var(--bg-4)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: 6, minWidth: 180, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <label style={{ ...row, fontWeight: 600 }}>
            <input type="checkbox" checked={selected.size === 0} onChange={() => onChange(new Set())} /> All
          </label>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          {options.map((o) => (
            <label key={o.key} style={row}>
              <input type="checkbox" checked={selected.has(o.key)} onChange={() => toggle(o.key)} />
              <span style={{ flex: 1 }}>{o.label}</span>
              {counts && <span className="text-mute" style={{ fontSize: 12 }}>{counts[o.key] || 0}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
// Human label per charge source (mirrors apps/inorout OperatorPayments SOURCE_LABEL) — so a
// membership / class / camp / PT / room-hire charge no longer reads as a bare "Booking".
const SOURCE_LABEL = {
  fixture: "Fixture", booking: "Pitch booking", membership: "Membership",
  class: "Class booking", class_package: "Class package", pt: "PT session", room_hire: "Room hire",
};
const METHODS = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["other", "Other"]];

// A charge's filterable "kind" — its source_type, but 'class' splits into class vs camp via is_camp
// so the Type filter can isolate camps. DATA-DRIVEN: any new source_type flows through unchanged, so
// a new booking type auto-appears in the filter without a code change.
function chargeKind(c) {
  if (c.source_type === "class") return c.is_camp ? "camp" : "class";
  return c.source_type;
}
const KIND_LABEL = { ...SOURCE_LABEL, camp: "Camp" };

export default function PaymentsView({ state, venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusSel, setStatusSel] = useState(() => new Set()); // status multi-select; empty = All
  const [typeFilter, setTypeFilter] = useState("all"); // charge kind (membership / class / camp / …)
  const [tierFilter, setTierFilter] = useState("all"); // membership tier
  const [cohortFilter, setCohortFilter] = useState("all");
  const [recordFor, setRecordFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const [dueFor, setDueFor] = useState(null);          // charge whose owed amount is being edited
  const [paymentsFor, setPaymentsFor] = useState(null); // charge id whose payments are being shown/undone
  const [link, setLink] = useState(state?.venue?.payment_link ?? "");
  const [editingLink, setEditingLink] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [priceWizardOpen, setPriceWizardOpen] = useState(false);
  const [refundFor, setRefundFor] = useState(null); // charge being refunded
  const [runs, setRuns] = useState([]);
  const [recon, setRecon] = useState(null); // Phase 6 #6.3 reconciliation summary (read-only)

  const teamName = useCallback((id) => (id ? (state?.teams?.[id]?.name || id) : null), [state]);

  const fixtures = useMemo(() => {
    const g = state?.fixtures ?? {};
    const all = [...(g.tonight ?? []), ...(g.this_week ?? []), ...(g.upcoming ?? []), ...(g.recent ?? [])];
    const seen = new Map();
    all.forEach((f) => { if (!seen.has(f.id)) seen.set(f.id, f); });
    return [...seen.values()].sort((a, b) => (b.scheduled_date || "").localeCompare(a.scheduled_date || ""));
  }, [state]);

  // Load ALL charges once; status/type/tier/cohort filtering + the summary are computed client-side
  // (below) so the totals update live as you filter and the filter options stay data-driven.
  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try {
      // High cap so the client-computed summary covers the whole venue (totals must reflect the
      // filtered slice — which the server can't compute). Beyond this the headline totals reflect
      // the loaded set; well above any realistic venue's charge count.
      const d = await venueGetCharges(venueToken, { limit: 5000 });
      setData(d);
    } catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);

  const loadRuns = useCallback(async () => {
    if (!venueToken) return;
    try { const r = await venueListBillingRuns(venueToken); setRuns(r?.runs ?? []); }
    catch (e) { /* runs are a secondary panel — don't block the ledger on a runs error */ console.error("[payments] loadRuns failed", e); }
  }, [venueToken]);

  const loadRecon = useCallback(async () => {
    if (!venueToken) return;
    try { const r = await venuePaymentReconciliation(venueToken); setRecon(r ?? null); }
    catch (e) { /* reconciliation is a secondary read-only panel — don't block the ledger */ console.error("[payments] loadRecon failed", e); }
  }, [venueToken]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => { loadRecon(); }, [loadRecon]);

  const onVoidRun = async (run) => {
    if (!window.confirm(`Void the whole "${run.label}" run? Its ${run.member_count} charge(s) drop out of owed/collected. Money already collected is not auto-refunded.`)) return;
    setBusy(true);
    try { await venueVoidBillingRun(venueToken, run.run_id); await Promise.all([load(), loadRuns()]); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const onWizardDone = async () => {
    setWizardOpen(false);
    await Promise.all([load(), loadRuns()]);
  };

  const onPriceWizardDone = async () => {
    setPriceWizardOpen(false);
    await load();
  };

  const onRefundDone = async () => {
    setRefundFor(null);
    await load();
  };

  const onRecord = async (chargeId, amountPence, method, note) => {
    setBusy(true);
    try { await venueRecordPayment(venueToken, chargeId, amountPence, method, { note }); setRecordFor(null); await load(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };
  const onVoidCharge = async (charge) => {
    if (!window.confirm(`Void this charge${charge.team_id ? ` for ${teamName(charge.team_id)}` : ""}? It drops out of owed/collected; recorded payments are kept.`)) return;
    setBusy(true);
    try { await venueVoidCharge(venueToken, charge.id); await load(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };
  const onAddCharge = async (fixtureId, teamId, amountPence) => {
    setBusy(true);
    try { await venueAddFixtureCharge(venueToken, fixtureId, teamId, amountPence); setAdding(false); await load(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };
  const onSetDue = async (chargeId, amountPence) => {
    setBusy(true);
    try { await venueSetChargeDue(venueToken, chargeId, amountPence); setDueFor(null); await load(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };
  const onVoidPayment = async (paymentId) => {
    setBusy(true);
    try { await venueVoidPayment(venueToken, paymentId); await load(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };
  const onSaveLink = async () => {
    setBusy(true);
    try {
      const next = link.trim() || null;
      await venueUpdateBookingSettings(venueToken, { payment_link: next });
      setLink(next || ""); setEditingLink(false);
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  if (err) return <EmptyState title="Couldn’t load payments" body={err} action={<button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setErr(null); load(); }}>Retry</button>} />;
  if (!data) return <EmptyState title="Loading payments…" />;

  const charges = data.charges ?? [];

  // Data-driven filter options — derived from whatever the loaded charges actually carry, so a new
  // booking type / tier / cohort appears automatically with no code change.
  const typeOptions = [...new Set(charges.map(chargeKind))].sort();
  const tierOptions = [...new Set(charges.map((c) => c.tier_name).filter(Boolean))].sort();
  const cohortOptions = [...new Set(charges.map((c) => c.cohort_name).filter(Boolean))].sort();

  // Per-status counts (data-driven) for the multi-select dropdown; 'refunded' vs 'voided' split.
  const statusCounts = charges.reduce((m, c) => { const k = chargeStatusKey(c); m[k] = (m[k] || 0) + 1; return m; }, {});

  const filteredCharges = charges.filter((c) =>
    (statusSel.size === 0 || statusSel.has(chargeStatusKey(c))) &&
    (typeFilter === "all" || chargeKind(c) === typeFilter) &&
    (tierFilter === "all" || c.tier_name === tierFilter) &&
    (cohortFilter === "all" || c.cohort_name === cohortFilter));

  // Summary recomputed from the FILTERED slice so the cards reflect the current filters (voids/refunds
  // excluded from money totals — matches the server's status<>'refunded'; paid_pence is already net of
  // refunds). Turns the top row into "how much is owed/collected in <this slice>".
  const live = filteredCharges.filter((c) => c.status !== "refunded");
  const owedP = live.reduce((a, c) => a + (c.amount_due_pence || 0), 0);
  const collectedP = live.reduce((a, c) => a + (c.paid_pence || 0), 0);
  const s = {
    owed_pence: owedP,
    collected_pence: collectedP,
    outstanding_pence: live.reduce((a, c) => a + Math.max((c.amount_due_pence || 0) - (c.paid_pence || 0), 0), 0),
  };
  const rate = owedP === 0 ? null : Math.round((1000 * collectedP) / owedP) / 10;

  // payCharge derives live from the reloaded list so the payments modal updates
  // the moment a payment is voided (paymentsFor holds the id, not a snapshot).
  const payCharge = paymentsFor ? charges.find((c) => c.id === paymentsFor) : null;

  return (
    <div>
      <div className="stat-row">
        <Stat label="Owed" value={gbp(s.owed_pence)} />
        <Stat label="Collected" value={gbp(s.collected_pence)} tone="ok" />
        <Stat label="Outstanding" value={gbp(s.outstanding_pence)} tone="crit" />
        <Stat label="Collection rate" value={rate == null ? "—" : rate + "%"}
          bar={rate == null ? null : Math.max(0, Math.min(100, rate))} />
      </div>

      <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "var(--gap-2)" }}>
        <Icon name="pound" size={16} />
        {!editingLink ? (
          <>
            {link
              ? <span className="text-mute">Online pay link: <a href={link} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{link}</a></span>
              : <span className="text-mute">No online pay link set.</span>}
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-ghost" onClick={() => setEditingLink(true)}>{link ? "Edit" : "Add link"}</button>
          </>
        ) : (
          <>
            <input className="input" type="url" value={link} placeholder="https://…" onChange={(e) => setLink(e.target.value)} autoFocus style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" onClick={onSaveLink} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setLink(state?.venue?.payment_link ?? ""); setEditingLink(false); }} disabled={busy}>Cancel</button>
          </>
        )}
      </div>

      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Charges</strong>
          {charges.length > 0 && <span className="text-mute">{filteredCharges.length === charges.length ? charges.length : `${filteredCharges.length} of ${charges.length}`}</span>}
          <span style={{ flex: 1 }} />
          <StatusMultiSelect options={STATUS_OPTIONS} selected={statusSel} onChange={setStatusSel} counts={statusCounts} />
          {/* Data-driven filters — options come from the loaded charges, so a new type/tier/cohort auto-appears. */}
          {typeOptions.length > 1 && (
            <select className="input" style={{ width: "auto", height: 30, padding: "0 8px" }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} title="Filter by type">
              <option value="all">All types</option>
              {typeOptions.map((k) => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}
            </select>
          )}
          {tierOptions.length > 0 && (
            <select className="input" style={{ width: "auto", height: 30, padding: "0 8px" }} value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} title="Filter by membership tier">
              <option value="all">All tiers</option>
              {tierOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {cohortOptions.length > 0 && (
            <select className="input" style={{ width: "auto", height: 30, padding: "0 8px" }} value={cohortFilter} onChange={(e) => setCohortFilter(e.target.value)} title="Filter by cohort">
              <option value="all">All cohorts</option>
              {cohortOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button className="btn btn-sm" onClick={() => setWizardOpen(true)}>
            <Icon name="pound" size={14} /> Mass invoice
          </button>
          <button className="btn btn-sm" onClick={() => setPriceWizardOpen(true)}>
            <Icon name="pound" size={14} /> Change price
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)} disabled={fixtures.length === 0}>
            <Icon name="plus" size={14} /> Add charge
          </button>
        </div>

        {charges.length === 0 ? (
          <div style={{ padding: 32 }}>
            <EmptyState title="No charges" body="Charges appear when bookings are confirmed and fixtures generated (once a fee is set), or add one manually above." />
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Source</th><th>Team</th><th className="num">Due</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {filteredCharges.length === 0 ? (
                <tr><td colSpan={7} className="text-mute" style={{ padding: 24, textAlign: "center" }}>No charges match these filters.</td></tr>
              ) : filteredCharges.map((c) => {
                const st = chargeStatusChip(c);
                return (
                  <tr key={c.id}>
                    <td>{KIND_LABEL[chargeKind(c)] || "Charge"}{c.payer_name ? <span className="text-mute"> · {c.payer_name}</span> : null}{c.due_date ? <span className="text-mute"> · {c.due_date}</span> : null}
                      {c.member_discount_pct ? <span className="pill pill-ok" style={{ marginLeft: 8 }} title="Member booking discount applied">{c.member_discount_pct}% member</span> : null}</td>
                    <td className="text-mute">{teamName(c.team_id) || "—"}</td>
                    <td className="num">{gbp(c.amount_due_pence)}</td>
                    <td className="num">
                      {c.payments?.length ? (
                        <button type="button" onClick={() => setPaymentsFor(c.id)} title="View / undo payments"
                          style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", textDecoration: "underline dotted", padding: 0 }}>
                          {gbp(c.paid_pence)}
                        </button>
                      ) : gbp(c.paid_pence)}
                    </td>
                    <td className="num">{gbp(c.balance_pence)}</td>
                    <td>
                      <span className={"pill " + st.cls}><span className="pill-dot" /> {st.label}</span>
                      {(c.refunded_pence || 0) > 0 && c.status !== "refunded"
                        ? <span className="pill pill-muted" style={{ marginLeft: 6 }} title="Part of this charge was refunded to the payer">{gbp(c.refunded_pence)} refunded</span> : null}
                      {c.pay_intent_method && (c.status === "unpaid" || c.status === "partial")
                        ? <span className="pill pill-warn" style={{ marginLeft: 6 }} title="The family said they'll pay this way — record it when it lands">says {c.pay_intent_method === "cash" ? "cash" : "bank"}</span> : null}
                      {c.last_reminded_at
                        ? <div className="text-mute" style={{ fontSize: 11, marginTop: 2 }}>reminded{c.last_reminder_stage ? ` · ${c.last_reminder_stage}` : ""}{c.reminder_count > 1 ? ` ×${c.reminder_count}` : ""}</div> : null}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {c.status !== "paid" && c.status !== "refunded" && (
                        <button className="btn btn-xs" onClick={() => setRecordFor(c)}>Record payment</button>
                      )}
                      {c.status !== "refunded" && (
                        <button className="btn btn-xs" style={{ marginLeft: 6 }} onClick={() => setDueFor(c)}>Edit due</button>
                      )}
                      {(c.status === "paid" || c.status === "partial") && c.paid_pence > 0 && (
                        <button className="btn btn-xs" style={{ marginLeft: 6 }} onClick={() => setRefundFor(c)} disabled={busy}>Refund</button>
                      )}
                      {c.status !== "refunded" && (
                        <button className="btn btn-xs btn-danger" style={{ marginLeft: 6 }} onClick={() => onVoidCharge(c)} disabled={busy}>Void</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {runs.length > 0 && (
        <div className="dt-card" style={{ marginTop: "var(--gap-2)" }}>
          <div className="dt-toolbar">
            <strong style={{ fontSize: 15 }}>Billing runs</strong>
            <span className="text-mute">{runs.length}</span>
          </div>
          <table className="dt">
            <thead>
              <tr><th>Run</th><th>Cohort</th><th className="num">Members</th><th className="num">Billed</th><th className="num">Collected</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id}>
                  <td>{r.label}{r.due_date ? <span className="text-mute"> · due {r.due_date}</span> : null}
                    {r.pay_online ? <span className="pill pill-ok" style={{ marginLeft: 8 }} title="Members can pay online">Online</span> : null}
                    {r.prorate ? <span className="pill pill-muted" style={{ marginLeft: 6 }} title="Pro-rated for late joiners">Pro-rata</span> : null}</td>
                  <td className="text-mute">{r.cohort_type}</td>
                  <td className="num">{r.member_count}</td>
                  <td className="num">{gbp(r.total_pence)}</td>
                  <td className="num">{gbp(r.collected_pence)}</td>
                  <td><span className={"pill " + (r.status === "voided" ? "pill-muted" : "pill-ok")}><span className="pill-dot" /> {r.status === "voided" ? "Voided" : "Sent"}</span></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.status !== "voided" && (
                      <button className="btn btn-xs btn-danger" onClick={() => onVoidRun(r)} disabled={busy}>Void run</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recon?.summary && (() => {
        const rs = recon.summary;
        const bm = recon.by_method || {};
        const stripePence = bm.stripe || 0;
        const manualPence = Object.entries(bm).reduce((t, [k, v]) => t + (k === "stripe" ? 0 : (v || 0)), 0);
        const methodOrder = [["stripe", "Stripe"], ["cash", "Cash"], ["card", "Card"], ["bank_transfer", "Transfer"], ["other", "Other"]];
        const rows = methodOrder.filter(([k]) => bm[k]).concat(
          Object.keys(bm).filter((k) => !methodOrder.some(([mk]) => mk === k)).map((k) => [k, k])
        );
        return (
          <div className="dt-card" style={{ marginTop: "var(--gap-2)" }}>
            <div className="dt-toolbar">
              <strong style={{ fontSize: 15 }}>Reconciliation</strong>
              <span className="text-mute">all time</span>
            </div>
            <div className="stat-row" style={{ padding: "var(--gap-1)" }}>
              <Stat label="Raised" value={gbp(rs.raised_pence)} />
              <Stat label="Paid" value={gbp(rs.paid_pence)} tone="ok" />
              <Stat label="Overdue" value={gbp(rs.overdue_pence)} tone="crit" />
              <Stat label="Collection rate" value={rs.collection_rate == null ? "—" : rs.collection_rate + "%"}
                bar={rs.collection_rate == null ? null : Math.max(0, Math.min(100, rs.collection_rate))} />
            </div>
            <table className="dt">
              <thead><tr><th>Collected by method</th><th className="num">Amount</th></tr></thead>
              <tbody>
                <tr>
                  <td>Stripe (online) <span className="text-mute">vs manual {gbp(manualPence)}</span></td>
                  <td className="num">{gbp(stripePence)}</td>
                </tr>
                {rows.map(([k, label]) => (
                  <tr key={k}>
                    <td className="text-mute">{label}</td>
                    <td className="num">{gbp(bm[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {wizardOpen && (
        <BulkInvoiceWizard venueToken={venueToken} onClose={() => setWizardOpen(false)} onDone={onWizardDone} />
      )}
      {priceWizardOpen && (
        <PriceChangeWizard venueToken={venueToken} onClose={() => setPriceWizardOpen(false)} onDone={onPriceWizardDone} />
      )}
      {refundFor && (
        <RefundModal charge={refundFor} venueToken={venueToken} onClose={() => setRefundFor(null)} onDone={onRefundDone} teamName={teamName(refundFor.team_id)} />
      )}
      {recordFor && (
        <RecordModal charge={recordFor} busy={busy} onClose={() => setRecordFor(null)} onSubmit={onRecord} teamName={teamName(recordFor.team_id)} />
      )}
      {adding && (
        <AddChargeModal fixtures={fixtures} busy={busy} teamName={teamName} onClose={() => setAdding(false)} onSubmit={onAddCharge} />
      )}
      {dueFor && (
        <DueModal charge={dueFor} busy={busy} onClose={() => setDueFor(null)} onSubmit={onSetDue} teamName={teamName(dueFor.team_id)} />
      )}
      {payCharge && (
        <PaymentsModal charge={payCharge} busy={busy} onClose={() => setPaymentsFor(null)} onVoid={onVoidPayment} teamName={teamName(payCharge.team_id)} />
      )}
    </div>
  );
}

function Stat({ label, value, tone, bar }) {
  return (
    <div className={"stat" + (tone ? " stat--" + tone : "")}>
      <div className="stat-head"><span>{label}</span></div>
      <div className="stat-value">{value}</div>
      {bar != null && <div className="bar"><div className="bar-fill" style={{ width: bar + "%" }} /></div>}
    </div>
  );
}

function RecordModal({ charge, busy, onClose, onSubmit, teamName }) {
  const [amount, setAmount] = useState(((charge.balance_pence ?? 0) / 100).toFixed(2));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  const submit = () => {
    const pence = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(pence) || pence <= 0) return;
    onSubmit(charge.id, pence, method, note.trim() || null);
  };

  return (
    <Modal onClose={onClose} title="Record payment"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Record"}</button>
      </>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>
        {charge.source_type === "fixture" ? "Fixture" : "Booking"}{teamName ? ` · ${teamName}` : ""} · balance £{((charge.balance_pence ?? 0) / 100).toFixed(2)}
      </p>
      <label className="field-label">Amount (£)</label>
      <input className="input" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus style={{ marginBottom: 12 }} />
      <label className="field-label">Method</label>
      <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} style={{ marginBottom: 12 }}>
        {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <label className="field-label">Note (optional)</label>
      <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="reference, payer…" />
    </Modal>
  );
}

function AddChargeModal({ fixtures, busy, teamName, onClose, onSubmit }) {
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id || "");
  const fixture = fixtures.find((f) => f.id === fixtureId);
  const teamOptions = fixture ? [fixture.home_team_id, fixture.away_team_id].filter(Boolean) : [];
  const [teamId, setTeamId] = useState(teamOptions[0] || "");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    const opts = fixture ? [fixture.home_team_id, fixture.away_team_id].filter(Boolean) : [];
    if (!opts.includes(teamId)) setTeamId(opts[0] || "");
  }, [fixtureId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!fixtureId || !teamId) return;
    let pence = null;
    if (amount.trim() !== "") {
      pence = Math.round(parseFloat(amount) * 100);
      if (!Number.isFinite(pence) || pence <= 0) return;
    }
    onSubmit(fixtureId, teamId, pence);
  };

  return (
    <Modal onClose={onClose} title="Add fixture charge"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy || !teamId}>{busy ? "Adding…" : "Add charge"}</button>
      </>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>Charge a team for a fixture. Leave the amount blank to use the league fee.</p>
      <label className="field-label">Fixture</label>
      <select className="input" value={fixtureId} onChange={(e) => setFixtureId(e.target.value)} autoFocus style={{ marginBottom: 12 }}>
        {fixtures.map((f) => (
          <option key={f.id} value={f.id}>{(f.scheduled_date || "TBC")} · {teamName(f.home_team_id) || "?"} v {teamName(f.away_team_id) || "?"}</option>
        ))}
      </select>
      <label className="field-label">Team</label>
      <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ marginBottom: 12 }}>
        {teamOptions.map((id) => <option key={id} value={id}>{teamName(id)}</option>)}
      </select>
      <label className="field-label">Amount (£, optional)</label>
      <input className="input" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="league default" />
    </Modal>
  );
}

// Adjust the amount owed on a charge (discount / correction) without voiding it.
function DueModal({ charge, busy, onClose, onSubmit, teamName }) {
  const [amount, setAmount] = useState(((charge.amount_due_pence ?? 0) / 100).toFixed(2));

  const submit = () => {
    const pence = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(pence) || pence < 0) return;
    onSubmit(charge.id, pence);
  };

  return (
    <Modal onClose={onClose} title="Edit amount owed"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>
        {charge.source_type === "fixture" ? "Fixture" : "Booking"}{teamName ? ` · ${teamName}` : ""} · paid £{((charge.paid_pence ?? 0) / 100).toFixed(2)}
      </p>
      <label className="field-label">Amount owed (£)</label>
      <input className="input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <p className="text-mute" style={{ fontSize: 12, marginTop: 10 }}>Sets the total due. Recorded payments are kept; the balance recalculates.</p>
    </Modal>
  );
}

// ── Mass invoicing wizard (mig 405) ──────────────────────────────────────────
// 4 steps: (1) cohort, (2) charge label/amount/due/pay-online, (3) interactive
// preview (tick/untick; auto-skips locked w/ reason; running total), (4) type-to-
// confirm total → Send. Members are billed per active membership.
const SKIP_LABEL = { paused: "Paused", left: "Left", "already-billed": "Already billed" };

function BulkInvoiceWizard({ venueToken, onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [cohorts, setCohorts] = useState([]);
  const [loadingCohorts, setLoadingCohorts] = useState(true);
  const [cohortKey, setCohortKey] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [prorate, setProrate] = useState(false);
  const [payOnline, setPayOnline] = useState(false);
  const [preview, setPreview] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [tiersRes, clubs] = await Promise.all([venueListMembershipTiers(venueToken), venueListClubs(venueToken)]);
        const opts = [];
        (tiersRes?.tiers ?? tiersRes ?? []).forEach((t) => opts.push({ key: `tier:${t.tier_id}`, type: "tier", ref: t.tier_id, label: `Tier · ${t.name}` }));
        for (const c of (clubs ?? [])) {
          // venue_list_clubs returns `id` (not club_id); club_list_teams returns `team_id` + `name`.
          opts.push({ key: `club:${c.id}`, type: "club", ref: c.id, label: `Whole club · ${c.name}` });
          try {
            const teams = await clubListTeams(venueToken, c.id);
            (teams ?? []).forEach((tm) => opts.push({ key: `team:${tm.team_id}`, type: "team", ref: tm.team_id, label: `Team · ${tm.name}` }));
          } catch (e) { /* a club with no team structure is fine */ }
        }
        setCohorts(opts);
        if (opts[0]) setCohortKey(opts[0].key);
      } catch (e) { setErr(e?.message || String(e)); }
      finally { setLoadingCohorts(false); }
    })();
  }, [venueToken]);

  const cohort = cohorts.find((c) => c.key === cohortKey) || null;
  const amountPence = Math.round(parseFloat(amount) * 100);
  const amountValid = Number.isFinite(amountPence) && amountPence > 0;
  const labelValid = label.trim().length > 0;

  const members = preview?.members ?? [];
  const included = members.filter((m) => m.will_invoice && !excluded.has(m.membership_id));
  const runningTotal = included.reduce((sum, m) => sum + (m.amount_pence || 0), 0);

  const toggle = (id) => {
    setExcluded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const goPreview = async () => {
    if (!cohort || !labelValid || !amountValid) return;
    setBusy(true); setErr(null);
    try {
      const p = await venueBulkChargePreview(venueToken, {
        cohortType: cohort.type, cohortRef: cohort.ref, label: label.trim(),
        amountPence, dueDate: dueDate || null, prorate,
      });
      setPreview(p); setExcluded(new Set()); setStep(3);
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!cohort) return;
    setBusy(true); setErr(null);
    try {
      const excludedIds = members.filter((m) => m.will_invoice && excluded.has(m.membership_id)).map((m) => m.membership_id);
      const res = await venueBulkChargeCommit(venueToken, {
        cohortType: cohort.type, cohortRef: cohort.ref, label: label.trim(),
        amountPence, dueDate: dueDate || null, prorate, payOnline, excludedIds,
      });
      if (payOnline && res?.run_id) {
        // Best-effort: create the Stripe invoices. The ledger charges already exist and
        // reconcile on payment, so a transient API hiccup here doesn't lose the run.
        try {
          const { data: { session } = {} } = await supabase.auth.getSession();
          await fetch(`${API_BASE}/api/stripe-bulk-invoices`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
            body: JSON.stringify({ runId: res.run_id, venueToken }),
          });
        } catch (e) { console.error("[payments] stripe-bulk-invoices failed", e); }
      }
      onDone(res);
    } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };

  const totalStr = "£" + (runningTotal / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const confirmMatches = confirmText.trim() === totalStr || confirmText.trim() === (runningTotal / 100).toFixed(2);

  const foot = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <span className="spacer" />
      {step > 1 && step < 4 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}
      {step === 1 && <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!cohort}>Next</button>}
      {step === 2 && <button className="btn btn-primary" onClick={goPreview} disabled={busy || !labelValid || !amountValid}>{busy ? "Loading…" : "Preview"}</button>}
      {step === 3 && <button className="btn btn-primary" onClick={() => setStep(4)} disabled={included.length === 0}>Review {included.length} · {totalStr}</button>}
      {step === 4 && <button className="btn btn-primary" onClick={commit} disabled={busy || !confirmMatches || included.length === 0}>{busy ? "Sending…" : `Send ${included.length} invoice(s)`}</button>}
    </>
  );

  return (
    <Modal onClose={onClose} title="Mass invoice" foot={foot}>
      {err && <p className="pill pill-warn" style={{ marginBottom: 12 }}>{err}</p>}

      {step === 1 && (
        <div>
          <p className="text-mute" style={{ marginBottom: 14 }}>Bill a one-off charge to a group of members. Pick who to bill.</p>
          {loadingCohorts ? <p className="text-mute">Loading groups…</p> : cohorts.length === 0 ? (
            <p className="text-mute">No membership tiers, clubs or teams to bill yet.</p>
          ) : (
            <>
              <label className="field-label">Group</label>
              <select className="input" value={cohortKey} onChange={(e) => setCohortKey(e.target.value)} autoFocus>
                {cohorts.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <p className="text-mute" style={{ fontSize: 12, marginTop: 10 }}>Only active members are billed. Paused / left members are skipped automatically; you can untick anyone who paid another way at the preview step.</p>
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div>
          <label className="field-label">What's it for</label>
          <input className="input" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. U12 tournament fee" autoFocus style={{ marginBottom: 12 }} />
          <label className="field-label">Amount per member (£)</label>
          <input className="input" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15.00" style={{ marginBottom: 12 }} />
          <label className="field-label">Due date (optional)</label>
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ marginBottom: 12 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={prorate} onChange={(e) => setProrate(e.target.checked)} />
            <span>Pro-rate for late joiners <span className="text-mute">(season tiers — charges a part-season slice)</span></span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={payOnline} onChange={(e) => setPayOnline(e.target.checked)} />
            <span>Let them pay online <span className="text-mute">(emails each member a Stripe pay link)</span></span>
          </label>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
            <strong>{included.length} to invoice</strong>
            <span className="text-mute">{members.filter((m) => !m.will_invoice).length} auto-skipped</span>
            <span style={{ flex: 1 }} />
            <strong>{totalStr}</strong>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
            {members.map((m) => {
              const locked = !m.will_invoice;
              const ticked = m.will_invoice && !excluded.has(m.membership_id);
              return (
                <div key={m.membership_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", opacity: locked ? 0.55 : 1 }}>
                  <input type="checkbox" disabled={locked} checked={ticked} onChange={() => toggle(m.membership_id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>{m.member_name}</div>
                  {locked
                    ? <span className="pill pill-muted">{SKIP_LABEL[m.skip_reason] || m.skip_reason}</span>
                    : <span className="num">{gbp(m.amount_pence)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <p style={{ marginBottom: 14 }}>You're about to invoice <strong>{included.length}</strong> member(s) for <strong>{label.trim()}</strong>, totalling <strong>{totalStr}</strong>{payOnline ? ", with online payment links" : ""}.</p>
          <label className="field-label">Type the total to confirm ({totalStr})</label>
          <input className="input" type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={totalStr} autoFocus />
        </div>
      )}
    </Modal>
  );
}

// List a charge's recorded payments and undo any single one (venue_void_payment).
function PaymentsModal({ charge, busy, onClose, onVoid, teamName }) {
  const pays = charge?.payments ?? [];
  const methodLabel = (m) => (METHODS.find(([v]) => v === m)?.[1]) || m || "—";
  return (
    <Modal onClose={onClose} title="Recorded payments"
      foot={<button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>
        {charge.source_type === "fixture" ? "Fixture" : "Booking"}{teamName ? ` · ${teamName}` : ""}
      </p>
      {pays.length === 0 ? (
        <p className="text-mute">No active payments — they may have all been undone.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pays.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{gbp(p.amount_pence)}</strong> · {methodLabel(p.method)}
                {p.note ? <span className="text-mute"> · {p.note}</span> : null}
                <div className="text-mute" style={{ fontSize: 12 }}>
                  {p.taken_at ? new Date(p.taken_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                </div>
              </div>
              <button className="btn btn-xs btn-danger" disabled={busy} onClick={() => onVoid(p.id)}>Undo</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// Shared cohort list (tier / whole club / team) — same shape the bulk wizard builds.
async function loadCohortOptions(venueToken) {
  const [tiersRes, clubs] = await Promise.all([venueListMembershipTiers(venueToken), venueListClubs(venueToken)]);
  const opts = [];
  (tiersRes?.tiers ?? tiersRes ?? []).forEach((t) => opts.push({ key: `tier:${t.tier_id}`, type: "tier", ref: t.tier_id, label: `Tier · ${t.name}` }));
  for (const c of (clubs ?? [])) {
    opts.push({ key: `club:${c.id}`, type: "club", ref: c.id, label: `Whole club · ${c.name}` });
    try {
      const teams = await clubListTeams(venueToken, c.id);
      (teams ?? []).forEach((tm) => opts.push({ key: `team:${tm.team_id}`, type: "team", ref: tm.team_id, label: `Team · ${tm.name}` }));
    } catch (e) { /* a club with no team structure is fine */ }
  }
  return opts;
}

// ── Change price wizard (mig 407, Stripe Phase 5) ────────────────────────────────
// Pick a cohort → new price → preview (cash members update now; Stripe sub members get the new
// price at their NEXT renewal — Option A, no mid-cycle proration) → confirm. Season-schedule
// members are auto-skipped (re-priced at next season).
function PriceChangeWizard({ venueToken, onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [cohorts, setCohorts] = useState([]);
  const [loadingCohorts, setLoadingCohorts] = useState(true);
  const [cohortKey, setCohortKey] = useState("");
  const [price, setPrice] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [preview, setPreview] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const opts = await loadCohortOptions(venueToken);
        setCohorts(opts);
        if (opts[0]) setCohortKey(opts[0].key);
      } catch (e) { setErr(e?.message || String(e)); }
      finally { setLoadingCohorts(false); }
    })();
  }, [venueToken]);

  const cohort = cohorts.find((c) => c.key === cohortKey) || null;
  const pricePence = Math.round(parseFloat(price) * 100);
  const priceValid = Number.isFinite(pricePence) && pricePence >= 0;

  const members = preview?.members ?? [];
  const included = members.filter((m) => m.will_change && !excluded.has(m.membership_id));
  const stripeIncluded = included.filter((m) => m.method === "stripe");
  const cashIncluded = included.filter((m) => m.method === "cash");

  const toggle = (id) => setExcluded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const goPreview = async () => {
    if (!cohort || !priceValid) return;
    setBusy(true); setErr(null);
    try {
      const p = await venuePriceChangePreview(venueToken, {
        cohortType: cohort.type, cohortRef: cohort.ref, newPricePence: pricePence, effectiveDate: effectiveDate || null,
      });
      setPreview(p); setExcluded(new Set()); setStep(3);
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!cohort) return;
    setBusy(true); setErr(null);
    try {
      const excludedIds = members.filter((m) => m.will_change && excluded.has(m.membership_id)).map((m) => m.membership_id);
      const res = await venueBulkPriceChangeCommit(venueToken, {
        cohortType: cohort.type, cohortRef: cohort.ref, newPricePence: pricePence,
        effectiveDate: effectiveDate || null, excludedIds,
      });
      const targets = res?.stripe_targets ?? [];
      if (targets.length) {
        // Push the new price onto the Stripe subs (applies next renewal). Best-effort: the cash
        // ledger is already updated; a transient API hiccup here is retried by re-running.
        try {
          const { data: { session } = {} } = await supabase.auth.getSession();
          await fetch(`${API_BASE}/api/stripe-price-change`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
            body: JSON.stringify({ membershipIds: targets.map((t) => t.membership_id), newPricePence: pricePence, venueToken }),
          });
        } catch (e) { console.error("[payments] stripe-price-change failed", e); }
      }
      onDone(res);
    } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };

  const foot = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <span className="spacer" />
      {step === 3 && <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={busy}>Back</button>}
      {step === 1 && <button className="btn btn-primary" onClick={goPreview} disabled={busy || !cohort || !priceValid}>{busy ? "Loading…" : "Preview"}</button>}
      {step === 3 && <button className="btn btn-primary" onClick={commit} disabled={busy || included.length === 0}>{busy ? "Applying…" : `Apply to ${included.length} member(s)`}</button>}
    </>
  );

  return (
    <Modal onClose={onClose} title="Change price" foot={foot}>
      {err && <p className="pill-warn" style={{ padding: 8, marginBottom: 12 }}>{err}</p>}
      {step === 1 && (
        <>
          <label className="field-label">Cohort</label>
          {loadingCohorts ? <p className="text-mute">Loading cohorts…</p> : (
            <select className="input" value={cohortKey} onChange={(e) => setCohortKey(e.target.value)} style={{ marginBottom: 12 }}>
              {cohorts.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          )}
          <label className="field-label">New price (£)</label>
          <input className="input" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 17.00" style={{ marginBottom: 12 }} />
          <label className="field-label">Effective from (optional)</label>
          <input className="input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          <p className="text-mute" style={{ fontSize: 12, marginTop: 10 }}>
            Card-paying members move to the new price at their next renewal — no mid-month top-up. Cash members’ expected amount updates straight away. Season-plan members are skipped (re-price at next season).
          </p>
        </>
      )}
      {step === 3 && preview && (
        <>
          <p className="text-mute" style={{ marginBottom: 12 }}>
            New price <strong>{gbp(pricePence)}</strong> · {stripeIncluded.length} on card (next renewal) · {cashIncluded.length} cash (now) · {preview.skip_count} skipped
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {members.map((m) => (
              <label key={m.membership_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", opacity: m.will_change ? 1 : 0.5 }}>
                <input type="checkbox" disabled={!m.will_change} checked={m.will_change && !excluded.has(m.membership_id)} onChange={() => toggle(m.membership_id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{m.member_name}</strong>
                  <span className="text-mute" style={{ fontSize: 12 }}>
                    {" · "}{gbp(m.old_amount_pence)} → {gbp(m.new_amount_pence)}
                    {m.will_change ? ` · ${m.method === "stripe" ? "card" : "cash"}` : ` · skipped (${m.skip_reason})`}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Refund modal (mig 407 + api/stripe-refund, Stripe Phase 5) ───────────────────
// Resolves how much is refundable (and the pro-rated unused season slice) for a Stripe-collected
// charge, then issues a real Stripe refund. The refund lands back in the ledger via the
// charge.refunded webhook. Non-Stripe charges fall back to Void.
// Refund modal — Stripe path when the charge was paid by card (resolves a stripe_charge_ref and
// calls /api/stripe-refund); MANUAL path otherwise (cash/bank paid → record money handed back via
// venue_record_refund, mig 555). Partial allowed on both. A full manual refund flips the charge to
// 'refunded'; a partial leaves it paid/partial with a "£X refunded" annotation on the row.
function RefundModal({ charge, venueToken, onClose, onDone, teamName }) {
  const [info, setInfo] = useState(undefined); // undefined=loading, null=error
  const [mode, setMode] = useState("full");
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState("cash"); // manual refund method
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    venueRefundChargeResolve(venueToken, charge.id)
      .then((d) => { if (alive) { setInfo(d); if (d?.is_season && d?.prorated_unused_pence != null) setMode("prorated"); } })
      .catch((e) => { if (alive) { setInfo(null); setErr(e?.message || String(e)); } });
    return () => { alive = false; };
  }, [venueToken, charge.id]);

  const hasStripe = !!info?.stripe_charge_ref;
  const noStripe = info && !hasStripe;
  const manualRefundable = charge.paid_pence || 0; // net paid (cash/bank/other) refundable by hand
  const customPence = Math.round(parseFloat(custom) * 100);
  const amount = hasStripe
    ? (mode === "full" ? (info?.refundable_pence ?? 0)
       : mode === "prorated" ? (info?.prorated_unused_pence ?? 0)
       : (Number.isFinite(customPence) ? customPence : 0))
    : (mode === "full" ? manualRefundable : (Number.isFinite(customPence) ? customPence : 0));

  const submitStripe = async () => {
    if (!info?.stripe_charge_ref || amount <= 0) return;
    setBusy(true); setErr(null);
    try {
      const { data: { session } = {} } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/api/stripe-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ chargeId: charge.id, mode, amountPence: mode === "amount" ? customPence : undefined, venueToken }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.detail || out.error || "refund_failed");
      onDone(out);
    } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };

  const submitManual = async () => {
    if (amount <= 0 || amount > manualRefundable) return;
    setBusy(true); setErr(null);
    try {
      const out = await venueRecordRefund(venueToken, charge.id, amount, method, { note: note.trim() || null });
      onDone(out);
    } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Refund"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        {hasStripe && <button className="btn btn-primary" onClick={submitStripe} disabled={busy || amount <= 0}>{busy ? "Refunding…" : `Refund ${gbp(amount)}`}</button>}
        {noStripe && manualRefundable > 0 && <button className="btn btn-primary" onClick={submitManual} disabled={busy || amount <= 0 || amount > manualRefundable}>{busy ? "Recording…" : `Record refund ${gbp(amount)}`}</button>}
      </>}>
      {err && <p className="pill-warn" style={{ padding: 8, marginBottom: 12 }}>{err}</p>}
      {info === undefined && <p className="text-mute">Checking the payment…</p>}

      {/* MANUAL refund — the charge wasn't paid by card; record cash/bank money handed back. */}
      {noStripe && manualRefundable > 0 && (
        <>
          <p className="text-mute" style={{ marginBottom: 14 }}>
            {teamName ? `${teamName} · ` : ""}Paid <strong>{gbp(manualRefundable)}</strong> (not by card). Record money handed back — this is not a Stripe refund.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input type="radio" name="rmode" checked={mode === "full"} onChange={() => setMode("full")} />
            Full paid balance · {gbp(manualRefundable)}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input type="radio" name="rmode" checked={mode === "amount"} onChange={() => setMode("amount")} />
            A specific amount
          </label>
          {mode === "amount" && (
            <input className="input" type="number" step="0.01" min="0.01" max={(manualRefundable / 100).toFixed(2)} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="£" autoFocus style={{ marginTop: 4, marginBottom: 10 }} />
          )}
          <label className="text-mute" style={{ display: "block", fontSize: 12, marginBottom: 4, marginTop: 6 }}>Refund method</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </select>
          <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        </>
      )}
      {noStripe && manualRefundable <= 0 && (
        <p className="text-mute">Nothing has been paid on this charge, so there’s nothing to refund. Use <strong>Void</strong> to drop it from owed/collected.</p>
      )}

      {/* STRIPE (card) refund */}
      {hasStripe && (
        <>
          <p className="text-mute" style={{ marginBottom: 14 }}>
            {teamName ? `${teamName} · ` : ""}Refundable <strong>{gbp(info.refundable_pence)}</strong>
            {info.refunded_pence > 0 ? ` (already refunded ${gbp(info.refunded_pence)})` : ""}
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input type="radio" name="rmode" checked={mode === "full"} onChange={() => setMode("full")} />
            Full refundable balance · {gbp(info.refundable_pence)}
          </label>
          {info.is_season && info.prorated_unused_pence != null && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <input type="radio" name="rmode" checked={mode === "prorated"} onChange={() => setMode("prorated")} />
              Unused part of the season · {gbp(info.prorated_unused_pence)}
            </label>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input type="radio" name="rmode" checked={mode === "amount"} onChange={() => setMode("amount")} />
            A specific amount
          </label>
          {mode === "amount" && (
            <input className="input" type="number" step="0.01" min="0.01" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="£" autoFocus style={{ marginTop: 4 }} />
          )}
        </>
      )}
    </Modal>
  );
}
