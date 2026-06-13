import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  venueGetCharges, venueRecordPayment, venueVoidCharge,
  venueAddFixtureCharge, venueUpdateBookingSettings,
  venueVoidPayment, venueSetChargeDue,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

// Venue Payments — record cash/transfer, balances + collection rate, add/void
// per-fixture charges, edit the hosted pay link. RPCs: venueGetCharges /
// venueRecordPayment / venueVoidCharge / venueAddFixtureCharge /
// venueUpdateBookingSettings.

const gbp = (pence) => (pence == null ? "—" : "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS = {
  unpaid:   { label: "Unpaid",    cls: "pill-muted" },
  partial:  { label: "Part-paid", cls: "pill-warn" },
  paid:     { label: "Paid",      cls: "pill-ok" },
  refunded: { label: "Voided",    cls: "pill-muted" },
};
const METHODS = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["other", "Other"]];

export default function PaymentsView({ state, venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [recordFor, setRecordFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const [dueFor, setDueFor] = useState(null);          // charge whose owed amount is being edited
  const [paymentsFor, setPaymentsFor] = useState(null); // charge id whose payments are being shown/undone
  const [link, setLink] = useState(state?.venue?.payment_link ?? "");
  const [editingLink, setEditingLink] = useState(false);

  const teamName = useCallback((id) => (id ? (state?.teams?.[id]?.name || id) : null), [state]);

  const fixtures = useMemo(() => {
    const g = state?.fixtures ?? {};
    const all = [...(g.tonight ?? []), ...(g.this_week ?? []), ...(g.upcoming ?? []), ...(g.recent ?? [])];
    const seen = new Map();
    all.forEach((f) => { if (!seen.has(f.id)) seen.set(f.id, f); });
    return [...seen.values()].sort((a, b) => (b.scheduled_date || "").localeCompare(a.scheduled_date || ""));
  }, [state]);

  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try {
      const d = await venueGetCharges(venueToken, { status: filter === "all" ? null : filter, limit: 500 });
      setData(d);
    } catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken, filter]);

  useEffect(() => { load(); }, [load]);

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

  const s = data.summary ?? {};
  const charges = data.charges ?? [];
  const rate = s.collection_rate;
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
          {charges.length > 0 && <span className="text-mute">{charges.length}</span>}
          <span style={{ flex: 1 }} />
          <span className="chips">
            {["all", "unpaid", "partial", "paid", "refunded"].map((f) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : STATUS[f].label}
              </button>
            ))}
          </span>
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
              {charges.map((c) => {
                const st = STATUS[c.status] || { label: c.status, cls: "pill-muted" };
                return (
                  <tr key={c.id}>
                    <td>{c.source_type === "fixture" ? "Fixture" : "Booking"}{c.due_date ? <span className="text-mute"> · {c.due_date}</span> : null}
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
                    <td><span className={"pill " + st.cls}><span className="pill-dot" /> {st.label}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {c.status !== "paid" && c.status !== "refunded" && (
                        <button className="btn btn-xs" onClick={() => setRecordFor(c)}>Record payment</button>
                      )}
                      {c.status !== "refunded" && (
                        <button className="btn btn-xs" style={{ marginLeft: 6 }} onClick={() => setDueFor(c)}>Edit due</button>
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
