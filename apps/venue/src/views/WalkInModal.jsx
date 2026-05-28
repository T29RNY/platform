import React, { useState, useEffect, useMemo } from "react";
import Modal from "./Modal.jsx";
import { venueCreateBooking } from "@platform/core/storage/supabase.js";
import { dowOf } from "../bookingUtil.js";

const ERR = {
  slot_unavailable: "That slot is already taken — pick another time.",
  pitch_not_in_venue: "That pitch isn't part of this venue.",
  booker_required: "Add a team or a name for the booking.",
  booking_args_required: "Fill in the pitch, date and time.",
};

export default function WalkInModal({ open, onClose, venueToken, date, pitches, teams, prefill, onCreated }) {
  const [pitchId, setPitchId] = useState("");
  const [time, setTime] = useState("19:00");
  const [length, setLength] = useState(60);
  const [mode, setMode] = useState("team");   // team | walkin
  const [teamId, setTeamId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setPitchId(prefill?.pitchId || pitches[0]?.id || "");
    setTime(prefill?.time || "19:00");
    setError(null);
    setBusy(false);
  }, [open, prefill, pitches]);

  const teamList = useMemo(
    () => Object.values(teams || {}).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [teams],
  );

  const lengthOptions = useMemo(() => {
    const pitch = pitches.find((p) => p.id === pitchId);
    const dow = dowOf(date);
    const set = new Set();
    for (const w of pitch?.booking_windows ?? []) {
      if (Number(w.day_of_week) === dow) (w.slot_lengths ?? []).forEach((l) => set.add(Number(l)));
    }
    const arr = [...set].sort((a, b) => a - b);
    return arr.length ? arr : [60, 90];
  }, [pitches, pitchId, date]);

  useEffect(() => {
    if (lengthOptions.length && !lengthOptions.includes(length)) setLength(lengthOptions[0]);
  }, [lengthOptions, length]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const tId = mode === "team" ? (teamId || null) : null;
      const bName = mode === "walkin" ? name.trim() : null;
      if (mode === "team" && !tId) { setError("Choose a team, or switch to walk-in."); setBusy(false); return; }
      if (mode === "walkin" && !bName) { setError("Enter a name for the walk-in."); setBusy(false); return; }
      await venueCreateBooking(venueToken, pitchId, date, time, length, tId, bName);
      onCreated?.();
    } catch (e) {
      setError(ERR[e?.message] || "Couldn't create the booking — try again.");
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New booking"
      footer={
        <button className="btn-accent" disabled={busy} onClick={submit}>
          {busy ? "Booking…" : "Confirm booking"}
        </button>
      }
    >
      <label>Pitch</label>
      <select value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
        {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label>Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label>Length</label>
          <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {lengthOptions.map((l) => <option key={l} value={l}>{l} min</option>)}
          </select>
        </div>
      </div>

      <label>Booked for</label>
      <div className="bk-modetabs">
        <button className={"bk-modetab" + (mode === "team" ? " is-active" : "")} onClick={() => setMode("team")}>Registered team</button>
        <button className={"bk-modetab" + (mode === "walkin" ? " is-active" : "")} onClick={() => setMode("walkin")}>Walk-in</button>
      </div>
      {mode === "team" ? (
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Select a team…</option>
          {teamList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : (
        <input type="text" placeholder="Name on the booking" value={name} onChange={(e) => setName(e.target.value)} />
      )}

      <p className="bk-modal-note">Venue-created bookings are confirmed straight away.</p>
      {error && <div className="bk-inbox-error">{error}</div>}
    </Modal>
  );
}
