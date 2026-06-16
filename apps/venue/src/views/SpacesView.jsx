import React, { useState, useEffect, useCallback, useRef } from "react";
import { venueListSpaces, venueCreateSpace, venueUpdateSpace } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";

// Hireable Spaces — Phase 1 of CLASSES_ROOM_HIRE_PLAN (mig 338). The bookable
// facility (studio/room/hall/outdoor) that Phase 2 class sessions and Phase 5
// room hires both schedule against. This is config: simple CRUD. The
// upcoming_session_count / upcoming_hire_count columns are 0 until those
// products land, then surface automatically (RPC self-upgrades via to_regclass).

const SPACE_TYPES = [
  ["studio",  "Studio"],
  ["room",    "Room"],
  ["hall",    "Hall"],
  ["outdoor", "Outdoor"],
];
const TYPE_LABEL = Object.fromEntries(SPACE_TYPES);

export default function SpacesView({ venueToken }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try { setData(await venueListSpaces(venueToken)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);
  useEffect(() => { load(); }, [load]);

  const onSave = async (form) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      if (form.id) {
        const { id, ...rest } = form;
        await venueUpdateSpace(venueToken, id, rest);
      } else {
        await venueCreateSpace(venueToken, form);
      }
      setEditing(null);
      await load();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); savingRef.current = false; }
  };

  if (err) return <EmptyState title="Couldn’t load spaces" body={err} action={<button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setErr(null); load(); }}>Retry</button>} />;
  if (!data) return <EmptyState title="Loading spaces…" />;

  const spaces = Array.isArray(data) ? data : [];

  return (
    <div>
      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Spaces</strong>
          {spaces.length > 0 && <span className="text-mute">{spaces.length}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={14} /> Add space
          </button>
        </div>

        {spaces.length === 0 ? (
          <div style={{ padding: 32 }}>
            <EmptyState title="No spaces yet" body="Add the rooms, studios, halls or outdoor areas your venue hires out or runs classes in. You’ll schedule classes and room hires against these in the next steps." />
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Name</th><th>Type</th><th className="num">Capacity</th><th>Booking</th><th className="num">Upcoming</th><th /></tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                <tr key={s.id} style={s.is_active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <strong>{s.name}</strong>
                    {!s.is_active && <span className="text-mute"> · inactive</span>}
                    {s.description && <div className="text-mute" style={{ fontSize: 12 }}>{s.description}</div>}
                  </td>
                  <td className="text-mute">{TYPE_LABEL[s.space_type] || s.space_type}</td>
                  <td className="num">{s.capacity}</td>
                  <td>
                    {s.is_enquiry_only
                      ? <span className="pill pill-warn"><span className="pill-dot" /> Enquiry only</span>
                      : <span className="pill pill-ok"><span className="pill-dot" /> Self-serve</span>}
                  </td>
                  <td className="num text-mute">{(s.upcoming_session_count ?? 0) + (s.upcoming_hire_count ?? 0)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-xs" onClick={() => setEditing(s)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <SpaceModal space={editing} busy={busy} onClose={() => setEditing(null)} onSubmit={onSave} />
      )}
    </div>
  );
}

// Create (space = {}) or edit a space. Maps the form to the create wrapper's
// flat args on create, or to a jsonb patch for venueUpdateSpace on edit.
function SpaceModal({ space, busy, onClose, onSubmit }) {
  const isNew = !space.id;
  const [name, setName] = useState(space.name ?? "");
  const [spaceType, setSpaceType] = useState(space.space_type ?? "room");
  const [capacity, setCapacity] = useState(String(space.capacity ?? 1));
  const [description, setDescription] = useState(space.description ?? "");
  const [isEnquiryOnly, setIsEnquiryOnly] = useState(space.is_enquiry_only ?? false);
  const [contactName, setContactName] = useState(space.enquiry_contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(space.enquiry_contact_email ?? "");
  const [isActive, setIsActive] = useState(space.is_active ?? true);

  const submit = () => {
    const cap = parseInt(capacity, 10);
    if (!name.trim() || !Number.isFinite(cap) || cap < 0) return;
    if (isNew) {
      onSubmit({
        name: name.trim(),
        capacity: cap,
        spaceType,
        description: description.trim() || null,
        isEnquiryOnly,
        enquiryContactName: isEnquiryOnly ? (contactName.trim() || null) : null,
        enquiryContactEmail: isEnquiryOnly ? (contactEmail.trim() || null) : null,
      });
    } else {
      // jsonb patch — send the full editable set; presence keys let us null out contacts.
      onSubmit({
        id: space.id,
        name: name.trim(),
        capacity: cap,
        space_type: spaceType,
        description: description.trim() || null,
        is_enquiry_only: isEnquiryOnly,
        enquiry_contact_name: isEnquiryOnly ? (contactName.trim() || null) : null,
        enquiry_contact_email: isEnquiryOnly ? (contactEmail.trim() || null) : null,
        is_active: isActive,
      });
    }
  };

  return (
    <Modal onClose={onClose} title={isNew ? "Add space" : "Edit space"}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>{busy ? "Saving…" : (isNew ? "Add" : "Save")}</button>
      </>}>
      <label className="field-label">Name</label>
      <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Studio 1 / Main Hall" autoFocus style={{ marginBottom: 12 }} />

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 2 }}>
          <label className="field-label">Type</label>
          <select className="input" value={spaceType} onChange={(e) => setSpaceType(e.target.value)}>
            {SPACE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Capacity</label>
          <input className="input" type="number" min="0" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
      </div>

      <label className="field-label">Description (optional)</label>
      <input className="input" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Sprung floor, mirrors, sound system" style={{ marginBottom: 12 }} />

      <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: isEnquiryOnly ? 12 : 0 }}>
        <input type="checkbox" checked={isEnquiryOnly} onChange={(e) => setIsEnquiryOnly(e.target.checked)} />
        <span>Enquiry only — no self-serve booking (large or premium space)</span>
      </label>

      {isEnquiryOnly && (
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Enquiry contact name</label>
            <input className="input" type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Who handles enquiries" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Enquiry contact email</label>
            <input className="input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="bookings@venue.com" />
          </div>
        </div>
      )}

      {!isNew && (
        <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 4 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Active — available to schedule against</span>
        </label>
      )}
    </Modal>
  );
}
