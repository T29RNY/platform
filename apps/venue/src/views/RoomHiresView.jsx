import React, { useState, useEffect, useCallback, useRef } from "react";
import { venueListRoomHires, venueConfirmRoomHire, venueCancelRoomHire, venueRecordHireDeposit } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";

// Room Hires — Phase 5 of CLASSES_ROOM_HIRE_PLAN (mig 342). Requests inbox
// (confirm with price/deposit, or decline), confirmed-hires list, per-hire detail
// (booker, equipment add-ons, deposit lifecycle). Mirrors the BookingsView
// RequestsInbox confirm/decline pattern + the SpacesView CRUD shell.

const DT_FMT = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" };
const fmtWhen = (iso) => new Date(iso).toLocaleString("en-GB", DT_FMT);
const poundsOpt = (p) => (p == null ? "—" : "£" + (p % 100 ? (p / 100).toFixed(2) : (p / 100).toString()));

const DEPOSIT_LABEL = { none: "No deposit", held: "Held", returned: "Returned", forfeited: "Forfeited" };
const DEPOSIT_TONE = { none: "", held: "pill-warn", returned: "pill-ok", forfeited: "pill-crit" };

export default function RoomHiresView({ venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [confirming, setConfirming] = useState(null); // hire row being priced
  const [busyId, setBusyId] = useState(null);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try { setData(await venueListRoomHires(venueToken)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);
  useEffect(() => { load(); }, [load]);

  const decline = async (hire) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusyId(hire.id);
    try { await venueCancelRoomHire(venueToken, hire.id, "declined"); await load(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { savingRef.current = false; setBusyId(null); }
  };

  const cancel = async (hire) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusyId(hire.id);
    try { await venueCancelRoomHire(venueToken, hire.id, null); await load(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { savingRef.current = false; setBusyId(null); }
  };

  const confirmHire = async ({ pricePence, depositPence }) => {
    if (savingRef.current || !confirming) return;
    savingRef.current = true; setBusyId(confirming.id);
    try {
      await venueConfirmRoomHire(venueToken, confirming.id, pricePence, depositPence);
      setConfirming(null);
      await load();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { savingRef.current = false; setBusyId(null); }
  };

  const setDeposit = async (hire, status) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusyId(hire.id);
    try { await venueRecordHireDeposit(venueToken, hire.id, status); await load(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { savingRef.current = false; setBusyId(null); }
  };

  if (err) return <EmptyState title="Couldn’t load room hires" body={err} action={<button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setErr(null); load(); }}>Retry</button>} />;
  if (!data) return <EmptyState title="Loading room hires…" />;

  const hires = Array.isArray(data) ? data : [];
  const requests = hires.filter((h) => h.status === "requested");
  const confirmed = hires.filter((h) => h.status === "confirmed");

  return (
    <div>
      {/* Requests inbox */}
      <div className="dt-card" style={{ marginBottom: "var(--gap-3, 16px)" }}>
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Requests</strong>
          {requests.length > 0 && <span className="text-mute">{requests.length}</span>}
        </div>
        {requests.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState title="The queue is clear." body="New room-hire requests and enquiries will arrive here." />
          </div>
        ) : (
          <div className="req-grid" style={{ padding: 12 }}>
            {requests.map((h) => (
              <div className="req-card" key={h.id}>
                <div className="req-top">
                  <span className="req-label">{h.booker_type === "member" ? "Member" : "Enquiry"}</span>
                  <span className="req-pitch"><Icon name="roomhire" size={12} /> {h.space_name}</span>
                </div>
                <div className="req-booker-text" style={{ marginBottom: 8 }}>
                  <div className="bname">{h.booker_name || "—"}</div>
                  {h.booker_email && <div className="text-mute" style={{ fontSize: 12 }}>{h.booker_email}</div>}
                  {h.booker_phone && <div className="text-mute" style={{ fontSize: 12 }}>{h.booker_phone}</div>}
                </div>
                <div className="req-when"><Icon name="clock" size={12} /> <span>{fmtWhen(h.starts_at)} – {fmtWhen(h.ends_at)}</span></div>
                <div className="text-mute" style={{ fontSize: 12, margin: "6px 0" }}>
                  {h.purpose}{h.attendee_count ? ` · ${h.attendee_count} attending` : ""}
                </div>
                {(h.equipment?.length > 0) && (
                  <div className="text-mute" style={{ fontSize: 12, marginBottom: 6 }}>
                    Add-ons: {h.equipment.map((e) => `${e.name}×${e.qty}`).join(", ")}
                  </div>
                )}
                <div className="req-actions">
                  <button className="btn btn-sm btn-primary" disabled={busyId === h.id} onClick={() => setConfirming(h)}>Confirm</button>
                  <button className="btn btn-sm" disabled={busyId === h.id} onClick={() => decline(h)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmed hires */}
      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Confirmed hires</strong>
          {confirmed.length > 0 && <span className="text-mute">{confirmed.length}</span>}
        </div>
        {confirmed.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState title="No confirmed hires" body="Confirm a request above to schedule a hire." /></div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Space</th><th>Booker</th><th>When</th><th className="num">Fee</th><th>Deposit</th><th /></tr>
            </thead>
            <tbody>
              {confirmed.map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.space_name}</strong>
                    <div className="text-mute" style={{ fontSize: 12 }}>{h.purpose}{h.attendee_count ? ` · ${h.attendee_count}` : ""}</div>
                    {(h.equipment?.length > 0) && (
                      <div className="text-mute" style={{ fontSize: 12 }}>Add-ons: {h.equipment.map((e) => `${e.name}×${e.qty}`).join(", ")}</div>
                    )}
                  </td>
                  <td>
                    {h.booker_name || "—"}
                    {h.booker_email && <div className="text-mute" style={{ fontSize: 12 }}>{h.booker_email}</div>}
                  </td>
                  <td className="text-mute" style={{ fontSize: 13 }}>{fmtWhen(h.starts_at)}</td>
                  <td className="num">
                    {poundsOpt(h.price_pence)}
                    {h.charge_status && <div className="text-mute" style={{ fontSize: 11 }}>{h.charge_status}</div>}
                  </td>
                  <td>
                    <span className={"pill " + (DEPOSIT_TONE[h.deposit_status] || "")}><span className="pill-dot" /> {DEPOSIT_LABEL[h.deposit_status] || h.deposit_status}</span>
                    {h.deposit_pence > 0 && <div className="text-mute" style={{ fontSize: 11 }}>{poundsOpt(h.deposit_pence)}</div>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <select className="input" value="" disabled={busyId === h.id}
                      onChange={(e) => { if (e.target.value) setDeposit(h, e.target.value); }}
                      style={{ width: 120, display: "inline-block", marginRight: 6 }} aria-label="Record deposit">
                      <option value="">Deposit…</option>
                      <option value="held">Mark held</option>
                      <option value="returned">Mark returned</option>
                      <option value="forfeited">Mark forfeited</option>
                      <option value="none">Clear</option>
                    </select>
                    <button className="btn btn-xs" disabled={busyId === h.id} onClick={() => cancel(h)}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirming && (
        <ConfirmModal hire={confirming} busy={busyId === confirming.id} onClose={() => setConfirming(null)} onSubmit={confirmHire} />
      )}
    </div>
  );
}

// Price a requested hire (fee + optional deposit) before confirming it.
function ConfirmModal({ hire, busy, onClose, onSubmit }) {
  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("");

  const submit = () => {
    const pricePence = Math.round(parseFloat(price || "0") * 100);
    if (!Number.isFinite(pricePence) || pricePence < 0) return;
    const depRaw = deposit.trim() === "" ? null : Math.round(parseFloat(deposit) * 100);
    if (depRaw != null && (!Number.isFinite(depRaw) || depRaw < 0)) return;
    onSubmit({ pricePence, depositPence: depRaw });
  };

  return (
    <Modal onClose={onClose} title={`Confirm hire — ${hire.space_name}`}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Confirming…" : "Confirm hire"}</button>
      </>}>
      <p className="text-mute" style={{ fontSize: 13, marginTop: 0 }}>
        {hire.booker_name} · {fmtWhen(hire.starts_at)} – {fmtWhen(hire.ends_at)}
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Hire fee (£)</label>
          <input className="input" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" autoFocus />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Deposit (£, optional)</label>
          <input className="input" type="number" min="0" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="—" />
        </div>
      </div>
      <p className="text-mute" style={{ fontSize: 12, marginTop: 10 }}>
        Confirming notifies the booker and raises a charge for the fee. Track the deposit from the hires list.
      </p>
    </Modal>
  );
}
