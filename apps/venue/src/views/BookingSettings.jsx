import React, { useState, useEffect } from "react";
import Modal from "./Modal.jsx";
import { venueUpdateBookingSettings, venueUpdatePitch } from "@platform/core/storage/supabase.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LENGTHS = [30, 45, 60, 90, 120];

function blankWindow() {
  return { day_of_week: 1, open_time: "18:00", close_time: "22:00", slot_lengths: [60] };
}

function blankPrimeWindow() {
  return { day_of_week: 1, start_time: "18:00", end_time: "22:00" };
}

export default function BookingSettings({ open, onClose, venueToken, venue, pitches, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState("");
  const [windows, setWindows] = useState({});     // pitchId -> [window]
  const [prime, setPrime] = useState({});         // pitchId -> [prime window]
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPitch, setSavingPitch] = useState(null);
  const [savingPrime, setSavingPrime] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnabled(!!venue.bookings_enabled);
    setPolicy(venue.cancellation_policy || "");
    const w = {};
    const pw = {};
    for (const p of pitches) {
      w[p.id] = JSON.parse(JSON.stringify(p.booking_windows ?? []));
      pw[p.id] = JSON.parse(JSON.stringify(p.prime_time_windows ?? []));
    }
    setWindows(w);
    setPrime(pw);
    setError(null);
    setSaved(false);
  }, [open, venue, pitches]);

  const saveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      await venueUpdateBookingSettings(venueToken, { bookings_enabled: enabled, cancellation_policy: policy });
      setSaved(true);
      onSaved?.();
    } catch {
      setError("Couldn't save settings — try again.");
    } finally {
      setSavingSettings(false);
    }
  };

  const setPitchWindows = (pitchId, next) => setWindows((w) => ({ ...w, [pitchId]: next }));

  const savePitch = async (pitchId) => {
    setSavingPitch(pitchId);
    setError(null);
    try {
      await venueUpdatePitch(venueToken, pitchId, { booking_windows: windows[pitchId] ?? [] });
      onSaved?.();
    } catch (e) {
      setError(e?.message?.startsWith("booking_window")
        ? "Check the hours: open must be before close, and pick at least one length."
        : "Couldn't save pitch hours — try again.");
    } finally {
      setSavingPitch(null);
    }
  };

  const setPitchPrime = (pitchId, next) => setPrime((p) => ({ ...p, [pitchId]: next }));

  const savePrime = async (pitchId) => {
    setSavingPrime(pitchId);
    setError(null);
    try {
      await venueUpdatePitch(venueToken, pitchId, { prime_time_windows: prime[pitchId] ?? [] });
      onSaved?.();
    } catch (e) {
      setError(e?.message?.startsWith("prime_time_window")
        ? "Check the peak hours: start must be before end."
        : "Couldn't save peak hours — try again.");
    } finally {
      setSavingPrime(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Booking settings" wide>
      <div className="bk-set-section">
        <label className="bk-switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="bk-switch-track"><span className="bk-switch-knob" /></span>
          <span className="bk-switch-label">
            Bookings {enabled ? "on" : "off"}
            <small>Casual teams can find and request this venue when on.</small>
          </span>
        </label>

        <label>Cancellation policy</label>
        <textarea
          value={policy}
          placeholder="e.g. Free cancellation up to 48 hours before kick-off."
          onChange={(e) => setPolicy(e.target.value)}
        />
        <div className="bk-set-save">
          <button className="btn-accent" disabled={savingSettings} onClick={saveSettings}>
            {savingSettings ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
          </button>
        </div>
      </div>

      <div className="bk-set-divider" />

      <h3 className="bk-set-h3">Bookable hours</h3>
      <p className="bk-modal-note">Per pitch, set which weekdays and times accept bookings, and the slot lengths offered.</p>

      {pitches.map((p) => {
        const rows = windows[p.id] ?? [];
        return (
          <div className="bk-set-pitch" key={p.id}>
            <div className="bk-set-pitch-head">
              <span className="bk-set-pitch-name">{p.name}</span>
              <button className="btn-link" onClick={() => setPitchWindows(p.id, [...rows, blankWindow()])}>+ Add window</button>
            </div>
            {rows.length === 0 && <p className="muted bk-set-empty">No windows — this pitch isn't bookable.</p>}
            {rows.map((w, i) => (
              <div className="bk-win" key={i}>
                <select value={w.day_of_week} onChange={(e) => {
                  const next = rows.slice(); next[i] = { ...w, day_of_week: Number(e.target.value) }; setPitchWindows(p.id, next);
                }}>
                  {DAYS.map((d, di) => <option key={di} value={di}>{d}</option>)}
                </select>
                <input type="time" value={w.open_time} onChange={(e) => {
                  const next = rows.slice(); next[i] = { ...w, open_time: e.target.value }; setPitchWindows(p.id, next);
                }} />
                <input type="time" value={w.close_time} onChange={(e) => {
                  const next = rows.slice(); next[i] = { ...w, close_time: e.target.value }; setPitchWindows(p.id, next);
                }} />
                <div className="bk-win-lengths">
                  {LENGTHS.map((l) => {
                    const on = (w.slot_lengths ?? []).includes(l);
                    return (
                      <button
                        key={l}
                        className={"bk-len" + (on ? " is-active" : "")}
                        onClick={() => {
                          const cur = new Set(w.slot_lengths ?? []);
                          on ? cur.delete(l) : cur.add(l);
                          const next = rows.slice();
                          next[i] = { ...w, slot_lengths: [...cur].sort((a, b) => a - b) };
                          setPitchWindows(p.id, next);
                        }}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
                <button className="btn-bad bk-win-x" onClick={() => setPitchWindows(p.id, rows.filter((_, j) => j !== i))} aria-label="Remove window">×</button>
              </div>
            ))}
            <div className="bk-set-save">
              <button disabled={savingPitch === p.id} onClick={() => savePitch(p.id)}>
                {savingPitch === p.id ? "Saving…" : "Save " + p.name}
              </button>
            </div>
          </div>
        );
      })}

      <div className="bk-set-divider" />

      <h3 className="bk-set-h3">Prime-time hours</h3>
      <p className="bk-modal-note">Per pitch, mark the peak weekday hours. HQ uses these to split prime-time vs off-peak utilisation. Leave empty if a pitch has no defined peak.</p>

      {pitches.map((p) => {
        const rows = prime[p.id] ?? [];
        return (
          <div className="bk-set-pitch" key={p.id}>
            <div className="bk-set-pitch-head">
              <span className="bk-set-pitch-name">{p.name}</span>
              <button className="btn-link" onClick={() => setPitchPrime(p.id, [...rows, blankPrimeWindow()])}>+ Add peak window</button>
            </div>
            {rows.length === 0 && <p className="muted bk-set-empty">No peak hours set — this pitch counts as off-peak all day.</p>}
            {rows.map((w, i) => (
              <div className="bk-win" key={i}>
                <select value={w.day_of_week} onChange={(e) => {
                  const next = rows.slice(); next[i] = { ...w, day_of_week: Number(e.target.value) }; setPitchPrime(p.id, next);
                }}>
                  {DAYS.map((d, di) => <option key={di} value={di}>{d}</option>)}
                </select>
                <input type="time" value={w.start_time} onChange={(e) => {
                  const next = rows.slice(); next[i] = { ...w, start_time: e.target.value }; setPitchPrime(p.id, next);
                }} />
                <input type="time" value={w.end_time} onChange={(e) => {
                  const next = rows.slice(); next[i] = { ...w, end_time: e.target.value }; setPitchPrime(p.id, next);
                }} />
                <button className="btn-bad bk-win-x" onClick={() => setPitchPrime(p.id, rows.filter((_, j) => j !== i))} aria-label="Remove peak window">×</button>
              </div>
            ))}
            <div className="bk-set-save">
              <button disabled={savingPrime === p.id} onClick={() => savePrime(p.id)}>
                {savingPrime === p.id ? "Saving…" : "Save " + p.name}
              </button>
            </div>
          </div>
        );
      })}

      {error && <div className="bk-inbox-error">{error}</div>}
    </Modal>
  );
}
