import React, { useState, useEffect, useMemo, useRef } from "react";
import Modal from "./Modal.jsx";
import {
  venueCreateBooking,
  venueCreateBookingSeries,
  venueListCustomers,
  getPitchFreeSlots,
  getPitchFreeSlotsSeries,
} from "@platform/core/storage/supabase.js";
import { dowOf, parseHHMM, reservedHitAt } from "../bookingUtil.js";

const ERR = {
  slot_unavailable: "That slot is already taken — pick another time.",
  pitch_not_in_venue: "That pitch isn't part of this venue.",
  booker_required: "Choose a customer or enter a name.",
  booking_args_required: "Fill in the pitch, date and time.",
  contact_email_required: "Enter a valid email so we can send the confirmation.",
  contact_phone_required: "Enter a valid phone number (min 7 digits).",
  series_team_required: "Block bookings are for registered teams only.",
  weeks_out_of_range: "Weeks must be between 1 and 52.",
};

// HH:MM in venue-local time from a timestamptz slot start.
const fmtTime = (iso) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso));

// Long UK date label for the chosen day.
const fmtDayLabel = (ymd) => {
  if (!ymd) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" })
      .format(new Date(ymd + "T12:00:00Z"));
  } catch { return ymd; }
};

export default function WalkInModal({ open, onClose, venueToken, venueId, date, pitches, teams, prefill, onCreated, reservedByPitch }) {
  const [pitchId, setPitchId] = useState("");
  const [bookingDate, setBookingDate] = useState(date || "");
  const [time, setTime] = useState("");
  const [length, setLength] = useState(60);

  const [bookingType, setBookingType] = useState("single");  // single | block
  const [weeks, setWeeks] = useState(6);

  const [customerKind, setCustomerKind] = useState("existing"); // existing | new
  const [existingType, setExistingType] = useState("team");     // team | person
  const [teamId, setTeamId] = useState("");
  const [personName, setPersonName] = useState("");
  const [newName, setNewName] = useState("");

  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [people, setPeople] = useState([]);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const slotReq = useRef(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // reset on open
  useEffect(() => {
    if (!open) return;
    setPitchId(prefill?.pitchId || pitches[0]?.id || "");
    setBookingDate(date || "");
    setTime(prefill?.time || "");
    setBookingType("single");
    setWeeks(6);
    setCustomerKind("existing");
    setExistingType("team");
    setTeamId(""); setPersonName(""); setNewName("");
    setContactEmail(""); setContactPhone("");
    setError(null); setBusy(false);
  }, [open, prefill, pitches, date]);

  // load existing people (past walk-in customers) once on open
  useEffect(() => {
    if (!open || !venueToken) return;
    let live = true;
    venueListCustomers(venueToken)
      .then((rows) => {
        if (!live) return;
        const ppl = (rows || [])
          .filter((r) => !r.is_team && r.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setPeople(ppl);
      })
      .catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [open, venueToken]);

  const teamList = useMemo(
    () => Object.values(teams || {}).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [teams],
  );

  const lengthOptions = useMemo(() => {
    const pitch = pitches.find((p) => p.id === pitchId);
    const dow = dowOf(bookingDate);
    const set = new Set();
    for (const w of pitch?.booking_windows ?? []) {
      if (Number(w.day_of_week) === dow) (w.slot_lengths ?? []).forEach((l) => set.add(Number(l)));
    }
    const arr = [...set].sort((a, b) => a - b);
    return arr.length ? arr : [60, 90];
  }, [pitches, pitchId, bookingDate]);

  useEffect(() => {
    if (lengthOptions.length && !lengthOptions.includes(length)) setLength(lengthOptions[0]);
  }, [lengthOptions, length]);

  // block is team-only — force single if the booker isn't a registered team
  const canBlock = customerKind === "existing" && existingType === "team";
  useEffect(() => {
    if (!canBlock && bookingType === "block") setBookingType("single");
  }, [canBlock, bookingType]);

  // fetch availability whenever the slot inputs change
  useEffect(() => {
    if (!open || !venueId || !pitchId || !bookingDate || !length) { setSlots([]); return; }
    const reqId = ++slotReq.current;
    setSlotsLoading(true);
    const p = bookingType === "block"
      ? getPitchFreeSlotsSeries(venueId, bookingDate, weeks, length)
      : getPitchFreeSlots(venueId, bookingDate, pitchId, length);
    p.then((rows) => {
      if (reqId !== slotReq.current) return; // stale
      const forPitch = (rows || []).filter((s) => s.playing_area_id === pitchId);
      setSlots(forPitch);
      setSlotsLoading(false);
    }).catch(() => {
      if (reqId !== slotReq.current) return;
      setSlots([]); setSlotsLoading(false);
    });
  }, [open, venueId, pitchId, bookingDate, length, bookingType, weeks]);

  const availableTimes = useMemo(() => {
    const set = new Set(slots.map((s) => fmtTime(s.slot_start)));
    return [...set].sort();
  }, [slots]);

  // keep the selected time valid against availability
  useEffect(() => {
    if (!availableTimes.length) { if (time) setTime(""); return; }
    if (!availableTimes.includes(time)) setTime(availableTimes[0]);
  }, [availableTimes]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Operator override warning: does the chosen pitch+day+time land in a reserved window?
  // The server still books (warning-only) — we just flag it up front (locked decision #5).
  const reservedHit = useMemo(() => {
    if (!pitchId || !bookingDate || !time) return null;
    const windows = reservedByPitch?.get?.(pitchId) || [];
    if (!windows.length) return null;
    return reservedHitAt(windows, bookingDate, parseHHMM(time));
  }, [reservedByPitch, pitchId, bookingDate, time]);

  const submit = async () => {
    setError(null);
    // booker resolution
    let tId = null, bName = null;
    if (customerKind === "existing" && existingType === "team") {
      if (!teamId) { setError("Choose a team."); return; }
      tId = teamId;
    } else if (customerKind === "existing" && existingType === "person") {
      if (!personName) { setError("Choose a customer."); return; }
      bName = personName;
    } else {
      if (!newName.trim()) { setError("Enter the customer's name."); return; }
      bName = newName.trim();
    }
    if (!time) { setError("Pick an available time."); return; }
    if (!contactEmail.trim() || !contactEmail.includes("@")) { setError(ERR.contact_email_required); return; }
    if (contactPhone.replace(/[^0-9]/g, "").length < 7) { setError(ERR.contact_phone_required); return; }

    setBusy(true);
    try {
      if (bookingType === "block") {
        await venueCreateBookingSeries(venueToken, pitchId, time, bookingDate, weeks, tId, length, contactEmail.trim(), contactPhone.trim());
      } else {
        await venueCreateBooking(venueToken, pitchId, bookingDate, time, length, tId, bName, contactEmail.trim(), contactPhone.trim());
      }
      onCreated?.();
    } catch (e) {
      setError(ERR[e?.message] || "Couldn't create the booking — try again.");
      setBusy(false);
    }
  };

  const noSlots = !slotsLoading && availableTimes.length === 0;

  return (
    <Modal open={open} onClose={onClose} title="New booking"
      footer={
        <button className="btn-accent" disabled={busy || noSlots} onClick={submit}>
          {busy ? "Booking…" : reservedHit ? "Book anyway" : "Confirm booking"}
        </button>
      }
    >
      <label>Pitch</label>
      <select value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
        {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {/* booking type */}
      <label style={{ marginTop: 12 }}>Booking</label>
      <div className="bk-modetabs">
        <button className={"bk-modetab" + (bookingType === "single" ? " is-active" : "")} onClick={() => setBookingType("single")}>Single</button>
        <button
          className={"bk-modetab" + (bookingType === "block" ? " is-active" : "")}
          onClick={() => canBlock && setBookingType("block")}
          disabled={!canBlock}
          title={canBlock ? "" : "Block bookings are for registered teams"}
        >Block (weekly)</button>
      </div>
      {!canBlock && <p className="bk-modal-note">Block (recurring) bookings are for registered teams.</p>}

      <div className="form-row" style={{ gridTemplateColumns: bookingType === "block" ? "1fr 1fr 1fr" : "1fr 1fr" }}>
        <div>
          <label>{bookingType === "block" ? "First date" : "Date"}</label>
          <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
        </div>
        <div>
          <label>Length</label>
          <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {lengthOptions.map((l) => <option key={l} value={l}>{l} min</option>)}
          </select>
        </div>
        {bookingType === "block" && (
          <div>
            <label>Weeks</label>
            <input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))} />
          </div>
        )}
      </div>

      <label>Time {bookingDate ? <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>· {fmtDayLabel(bookingDate)}</span> : null}</label>
      {slotsLoading ? (
        <div className="bk-modal-note">Checking availability…</div>
      ) : noSlots ? (
        <div className="bk-inbox-error">No free slots for that pitch, date{bookingType === "block" ? " across all weeks" : ""} and length.</div>
      ) : (
        <select value={time} onChange={(e) => setTime(e.target.value)}>
          {availableTimes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}

      {/* customer */}
      <label style={{ marginTop: 12 }}>Booked for</label>
      <div className="bk-modetabs">
        <button className={"bk-modetab" + (customerKind === "existing" ? " is-active" : "")} onClick={() => setCustomerKind("existing")}>Existing customer</button>
        <button className={"bk-modetab" + (customerKind === "new" ? " is-active" : "")} onClick={() => setCustomerKind("new")}>New customer</button>
      </div>

      {customerKind === "existing" ? (
        <>
          <div className="bk-modetabs" style={{ marginTop: 8 }}>
            <button className={"bk-modetab" + (existingType === "team" ? " is-active" : "")} onClick={() => setExistingType("team")}>Team</button>
            <button className={"bk-modetab" + (existingType === "person" ? " is-active" : "")} onClick={() => setExistingType("person")}>Person</button>
          </div>
          {existingType === "team" ? (
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Select a team…</option>
              {teamList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : (
            <select value={personName} onChange={(e) => setPersonName(e.target.value)}>
              <option value="">Select a customer…</option>
              {people.map((p) => <option key={p.booker_key} value={p.name}>{p.name}</option>)}
            </select>
          )}
        </>
      ) : (
        <input type="text" placeholder="Customer name" value={newName} onChange={(e) => setNewName(e.target.value)} />
      )}

      {/* contact — required for all */}
      <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
        <div>
          <label>Email</label>
          <input type="email" placeholder="name@email.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div>
          <label>Phone</label>
          <input type="tel" placeholder="07700 900000" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </div>
      </div>

      {reservedHit && (
        <div className="bk-modal-note" style={{ color: "var(--warn)", fontWeight: 500 }}>
          ⚠ This time is reserved for club use ({reservedHit.label}). You can still book it — it won't be offered to outside hires.
        </div>
      )}
      <p className="bk-modal-note">Confirmed straight away — we'll email the customer a confirmation.</p>
      {error && <div className="bk-inbox-error">{error}</div>}
    </Modal>
  );
}
