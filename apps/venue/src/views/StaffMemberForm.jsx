import React, { useState } from "react";
import { venueAddStaff, venueUpdateStaff } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

const ROLES = ["reception", "manager", "admin", "groundstaff", "coach", "other"];
const CHANNELS = ["email", "whatsapp", "sms", "push"];

export default function StaffMemberForm({ venueToken, member, onDone, onClose }) {
  const editing = !!member;
  const [name, setName] = useState(member?.name || "");
  const [role, setRole] = useState(member?.role || "reception");
  const [email, setEmail] = useState(member?.email || "");
  const [phone, setPhone] = useState(member?.phone || "");
  const [whatsapp, setWhatsapp] = useState(member?.whatsapp_number || "");
  const [channel, setChannel] = useState(member?.preferred_channel || "email");
  const [notes, setNotes] = useState(member?.notes || "");
  const [active, setActive] = useState(member?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (!name.trim()) { setError("Name required."); return; }
    const payload = {
      name: name.trim(),
      role,
      email: email.trim() || null,
      phone: phone.trim() || null,
      whatsapp_number: whatsapp.trim() || null,
      preferred_channel: channel,
      notes: notes.trim() || null,
    };
    setBusy(true); setError(null);
    try {
      if (editing) {
        await venueUpdateStaff(venueToken, member.id, { ...payload, active });
      } else {
        await venueAddStaff(venueToken, payload);
      }
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={editing ? `Edit ${member.name}` : "Add staff member"}
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />

      <div className="form-row">
        <div>
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}
          </select>
        </div>
        <div>
          <label>Preferred channel</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

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
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@venue.com" />

      <label>Notes</label>
      <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shifts, responsibilities, anything useful" />

      {editing && (
        <div className="form-checks">
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (uncheck to remove from rota)
          </label>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
