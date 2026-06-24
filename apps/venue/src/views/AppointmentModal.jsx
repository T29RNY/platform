import React, { useState, useEffect, useMemo, useRef } from "react";
import Modal from "./Modal.jsx";
import { venueCreateAppointment } from "@platform/core/storage/supabase.js";

// Operator books an EXISTING member into a trainer slot from the unified calendar (Phase 2b,
// mig 423). No availability-window enforcement (ad-hoc override). Length + price default to
// the trainer's settings but are editable. Creates the appointment 'confirmed'.

const ERR = {
  slot_taken: "That trainer already has an overlapping appointment — pick another time.",
  trainer_not_found: "That trainer couldn't be found.",
  trainer_not_in_venue: "That trainer isn't part of this venue.",
  member_not_found: "Choose a member.",
  slot_in_past: "Pick a time in the future.",
  bad_time_range: "The end time must be after the start time.",
  bad_price: "Enter a valid fee.",
};

const poundsToPence = (v) => Math.round(parseFloat(v || "0") * 100);

const splitPrefill = (startsAt) => {
  if (!startsAt || !startsAt.includes("T")) return { d: "", t: "" };
  const [d, rest] = startsAt.split("T");
  return { d, t: (rest || "").slice(0, 5) };
};

export default function AppointmentModal({ open, onClose, venueToken, trainers, members, prefill, onCreated }) {
  const [trainerId, setTrainerId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [length, setLength] = useState(60);
  const [price, setPrice] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const savingRef = useRef(false);

  const trainerOptions = useMemo(
    () => (trainers ?? []).filter((t) => t.active).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")),
    [trainers],
  );
  const memberOptions = useMemo(
    () => (members ?? [])
      .filter((m) => m.member_profile_id)
      .map((m) => ({ id: m.member_profile_id, name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Member" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );
  const trainer = useMemo(() => trainerOptions.find((t) => t.id === trainerId), [trainerOptions, trainerId]);

  useEffect(() => {
    if (!open) return;
    const { d, t } = splitPrefill(prefill?.startsAt);
    const tr = trainerOptions.find((x) => x.id === prefill?.trainerId) || trainerOptions[0];
    setTrainerId(tr?.id || "");
    setMemberId("");
    setDate(d); setTime(t || "10:00");
    setLength(tr?.default_session_minutes || 60);
    setPrice(tr ? (tr.price_pence / 100).toFixed(2) : "");
    setError(null); setBusy(false);
    savingRef.current = false;
  }, [open, prefill, trainerOptions]);

  // when the trainer changes, reset length + price to that trainer's defaults
  useEffect(() => {
    if (!open || !trainer) return;
    setLength(trainer.default_session_minutes || 60);
    setPrice((trainer.price_pence / 100).toFixed(2));
  }, [trainerId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (savingRef.current) return;
    setError(null);
    if (!trainerId) { setError("Choose a trainer."); return; }
    if (!memberId) { setError("Choose a member."); return; }
    if (!date || !time) { setError("Pick a date and time."); return; }

    const startISO = new Date(`${date}T${time}`).toISOString();
    const endISO = new Date(new Date(`${date}T${time}`).getTime() + length * 60000).toISOString();

    savingRef.current = true;
    setBusy(true);
    try {
      const res = await venueCreateAppointment(venueToken, trainerId, memberId, startISO, {
        endsAt: endISO, pricePence: price.trim() === "" ? null : poundsToPence(price),
      });
      if (res?.ok === false) {
        setError(ERR[res.reason] || "Couldn't create the appointment — try again.");
        savingRef.current = false; setBusy(false); return;
      }
      onCreated?.();
    } catch (e) {
      setError(ERR[e?.message] || "Couldn't create the appointment — try again.");
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New appointment"
      footer={<button className="btn-accent" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Book appointment"}</button>}
    >
      <label>Trainer</label>
      <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
        {trainerOptions.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
      </select>

      <label style={{ marginTop: 10 }}>Member</label>
      <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
        <option value="">Select a member…</option>
        {memberOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>

      <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
        <div>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label>Start</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label>Length</label>
          <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {[30, 45, 60, 90, 120].map((l) => <option key={l} value={l}>{l} min</option>)}
          </select>
        </div>
      </div>

      <label style={{ marginTop: 10 }}>Fee (£)</label>
      <input type="number" min={0} step="0.01" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />

      <p className="bk-modal-note">Booked straight away (ad-hoc — not limited to the trainer's set hours). The fee is added to the member's account when set.</p>
      {error && <div className="bk-inbox-error">{error}</div>}
    </Modal>
  );
}
