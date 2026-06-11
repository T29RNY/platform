import React, { useState, useEffect, useCallback } from "react";
import { venueListEquipment, venueUpsertEquipment } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";

// Equipment Hire — catalogue management (Cycle 1 of EQUIPMENT_HIRE_PLAN.md).
// Sport-agnostic: the venue types in its own kit; category is the clean spine.
// RPCs: venueListEquipment (read) / venueUpsertEquipment (create + edit).
// The hire flow (availability, charging, returns) lands in Cycle 2.

const gbp = (pence) => (pence == null ? "—" : "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const CATEGORIES = [
  ["apparel",       "Apparel / bibs"],
  ["balls",         "Balls"],
  ["goals_targets", "Goals & targets"],
  ["nets",          "Nets"],
  ["training_aids", "Training aids"],
  ["tech_av",       "Tech / AV"],
  ["safety",        "Safety"],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);
const HIRE_UNITS = [["per_hour", "per hour"], ["per_session", "per session"], ["per_day", "per day"]];
const UNIT_LABEL = Object.fromEntries(HIRE_UNITS);
const CONDITIONS = [["new", "New"], ["good", "Good"], ["worn", "Worn"], ["damaged", "Damaged"], ["retired", "Retired"]];
const COND_LABEL = Object.fromEntries(CONDITIONS);

export default function EquipmentView({ venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // item being edited, or {} for a new one

  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try { setData(await venueListEquipment(venueToken)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);

  useEffect(() => { load(); }, [load]);

  const onSave = async (form) => {
    setBusy(true);
    try { await venueUpsertEquipment(venueToken, form); setEditing(null); await load(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  if (err) return <EmptyState title="Couldn’t load equipment" body={err} action={<button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setErr(null); load(); }}>Retry</button>} />;
  if (!data) return <EmptyState title="Loading equipment…" />;

  const s = data.summary ?? {};
  const items = data.equipment ?? [];

  return (
    <div>
      <div className="stat-row">
        <Stat label="Items" value={s.item_count ?? 0} />
        <Stat label="Active units" value={s.total_units ?? 0} />
        <Stat label="Asset value" value={gbp(s.asset_value_pence)} />
      </div>

      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Catalogue</strong>
          {items.length > 0 && <span className="text-mute">{items.length}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={14} /> Add equipment
          </button>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: 32 }}>
            <EmptyState title="No equipment yet" body="Add the kit your venue hires out — bibs, balls, goals, nets, training aids, AV. Set a price and quantity per item." />
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Item</th><th>Category</th><th className="num">Qty</th><th className="num">Fee</th><th className="num">Deposit</th><th>Condition</th><th /></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={it.active ? undefined : { opacity: 0.5 }}>
                  <td><strong>{it.name}</strong>{!it.active && <span className="text-mute"> · inactive</span>}</td>
                  <td className="text-mute">{CAT_LABEL[it.category] || it.category}</td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{gbp(it.default_fee_pence)}<span className="text-mute" style={{ fontSize: 11 }}> /{(UNIT_LABEL[it.hire_unit] || it.hire_unit).replace("per ", "")}</span></td>
                  <td className="num">{it.deposit_pence ? gbp(it.deposit_pence) : "—"}</td>
                  <td className="text-mute">{COND_LABEL[it.condition] || it.condition}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-xs" onClick={() => setEditing(it)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EquipmentModal item={editing} busy={busy} onClose={() => setEditing(null)} onSubmit={onSave} />
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={"stat" + (tone ? " stat--" + tone : "")}>
      <div className="stat-head"><span>{label}</span></div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// Create (item = {}) or edit a catalogue item. Money fields are entered in £.
function EquipmentModal({ item, busy, onClose, onSubmit }) {
  const isNew = !item.id;
  const [name, setName] = useState(item.name ?? "");
  const [category, setCategory] = useState(item.category ?? "apparel");
  const [quantity, setQuantity] = useState(String(item.quantity ?? 1));
  const [fee, setFee] = useState(((item.default_fee_pence ?? 0) / 100).toFixed(2));
  const [deposit, setDeposit] = useState(((item.deposit_pence ?? 0) / 100).toFixed(2));
  const [hireUnit, setHireUnit] = useState(item.hire_unit ?? "per_session");
  const [cost, setCost] = useState(item.purchase_price_pence != null ? (item.purchase_price_pence / 100).toFixed(2) : "");
  const [acquiredOn, setAcquiredOn] = useState(item.acquired_on ?? "");
  const [condition, setCondition] = useState(item.condition ?? "good");
  const [active, setActive] = useState(item.active ?? true);

  const poundsToPence = (v, fallback) => {
    if (v == null || String(v).trim() === "") return fallback;
    const p = Math.round(parseFloat(v) * 100);
    return Number.isFinite(p) && p >= 0 ? p : fallback;
  };

  const submit = () => {
    const qty = parseInt(quantity, 10);
    if (!name.trim() || !Number.isFinite(qty) || qty < 0) return;
    onSubmit({
      id: item.id ?? null,
      name: name.trim(),
      category,
      quantity: qty,
      defaultFeePence: poundsToPence(fee, 0),
      depositPence: poundsToPence(deposit, 0),
      hireUnit,
      purchasePricePence: cost.trim() === "" ? null : poundsToPence(cost, null),
      acquiredOn: acquiredOn || null,
      condition,
      active,
    });
  };

  return (
    <Modal onClose={onClose} title={isNew ? "Add equipment" : "Edit equipment"}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>{busy ? "Saving…" : (isNew ? "Add" : "Save")}</button>
      </>}>
      <label className="field-label">Name</label>
      <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bib set (12)" autoFocus style={{ marginBottom: 12 }} />

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 2 }}>
          <label className="field-label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Quantity</label>
          <input className="input" type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Hire fee (£)</label>
          <input className="input" type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Per</label>
          <select className="input" value={hireUnit} onChange={(e) => setHireUnit(e.target.value)}>
            {HIRE_UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Deposit (£)</label>
          <input className="input" type="number" min="0" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Purchase cost (£, optional)</label>
          <input className="input" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="for asset value" />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Acquired (optional)</label>
          <input className="input" type="date" value={acquiredOn} onChange={(e) => setAcquiredOn(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Condition</label>
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Active — available to hire</span>
      </label>
    </Modal>
  );
}
