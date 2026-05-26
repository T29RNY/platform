import React, { useState } from "react";
import { venueAddPitch, venueUpdatePitch } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

export default function PitchForm({ venueToken, pitch, onDone, onClose }) {
  const editing = !!pitch;
  const [name, setName] = useState(pitch?.name || "");
  const [surface, setSurface] = useState(pitch?.surface || "");
  const [capacity, setCapacity] = useState(pitch?.capacity ?? "");
  const [sortOrder, setSortOrder] = useState(pitch?.sort_order ?? 0);
  const [active, setActive] = useState(pitch?.active ?? true);
  const [isAvailable, setIsAvailable] = useState(pitch?.is_available ?? true);
  const [windows, setWindows] = useState(pitch?.maintenance_windows || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function addWindow() {
    setWindows([...windows, { start_date: "", end_date: "", reason: "" }]);
  }
  function setWindow(i, key, val) {
    const next = windows.slice();
    next[i] = { ...next[i], [key]: val };
    setWindows(next);
  }
  function removeWindow(i) {
    setWindows(windows.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) { setError("Name required."); return; }
    const payload = {
      name: name.trim(),
      surface: surface.trim() || null,
      capacity: capacity === "" ? null : Number(capacity),
      sort_order: Number(sortOrder) || 0,
      is_available: isAvailable,
      maintenance_windows: windows.filter((w) => w.start_date && w.end_date),
    };
    setBusy(true); setError(null);
    try {
      if (editing) {
        await venueUpdatePitch(venueToken, pitch.id, { ...payload, active });
      } else {
        await venueAddPitch(venueToken, payload);
      }
      onDone?.(); onClose();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={editing ? `Edit ${pitch.name}` : "Add pitch"}
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />

      <div className="form-row">
        <div>
          <label>Surface</label>
          <input value={surface} onChange={(e) => setSurface(e.target.value)} placeholder="e.g. 3g" />
        </div>
        <div>
          <label>Capacity</label>
          <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div>
          <label>Sort order</label>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>
      </div>

      <div className="form-checks">
        {editing && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (uncheck to retire)
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
          Currently available for fixtures
        </label>
      </div>

      <label>Maintenance windows</label>
      {windows.length === 0 && <p className="muted">None.</p>}
      {windows.map((w, i) => (
        <div className="form-row mw-row" key={i}>
          <input type="date" value={w.start_date} onChange={(e) => setWindow(i, "start_date", e.target.value)} />
          <input type="date" value={w.end_date}   onChange={(e) => setWindow(i, "end_date", e.target.value)} />
          <input value={w.reason || ""} onChange={(e) => setWindow(i, "reason", e.target.value)} placeholder="Reason" />
          <button onClick={() => removeWindow(i)} className="btn-bad">Remove</button>
        </div>
      ))}
      <button onClick={addWindow} className="btn-link">+ Add window</button>

      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
