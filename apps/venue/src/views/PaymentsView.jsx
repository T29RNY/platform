import React, { useState, useEffect, useCallback } from "react";
import {
  venueGetCharges, venueRecordPayment, venueVoidPayment, venueSetChargeDue,
} from "@platform/core/storage/supabase.js";

// Venue Payments Ledger V3 — record cash/transfer, see balances + collection rate.
// Read/write over the V2 RPCs (migs 180/181). Per-fixture charge add/void and
// payment_link editing are deferred to V3.1 (need new write RPCs).

const gbp = (pence) => (pence == null ? "—" : "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS_LABEL = { unpaid: "Unpaid", partial: "Part-paid", paid: "Paid", refunded: "Refunded" };
const METHODS = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["other", "Other"]];

export default function PaymentsView({ state, venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all"); // all | unpaid | partial | paid | refunded
  const [recordFor, setRecordFor] = useState(null); // charge obj

  const venue = state?.venue ?? {};
  const teamName = useCallback((id) => {
    if (!id) return null;
    const t = (state?.leagues ?? []).flatMap((l) => l.teams ?? []).find((x) => x.id === id);
    return t?.name || id;
  }, [state]);

  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try {
      const d = await venueGetCharges(venueToken, { status: filter === "all" ? null : filter, limit: 500 });
      setData(d);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }, [venueToken, filter]);

  useEffect(() => { load(); }, [load]);

  const onRecord = async (chargeId, amountPence, method, note) => {
    setBusy(true);
    try {
      await venueRecordPayment(venueToken, chargeId, amountPence, method, { note });
      setRecordFor(null);
      await load();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const onVoidCharge = async (charge) => {
    // V3 has no void-payment-by-charge picker yet; void is per-payment in V3.1.
    // Here we expose set-due=0 isn't right either — so keep void out of V3 UI for now.
  };

  if (err) return <div className="content"><div className="card"><h1>Payments</h1><p className="muted">{err}</p></div></div>;
  if (!data) return <div className="content"><p className="muted">Loading payments…</p></div>;

  const s = data.summary ?? {};
  const charges = data.charges ?? [];

  return (
    <main className="content payments-view">
      <section className="panel">
        <h2>Money</h2>
        <div className="pay-summary">
          <div className="pay-stat"><span className="pay-stat-n">{gbp(s.owed_pence)}</span><span className="pay-stat-l">Owed</span></div>
          <div className="pay-stat"><span className="pay-stat-n">{gbp(s.collected_pence)}</span><span className="pay-stat-l">Collected</span></div>
          <div className="pay-stat"><span className="pay-stat-n">{gbp(s.outstanding_pence)}</span><span className="pay-stat-l">Outstanding</span></div>
          <div className="pay-stat"><span className="pay-stat-n">{s.collection_rate == null ? "—" : s.collection_rate + "%"}</span><span className="pay-stat-l">Collection rate</span></div>
        </div>
        {venue.payment_link && (
          <p className="muted pay-link">Online pay link: <a href={venue.payment_link} target="_blank" rel="noreferrer">{venue.payment_link}</a></p>
        )}
      </section>

      <section className="panel">
        <div className="pay-toolbar">
          <h2>Charges {charges.length > 0 && <span className="panel-count">{charges.length}</span>}</h2>
          <div className="pay-filters">
            {["all", "unpaid", "partial", "paid", "refunded"].map((f) => (
              <button key={f} className={"btn-link" + (filter === f ? " is-active" : "")} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        {charges.length === 0 ? (
          <p className="muted">No charges{filter !== "all" ? ` (${STATUS_LABEL[filter] || filter})` : ""}. Charges are created when bookings are confirmed and fixtures generated (once a fee is set).</p>
        ) : (
          <table className="atable pay-table">
            <thead>
              <tr><th>Source</th><th>Team</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td>{c.source_type === "fixture" ? "Fixture" : "Booking"}{c.due_date ? <span className="muted"> · {c.due_date}</span> : null}</td>
                  <td className="muted">{teamName(c.team_id) || "—"}</td>
                  <td className="num">{gbp(c.amount_due_pence)}</td>
                  <td className="num">{gbp(c.paid_pence)}</td>
                  <td className="num">{gbp(c.balance_pence)}</td>
                  <td><span className={"pay-badge pay-" + c.status}>{STATUS_LABEL[c.status] || c.status}</span></td>
                  <td>
                    {c.status !== "paid" && c.status !== "refunded" && (
                      <button className="btn-link" onClick={() => setRecordFor(c)}>Record payment</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {recordFor && (
        <RecordModal
          charge={recordFor}
          busy={busy}
          onClose={() => setRecordFor(null)}
          onSubmit={onRecord}
          teamName={teamName(recordFor.team_id)}
        />
      )}
    </main>
  );
}

function RecordModal({ charge, busy, onClose, onSubmit, teamName }) {
  const [amount, setAmount] = useState(((charge.balance_pence ?? 0) / 100).toFixed(2));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const pence = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(pence) || pence <= 0) return;
    onSubmit(charge.id, pence, method, note.trim() || null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Record payment</h3>
        <p className="muted">
          {charge.source_type === "fixture" ? "Fixture" : "Booking"}
          {teamName ? ` · ${teamName}` : ""} · balance £{((charge.balance_pence ?? 0) / 100).toFixed(2)}
        </p>
        <form onSubmit={submit}>
          <label>Amount (£)
            <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          <label>Method
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Note (optional)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="reference, payer…" />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-link" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-accent" disabled={busy}>{busy ? "Saving…" : "Record"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
