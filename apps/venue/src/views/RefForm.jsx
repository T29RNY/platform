import React, { useState } from "react";
import { venueAddRef, venueUpdateRef } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

const CHANNELS = ["push", "whatsapp", "sms", "email"];
const EMPLOYMENT = ["freelance", "in_house"];

export default function RefForm({ venueToken, refRow, onDone, onClose }) {
  const editing = !!refRow;
  const [name, setName] = useState(refRow?.name || "");
  const [phone, setPhone] = useState(refRow?.phone || "");
  const [email, setEmail] = useState(refRow?.email || "");
  const [whatsapp, setWhatsapp] = useState(refRow?.whatsapp_number || "");
  const [channel, setChannel] = useState(refRow?.preferred_channel || "push");
  const [emp, setEmp] = useState(refRow?.employment_type || "freelance");
  const [rating, setRating] = useState(refRow?.overall_rating ?? "");
  const [active, setActive] = useState(refRow?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (!name.trim()) { setError("Name required."); return; }
    const payload = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      whatsapp_number: whatsapp.trim() || null,
      preferred_channel: channel,
      employment_type: emp,
      overall_rating: rating === "" ? null : Number(rating),
    };
    setBusy(true); setError(null);
    try {
      if (editing) {
        await venueUpdateRef(venueToken, refRow.id, { ...payload, active });
      } else {
        await venueAddRef(venueToken, payload);
      }
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={editing ? `Edit ${refRow.name}` : "Add referee"}
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />

      <div className="form-row">
        <div>
          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44…" />
        </div>
        <div>
          <label>WhatsApp</label>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+44…" />
        </div>
      </div>

      <label>Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ref@example.com" />

      <div className="form-row">
        <div>
          <label>Preferred channel</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label>Employment</label>
          <select value={emp} onChange={(e) => setEmp(e.target.value)}>
            {EMPLOYMENT.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label>Rating (0–5)</label>
          <input type="number" step="0.1" min={0} max={5} value={rating} onChange={(e) => setRating(e.target.value)} />
        </div>
      </div>

      {editing && (
        <div className="form-checks">
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (uncheck to retire)
          </label>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
