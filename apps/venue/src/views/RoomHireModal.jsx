import React, { useState, useEffect, useMemo, useRef } from "react";
import Modal from "./Modal.jsx";
import { venueCreateRoomHire } from "@platform/core/storage/supabase.js";

// Operator ad-hoc room hire from the unified calendar (Phase 2b, mig 423). Either an existing
// member (contact auto-filled from the profile) or a walk-in (free-text name + optional
// contact). Creates the hire 'confirmed' straight away and charges the fee when priced.
// Mirrors WalkInModal's shape (booker picker, busy guard, friendly error map).

const ERR = {
  space_unavailable: "That room is already booked for an overlapping time — pick another slot.",
  space_not_in_venue: "That room isn't part of this venue.",
  space_not_found: "That room couldn't be found.",
  purpose_required: "Add what the room is being hired for.",
  bad_time_range: "The end time must be after the start time.",
  booker_required: "Choose a member or enter a name.",
  member_not_found: "That member couldn't be found.",
  bad_price: "Enter a valid fee.",
  bad_deposit: "Enter a valid deposit.",
};

const poundsToPence = (v) => Math.round(parseFloat(v || "0") * 100);

// Split an ISO-ish "YYYY-MM-DDTHH:MM" prefill into date + HH:MM parts.
const splitPrefill = (startsAt) => {
  if (!startsAt || !startsAt.includes("T")) return { d: "", t: "" };
  const [d, rest] = startsAt.split("T");
  return { d, t: (rest || "").slice(0, 5) };
};

export default function RoomHireModal({ open, onClose, venueToken, spaces, members, prefill, onCreated }) {
  const [spaceId, setSpaceId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [length, setLength] = useState(60);
  const [purpose, setPurpose] = useState("");

  const [bookerKind, setBookerKind] = useState("member"); // member | walkin
  const [memberId, setMemberId] = useState("");
  const [walkName, setWalkName] = useState("");
  const [walkEmail, setWalkEmail] = useState("");
  const [walkPhone, setWalkPhone] = useState("");

  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const savingRef = useRef(false);

  // members with a profile id are the only bookable "member" bookers
  const memberOptions = useMemo(
    () => (members ?? [])
      .filter((m) => m.member_profile_id)
      .map((m) => ({ id: m.member_profile_id, name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Member" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );

  useEffect(() => {
    if (!open) return;
    const { d, t } = splitPrefill(prefill?.startsAt);
    setSpaceId(prefill?.spaceId || spaces?.[0]?.id || "");
    setDate(d); setTime(t || "18:00"); setLength(60); setPurpose("");
    setBookerKind(memberOptions.length ? "member" : "walkin");
    setMemberId(""); setWalkName(""); setWalkEmail(""); setWalkPhone("");
    setPrice(""); setDeposit(""); setError(null); setBusy(false);
    savingRef.current = false;
  }, [open, prefill, spaces, memberOptions.length]);

  const submit = async () => {
    if (savingRef.current) return;
    setError(null);
    if (!spaceId) { setError("Choose a room."); return; }
    if (!date || !time) { setError("Pick a date and time."); return; }
    if (!purpose.trim()) { setError(ERR.purpose_required); return; }

    let bookerName = null, memberProfileId = null, bookerEmail = null, bookerPhone = null;
    if (bookerKind === "member") {
      if (!memberId) { setError("Choose a member."); return; }
      memberProfileId = memberId;
    } else {
      if (!walkName.trim()) { setError("Enter the customer's name."); return; }
      bookerName = walkName.trim();
      bookerEmail = walkEmail.trim() || null;
      bookerPhone = walkPhone.trim() || null;
    }

    const startISO = new Date(`${date}T${time}`).toISOString();
    const endISO = new Date(new Date(`${date}T${time}`).getTime() + length * 60000).toISOString();

    savingRef.current = true;
    setBusy(true);
    try {
      const res = await venueCreateRoomHire(venueToken, spaceId, startISO, endISO, purpose.trim(), {
        pricePence: poundsToPence(price), bookerName, bookerEmail, bookerPhone,
        depositPence: deposit.trim() === "" ? null : poundsToPence(deposit), memberProfileId,
      });
      if (res?.ok === false) {
        setError(ERR[res.reason] || "Couldn't create the hire — try again.");
        savingRef.current = false; setBusy(false); return;
      }
      onCreated?.();
    } catch (e) {
      setError(ERR[e?.message] || "Couldn't create the hire — try again.");
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New room hire"
      footer={<button className="btn-accent" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create hire"}</button>}
    >
      <label>Room</label>
      <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
        {(spaces ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
            {[30, 60, 90, 120, 180, 240].map((l) => <option key={l} value={l}>{l} min</option>)}
          </select>
        </div>
      </div>

      <label style={{ marginTop: 10 }}>What for</label>
      <input type="text" placeholder="e.g. Corporate away day" value={purpose} onChange={(e) => setPurpose(e.target.value)} />

      <label style={{ marginTop: 12 }}>Booked for</label>
      <div className="bk-modetabs">
        <button className={"bk-modetab" + (bookerKind === "member" ? " is-active" : "")} onClick={() => setBookerKind("member")}>Member</button>
        <button className={"bk-modetab" + (bookerKind === "walkin" ? " is-active" : "")} onClick={() => setBookerKind("walkin")}>Walk-in</button>
      </div>
      {bookerKind === "member" ? (
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Select a member…</option>
          {memberOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      ) : (
        <>
          <input type="text" placeholder="Customer name" value={walkName} onChange={(e) => setWalkName(e.target.value)} />
          <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
            <div>
              <label>Email (optional)</label>
              <input type="email" placeholder="name@email.com" value={walkEmail} onChange={(e) => setWalkEmail(e.target.value)} />
            </div>
            <div>
              <label>Phone (optional)</label>
              <input type="tel" placeholder="07700 900000" value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
        <div>
          <label>Fee (£, optional)</label>
          <input type="number" min={0} step="0.01" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label>Deposit (£, optional)</label>
          <input type="number" min={0} step="0.01" placeholder="0.00" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </div>
      </div>

      <p className="bk-modal-note">Confirmed straight away. A fee is added to the customer's account when set.</p>
      {error && <div className="bk-inbox-error">{error}</div>}
    </Modal>
  );
}
