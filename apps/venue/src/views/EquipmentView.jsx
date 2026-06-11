import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  venueListEquipment, venueUpsertEquipment,
  getEquipmentAvailability, venueCreateEquipmentHire,
  venueCancelEquipmentHire, venueListEquipmentHires,
  venueMarkEquipmentOut, venueMarkEquipmentReturned,
  venueEquipmentInsights,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";

// Equipment Hire — catalogue management (Cycle 1) + hire flow (Cycle 2) of
// EQUIPMENT_HIRE_PLAN.md. Sport-agnostic: the venue types in its own kit.
// RPCs: venueListEquipment / venueUpsertEquipment (catalogue);
//       getEquipmentAvailability / venueCreateEquipmentHire /
//       venueCancelEquipmentHire / venueListEquipmentHires (hires).

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
const HIRE_STATUS = {
  requested: { label: "Requested", cls: "pill-warn" },
  confirmed: { label: "Confirmed", cls: "pill-ok" },
  out:       { label: "Out",       cls: "pill-ok" },
  returned:  { label: "Returned",  cls: "pill-muted" },
  cancelled: { label: "Cancelled", cls: "pill-muted" },
  declined:  { label: "Declined",  cls: "pill-muted" },
  overdue:   { label: "Overdue",   cls: "pill-warn" },
};

export default function EquipmentView({ venueToken, state }) {
  const [tab, setTab] = useState("catalogue");
  return (
    <div>
      <div className="chips" style={{ marginBottom: "var(--gap-2)" }}>
        <button className="chip" aria-pressed={tab === "catalogue"} onClick={() => setTab("catalogue")}>Catalogue</button>
        <button className="chip" aria-pressed={tab === "hires"} onClick={() => setTab("hires")}>Hires</button>
        <button className="chip" aria-pressed={tab === "insights"} onClick={() => setTab("insights")}>Insights</button>
      </div>
      {tab === "catalogue" && <CataloguePanel venueToken={venueToken} />}
      {tab === "hires" && <HiresPanel venueToken={venueToken} state={state} />}
      {tab === "insights" && <InsightsPanel venueToken={venueToken} />}
    </div>
  );
}

// ── Catalogue (Cycle 1) ───────────────────────────────────────────────────────
function CataloguePanel({ venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

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

// ── Hires (Cycle 2) ───────────────────────────────────────────────────────────
function todayISO() { const d = new Date(); return d.toISOString().slice(0, 10); }

function HiresPanel({ venueToken, state }) {
  const [date, setDate] = useState(todayISO());
  const [startT, setStartT] = useState("19:00");
  const [endT, setEndT] = useState("21:00");
  const [avail, setAvail] = useState(null);
  const [hires, setHires] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hireFor, setHireFor] = useState(null);   // availability item being hired
  const [returnFor, setReturnFor] = useState(null); // hire being returned
  const [filter, setFilter] = useState("live");   // live | out | overdue | returned | all

  const window = useMemo(() => {
    const from = new Date(`${date}T${startT}`);
    const to = new Date(`${date}T${endT}`);
    if (!(from < to)) return null;
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }, [date, startT, endT]);

  const teamName = useCallback((id) => (id ? (state?.teams?.[id]?.name || id) : null), [state]);

  const loadAvail = useCallback(async () => {
    if (!venueToken || !window) { setAvail(null); return; }
    setErr(null);
    try { setAvail(await getEquipmentAvailability(venueToken, window.fromISO, window.toISO)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken, window]);

  const loadHires = useCallback(async () => {
    if (!venueToken) return;
    try { setHires(await venueListEquipmentHires(venueToken)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);

  useEffect(() => { loadAvail(); }, [loadAvail]);
  useEffect(() => { loadHires(); }, [loadHires]);

  const onCreate = async (form) => {
    setBusy(true);
    try {
      const res = await venueCreateEquipmentHire(venueToken, { ...form, startAt: window.fromISO, endAt: window.toISO });
      if (!res?.ok) { setErr(res?.reason === "insufficient_quantity" ? `Only ${res.free} free in that window (wanted ${res.wanted}).` : "Couldn’t create hire."); return; }
      setHireFor(null); await loadAvail(); await loadHires();
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const onCancel = async (hire) => {
    if (!globalThis.confirm(`Cancel this hire of ${hire.equipment_name}? Its charge is voided (payments kept).`)) return;
    setBusy(true);
    try { await venueCancelEquipmentHire(venueToken, hire.id); await loadAvail(); await loadHires(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const onMarkOut = async (hire) => {
    setBusy(true);
    try { await venueMarkEquipmentOut(venueToken, hire.id); await loadHires(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const onReturn = async (form) => {
    setBusy(true);
    try { await venueMarkEquipmentReturned(venueToken, returnFor.id, form); setReturnFor(null); await loadAvail(); await loadHires(); }
    catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const items = avail?.equipment ?? [];
  const allHires = hires?.hires ?? [];
  const board = hires?.summary ?? {};
  const list = allHires.filter((h) => {
    if (filter === "all") return true;
    if (filter === "live") return h.status === "confirmed" || h.status === "out";
    if (filter === "overdue") return h.is_overdue;
    if (filter === "out") return h.status === "out";
    if (filter === "returned") return h.status === "returned";
    return true;
  });

  return (
    <div>
      {err && (
        <div className="card card-pad" style={{ marginBottom: "var(--gap-2)", display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="alert" size={16} />
          <span style={{ flex: 1 }}>{err}</span>
          <button className="btn btn-xs btn-ghost" onClick={() => setErr(null)}>Dismiss</button>
        </div>
      )}

      <div className="dt-card" style={{ marginBottom: "var(--gap-2)" }}>
        <div className="dt-toolbar" style={{ flexWrap: "wrap", gap: 10 }}>
          <strong style={{ fontSize: 15 }}>Availability</strong>
          <span style={{ flex: 1 }} />
          <label className="field-label" style={{ margin: 0 }}>Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
          <input className="input" type="time" value={startT} onChange={(e) => setStartT(e.target.value)} style={{ width: "auto" }} />
          <span className="text-mute">→</span>
          <input className="input" type="time" value={endT} onChange={(e) => setEndT(e.target.value)} style={{ width: "auto" }} />
        </div>

        {!window ? (
          <div style={{ padding: 24 }}><EmptyState title="Pick a valid window" body="End time must be after start time." /></div>
        ) : !avail ? (
          <div style={{ padding: 24 }}><EmptyState title="Loading availability…" /></div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState title="No active equipment" body="Add items in the Catalogue tab first." /></div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Item</th><th>Category</th><th className="num">Free</th><th className="num">Fee</th><th /></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td><strong>{it.name}</strong></td>
                  <td className="text-mute">{CAT_LABEL[it.category] || it.category}</td>
                  <td className="num"><strong style={{ color: it.free > 0 ? "var(--ok, inherit)" : "var(--warn, inherit)" }}>{it.free}</strong><span className="text-mute"> / {it.quantity}</span></td>
                  <td className="num">{gbp(it.default_fee_pence)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-xs btn-primary" disabled={it.free < 1} onClick={() => setHireFor(it)}>Hire</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="stat-row" style={{ marginBottom: "var(--gap-2)" }}>
        <Stat label="Out now" value={board.out_now ?? 0} />
        <Stat label="Overdue" value={board.overdue ?? 0} tone={(board.overdue ?? 0) > 0 ? "crit" : undefined} />
        <Stat label="Due back today" value={board.due_today ?? 0} />
      </div>

      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Hires</strong>
          {list.length > 0 && <span className="text-mute">{list.length}</span>}
          <span style={{ flex: 1 }} />
          <span className="chips">
            {[["live", "Live"], ["out", "Out"], ["overdue", "Overdue"], ["returned", "Returned"], ["all", "All"]].map(([f, l]) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>
            ))}
          </span>
        </div>
        {!hires ? (
          <div style={{ padding: 24 }}><EmptyState title="Loading hires…" /></div>
        ) : list.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState title="No hires" body="Hire kit from the availability list above." /></div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Item</th><th>Hired by</th><th className="num">Qty</th><th>When</th><th>Due back</th><th>Status</th><th className="num">Charge</th><th className="num">Deposit</th><th /></tr>
            </thead>
            <tbody>
              {list.map((h) => {
                const st = h.is_overdue ? { label: "Overdue", cls: "pill-warn" } : (HIRE_STATUS[h.status] || { label: h.status, cls: "pill-muted" });
                const live = h.status === "confirmed" || h.status === "out";
                return (
                  <tr key={h.id} style={live ? undefined : { opacity: 0.6 }}>
                    <td><strong>{h.equipment_name}</strong>{h.returned_condition ? <span className="text-mute" style={{ fontSize: 11 }}> · back {COND_LABEL[h.returned_condition] || h.returned_condition}</span> : null}</td>
                    <td className="text-mute">{teamName(h.team_id) || h.booked_by_name || "—"}</td>
                    <td className="num">{h.qty}</td>
                    <td className="text-mute">{fmtWindow(h.start_at, h.end_at)}</td>
                    <td className="text-mute">{h.due_back_at ? fmtDateTime(h.due_back_at) : "—"}</td>
                    <td><span className={"pill " + st.cls}><span className="pill-dot" /> {st.label}</span></td>
                    <td className="num">{h.amount_due_pence != null ? gbp(h.amount_due_pence) : (h.amount_pence ? gbp(h.amount_pence) : "—")}</td>
                    <td className="num">{depositCell(h)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {h.status === "confirmed" && <button className="btn btn-xs" disabled={busy} onClick={() => onMarkOut(h)}>Hand out</button>}
                      {live && <button className="btn btn-xs btn-primary" style={{ marginLeft: 6 }} disabled={busy} onClick={() => setReturnFor(h)}>Return</button>}
                      {live && <button className="btn btn-xs btn-danger" style={{ marginLeft: 6 }} disabled={busy} onClick={() => onCancel(h)}>Cancel</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {hireFor && (
        <HireModal item={hireFor} busy={busy} state={state} window={window}
          onClose={() => setHireFor(null)} onSubmit={onCreate} />
      )}
      {returnFor && (
        <ReturnModal hire={returnFor} busy={busy} onClose={() => setReturnFor(null)} onSubmit={onReturn} />
      )}
    </div>
  );
}

function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function depositCell(h) {
  if (!h.deposit_pence) return "—";
  const amt = gbp(h.deposit_pence);
  if (h.deposit_status === "held") return <span>{amt}<span className="text-mute" style={{ fontSize: 11 }}> held</span></span>;
  if (h.deposit_status === "released") return <span className="text-mute">{amt} released</span>;
  if (h.deposit_status === "forfeited") return <span>{amt}<span className="text-mute" style={{ fontSize: 11 }}> kept</span></span>;
  return amt;
}

function fmtWindow(startISO, endISO) {
  try {
    const s = new Date(startISO), e = new Date(endISO);
    const d = s.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const t = (x) => x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `${d} · ${t(s)}–${t(e)}`;
  } catch { return "—"; }
}

function HireModal({ item, busy, state, window: win, onClose, onSubmit }) {
  const teams = useMemo(() => Object.entries(state?.teams ?? {}).map(([id, t]) => ({ id, name: t.name || id })).sort((a, b) => a.name.localeCompare(b.name)), [state]);
  const [qty, setQty] = useState("1");
  const [bookerKind, setBookerKind] = useState(teams.length ? "team" : "walkin");
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  const [walkName, setWalkName] = useState("");
  const [fee, setFee] = useState(((item.default_fee_pence ?? 0) / 100).toFixed(2));
  const defaultDueBack = useMemo(() => {
    try { const d = new Date(win.toISO); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); }
    catch { return ""; }
  }, [win]);
  const [dueBack, setDueBack] = useState(defaultDueBack);

  const submit = () => {
    const q = parseInt(qty, 10);
    if (!Number.isFinite(q) || q < 1 || q > item.free) return;
    if (bookerKind === "team" && !teamId) return;
    if (bookerKind === "walkin" && !walkName.trim()) return;
    const pence = Math.round(parseFloat(fee) * 100);
    onSubmit({
      equipmentId: item.id, qty: q,
      teamId: bookerKind === "team" ? teamId : null,
      bookedByName: bookerKind === "walkin" ? walkName.trim() : null,
      amountPence: Number.isFinite(pence) && pence >= 0 ? pence : null,
      dueBackAt: dueBack ? new Date(dueBack).toISOString() : null,
    });
  };

  return (
    <Modal onClose={onClose} title={`Hire ${item.name}`}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Confirm hire"}</button>
      </>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>
        {win ? fmtWindow(win.fromISO, win.toISO) : ""} · {item.free} free
      </p>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Quantity</label>
          <input className="input" type="number" min="1" max={item.free} step="1" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Fee (£)</label>
          <input className="input" type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
      </div>

      <label className="field-label">Due back (optional)</label>
      <input className="input" type="datetime-local" value={dueBack} onChange={(e) => setDueBack(e.target.value)} style={{ marginBottom: 12 }} />
      {item.deposit_pence > 0 && <p className="text-mute" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>A {gbp(item.deposit_pence)} deposit will be held.</p>}

      <label className="field-label">Hired by</label>
      <div className="chips" style={{ marginBottom: 10 }}>
        {teams.length > 0 && <button className="chip" aria-pressed={bookerKind === "team"} onClick={() => setBookerKind("team")}>Registered team</button>}
        <button className="chip" aria-pressed={bookerKind === "walkin"} onClick={() => setBookerKind("walkin")}>Walk-up</button>
      </div>
      {bookerKind === "team" ? (
        <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : (
        <input className="input" type="text" value={walkName} onChange={(e) => setWalkName(e.target.value)} placeholder="Name on the hire" />
      )}
    </Modal>
  );
}

function ReturnModal({ hire, busy, onClose, onSubmit }) {
  const [condition, setCondition] = useState("");
  const [forfeit, setForfeit] = useState(false);
  const hasDeposit = hire.deposit_pence > 0 && hire.deposit_status === "held";

  return (
    <Modal onClose={onClose} title={`Return ${hire.equipment_name}`}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => onSubmit({ condition: condition || null, forfeitDeposit: forfeit })} disabled={busy}>{busy ? "Saving…" : "Mark returned"}</button>
      </>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>
        {hire.qty} × {hire.equipment_name}{hire.booked_by_name ? ` · ${hire.booked_by_name}` : ""}
      </p>
      <label className="field-label">Condition back (optional — updates the item)</label>
      <select className="input" value={condition} onChange={(e) => setCondition(e.target.value)} style={{ marginBottom: 12 }}>
        <option value="">No change</option>
        {CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hasDeposit && (
        <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} />
          <span>Keep the {gbp(hire.deposit_pence)} deposit (kit lost/damaged) — otherwise it’s released</span>
        </label>
      )}
    </Modal>
  );
}

// ── Insights (Cycle 5, mig 260) — ROI / usage / procurement ───────────────────
const PAYBACK = {
  recouped:    { label: "Paid back",   cls: "pill-ok" },
  partial:     { label: "Part paid",   cls: "pill-warn" },
  not_started: { label: "No revenue",  cls: "pill-muted" },
  unknown:     { label: "No cost set", cls: "pill-muted" },
};

function InsightsPanel({ venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try { setData(await venueEquipmentInsights(venueToken)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);
  useEffect(() => { load(); }, [load]);

  if (err) return <EmptyState title="Couldn’t load insights" body={err} action={<button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setErr(null); load(); }}>Retry</button>} />;
  if (!data) return <EmptyState title="Loading insights…" />;

  const s = data.summary ?? {};
  const roi = data.roi ?? [];
  const usage = data.usage ?? [];
  const procurement = data.procurement ?? [];
  const range = data.range ?? {};

  return (
    <div>
      <div className="stat-row">
        <Stat label="Asset value" value={gbp(s.asset_cost_pence)} />
        <Stat label="Collected (lifetime)" value={gbp(s.collected_lifetime_pence)} />
        <Stat label="Payback" value={s.overall_payback_pct == null ? "—" : s.overall_payback_pct + "%"} />
        <Stat label="Idle items" value={s.idle_count ?? 0} tone={(s.idle_count ?? 0) > 0 ? "warn" : undefined} />
      </div>

      {/* ROI per asset — lifetime */}
      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Return on each item</strong>
          <span className="text-mute">lifetime · revenue collected vs purchase cost</span>
        </div>
        {roi.length === 0 ? (
          <div style={{ padding: 32 }}><EmptyState title="No equipment yet" body="Add kit in the Catalogue tab to see its payback." /></div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Item</th><th>Category</th><th className="num">Cost</th><th className="num">Collected</th><th className="num">Payback</th><th>Status</th><th className="num">Hires</th></tr>
            </thead>
            <tbody>
              {roi.map((it) => {
                const pb = PAYBACK[it.payback_status] || PAYBACK.unknown;
                return (
                  <tr key={it.id} style={it.active ? undefined : { opacity: 0.5 }}>
                    <td><strong>{it.name}</strong>{it.idle && <span className="text-mute"> · idle</span>}</td>
                    <td className="text-mute">{CAT_LABEL[it.category] || it.category}</td>
                    <td className="num">{gbp(it.purchase_price_pence)}</td>
                    <td className="num">{gbp(it.collected_pence)}</td>
                    <td className="num">{it.payback_pct == null ? "—" : it.payback_pct + "%"}</td>
                    <td><span className={"pill " + pb.cls}><span className="pill-dot" /> {pb.label}</span></td>
                    <td className="num">{it.hires_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Usage over range */}
      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>How busy each item is</strong>
          <span className="text-mute">{range.from} → {range.to} ({range.days} days)</span>
        </div>
        {usage.length === 0 ? (
          <div style={{ padding: 32 }}><EmptyState title="Nothing active" body="No active equipment to report on." /></div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Item</th><th className="num">Hires</th><th className="num">Units out</th><th className="num">Unit-hours</th><th>Busiest day</th><th className="num">Share</th></tr>
            </thead>
            <tbody>
              {usage.map((it) => (
                <tr key={it.id}>
                  <td><strong>{it.name}</strong></td>
                  <td className="num">{it.hires_count}</td>
                  <td className="num">{it.units_hired}</td>
                  <td className="num">{it.unit_hours}</td>
                  <td className="text-mute">{it.busiest_day || "—"}</td>
                  <td className="num">{it.share_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Procurement signal */}
      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>What to buy next</strong>
          <span className="text-mute">turned-away demand · {range.from} → {range.to}</span>
        </div>
        {procurement.length === 0 ? (
          <div style={{ padding: 32 }}>
            <EmptyState title="No turned-away demand" body="When a hire can’t be filled because you’re short on stock, it’s logged here as a buy signal. Nothing turned away in this period." />
          </div>
        ) : (
          <div style={{ padding: "var(--gap-2)", display: "grid", gap: "var(--gap-2)" }}>
            {procurement.map((p) => (
              <div key={p.category} className="rec-row" style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span className="pill pill-warn"><span className="pill-dot" /> {p.miss_count} turned away</span>
                <span>
                  <strong>{CAT_LABEL[p.category] || p.category}</strong> — turned away {p.miss_count} hire{p.miss_count === 1 ? "" : "s"} ({p.units_wanted} unit{p.units_wanted === 1 ? "" : "s"} wanted).
                  {" "}You own {p.owned_qty} across {p.item_count} item{p.item_count === 1 ? "" : "s"}. Consider buying more.
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
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
