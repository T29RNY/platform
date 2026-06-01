import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  venueGetCharges, venueRecordPayment, venueVoidCharge,
  venueAddFixtureCharge, venueUpdateBookingSettings,
} from "@platform/core/storage/supabase.js";

// Venue Payments Ledger V3 + V3.1 — record cash/transfer, see balances + collection
// rate, add/void per-fixture charges, edit the hosted online pay link.
// Read/write over the V2 (migs 180/181) + V3.1 (mig 183) RPCs.

const gbp = (pence) => (pence == null ? "—" : "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS_LABEL = { unpaid: "Unpaid", partial: "Part-paid", paid: "Paid", refunded: "Voided" };
const METHODS = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["other", "Other"]];

export default function PaymentsView({ state, venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all"); // all | unpaid | partial | paid | refunded
  const [recordFor, setRecordFor] = useState(null); // charge obj
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState(state?.venue?.payment_link ?? "");
  const [editingLink, setEditingLink] = useState(false);

  const teamName = useCallback((id) => (id ? (state?.teams?.[id]?.name || id) : null), [state]);

  // every fixture with a date, newest first, for the add-charge picker
  const fixtures = useMemo(() => {
    const groups = state?.fixtures ?? {};
    const all = [...(groups.tonight ?? []), ...(groups.this_week ?? []), ...(groups.upcoming ?? []), ...(groups.recent ?? [])];
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
    try {
      await venueRecordPayment(venueToken, chargeId, amountPence, method, { note });
      setRecordFor(null);
      await load();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const onVoidCharge = async (charge) => {
    if (!window.confirm(`Void this charge${charge.team_id ? ` for ${teamName(charge.team_id)}` : ""}? It drops out of owed/collected; any recorded payments are kept in history.`)) return;
    setBusy(true);
    try {
      await venueVoidCharge(venueToken, charge.id);
      await load();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const onAddCharge = async (fixtureId, teamId, amountPence) => {
    setBusy(true);
    try {
      await venueAddFixtureCharge(venueToken, fixtureId, teamId, amountPence);
      setAdding(false);
      await load();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const onSaveLink = async () => {
    setBusy(true);
    try {
      const next = link.trim() || null;
      await venueUpdateBookingSettings(venueToken, { payment_link: next });
      setLink(next || "");
      setEditingLink(false);
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  if (err) return <div className="content"><div className="card"><h1>Payments</h1><p className="muted">{err}</p><button className="btn-link" onClick={() => { setErr(null); load(); }}>Retry</button></div></div>;
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

        <div className="pay-link-row">
          {!editingLink ? (
            <>
              {link
                ? <span className="muted">Online pay link: <a href={link} target="_blank" rel="noreferrer">{link}</a></span>
                : <span className="muted">No online pay link set.</span>}
              <button className="btn-link" onClick={() => setEditingLink(true)}>{link ? "Edit" : "Add link"}</button>
            </>
          ) : (
            <div className="pay-link-edit">
              <input type="url" value={link} placeholder="https://…" onChange={(e) => setLink(e.target.value)} autoFocus />
              <button className="btn-accent" onClick={onSaveLink} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              <button className="btn-link" onClick={() => { setLink(state?.venue?.payment_link ?? ""); setEditingLink(false); }} disabled={busy}>Cancel</button>
            </div>
          )}
        </div>
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
            <button className="btn-accent btn-sm" onClick={() => setAdding(true)} disabled={fixtures.length === 0}>+ Add charge</button>
          </div>
        </div>

        {charges.length === 0 ? (
          <p className="muted">No charges{filter !== "all" ? ` (${STATUS_LABEL[filter] || filter})` : ""}. Charges are created when bookings are confirmed and fixtures generated (once a fee is set), or add one manually above.</p>
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
                  <td className="pay-actions">
                    {c.status !== "paid" && c.status !== "refunded" && (
                      <button className="btn-link" onClick={() => setRecordFor(c)}>Record payment</button>
                    )}
                    {c.status !== "refunded" && (
                      <button className="btn-link btn-danger" onClick={() => onVoidCharge(c)} disabled={busy}>Void</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {recordFor && (
        <RecordModal charge={recordFor} busy={busy} onClose={() => setRecordFor(null)} onSubmit={onRecord} teamName={teamName(recordFor.team_id)} />
      )}
      {adding && (
        <AddChargeModal fixtures={fixtures} busy={busy} teamName={teamName} onClose={() => setAdding(false)} onSubmit={onAddCharge} />
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

function AddChargeModal({ fixtures, busy, teamName, onClose, onSubmit }) {
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id || "");
  const fixture = fixtures.find((f) => f.id === fixtureId);
  const teamOptions = fixture ? [fixture.home_team_id, fixture.away_team_id].filter(Boolean) : [];
  const [teamId, setTeamId] = useState(teamOptions[0] || "");
  const [amount, setAmount] = useState(""); // blank = use league default fee

  // keep team selection valid when the fixture changes
  useEffect(() => {
    const opts = fixture ? [fixture.home_team_id, fixture.away_team_id].filter(Boolean) : [];
    if (!opts.includes(teamId)) setTeamId(opts[0] || "");
  }, [fixtureId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault();
    if (!fixtureId || !teamId) return;
    let pence = null;
    if (amount.trim() !== "") {
      pence = Math.round(parseFloat(amount) * 100);
      if (!Number.isFinite(pence) || pence <= 0) return;
    }
    onSubmit(fixtureId, teamId, pence);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add fixture charge</h3>
        <p className="muted">Charge a team for a fixture. Leave the amount blank to use the league fee.</p>
        <form onSubmit={submit}>
          <label>Fixture
            <select value={fixtureId} onChange={(e) => setFixtureId(e.target.value)} autoFocus>
              {fixtures.map((f) => (
                <option key={f.id} value={f.id}>
                  {(f.scheduled_date || "TBC")} · {teamName(f.home_team_id) || "?"} v {teamName(f.away_team_id) || "?"}
                </option>
              ))}
            </select>
          </label>
          <label>Team
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teamOptions.map((id) => <option key={id} value={id}>{teamName(id)}</option>)}
            </select>
          </label>
          <label>Amount (£, optional)
            <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="league default" />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-link" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-accent" disabled={busy || !teamId}>{busy ? "Adding…" : "Add charge"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
