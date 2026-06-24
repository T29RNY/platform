import React, { useState, useEffect } from "react";
import Modal from "./Modal.jsx";
import { venueUpdateBookingSettings, venueUpdatePitch, venueSetPitchReservedWindows, venueListClubs, clubListTeams } from "@platform/core/storage/supabase.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LENGTHS = [30, 45, 60, 90, 120];

function blankWindow() {
  return { day_of_week: 1, open_time: "18:00", close_time: "22:00", slot_lengths: [60] };
}

function blankPrimeWindow() {
  return { day_of_week: 1, start_time: "18:00", end_time: "22:00" };
}

// A reserved time band held for the club's own use. audience: internal (any club
// team) | team (one named team) | min_rank (teams ranked at least this good).
function blankReservedWindow() {
  return { day_of_week: 1, start_time: "18:00", end_time: "20:00", audience: "internal", club_team_id: "", min_rank: "", note: "" };
}

export default function BookingSettings({ open, onClose, venueToken, venue, pitches, reservedByPitch = null, onReservedSaved, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState("");
  const [windows, setWindows] = useState({});     // pitchId -> [window]
  const [prime, setPrime] = useState({});         // pitchId -> [prime window] (per-pitch override)
  const [venuePrime, setVenuePrime] = useState([]); // venue-level default prime band
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPitch, setSavingPitch] = useState(null);
  const [savingPrime, setSavingPrime] = useState(null);
  const [savingVenuePrime, setSavingVenuePrime] = useState(false);
  const [reserved, setReserved] = useState({});      // pitchId -> [reserved window]
  const [savingReserved, setSavingReserved] = useState(null);
  const [clubTeams, setClubTeams] = useState([]);     // {team_id, name, priority_rank}
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnabled(!!venue.bookings_enabled);
    setPolicy(venue.cancellation_policy || "");
    const w = {};
    const pw = {};
    const rw = {};
    for (const p of pitches) {
      w[p.id] = JSON.parse(JSON.stringify(p.booking_windows ?? []));
      pw[p.id] = JSON.parse(JSON.stringify(p.prime_time_windows ?? []));
      rw[p.id] = (reservedByPitch?.get(p.id) ?? []).map((r) => ({
        day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time,
        audience: r.audience, club_team_id: r.club_team_id || "",
        min_rank: r.min_rank ?? "", note: r.note || "",
      }));
    }
    setWindows(w);
    setPrime(pw);
    setReserved(rw);
    setVenuePrime(JSON.parse(JSON.stringify(venue.default_prime_time_windows ?? [])));
    setError(null);
    setSaved(false);
  }, [open, venue, pitches, reservedByPitch]);

  // The club teams hosted at this venue feed the reserved-window team picker.
  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      try {
        const clubs = await venueListClubs(venueToken);
        const lists = await Promise.all((clubs ?? []).map((c) => clubListTeams(venueToken, c.id, false).catch(() => [])));
        if (live) setClubTeams(lists.flat());
      } catch { if (live) setClubTeams([]); }
    })();
    return () => { live = false; };
  }, [open, venueToken]);

  const setPitchReserved = (pitchId, next) => setReserved((r) => ({ ...r, [pitchId]: next }));

  const saveReserved = async (pitchId) => {
    setSavingReserved(pitchId);
    setError(null);
    try {
      const rows = (reserved[pitchId] ?? []).map((r) => ({
        day_of_week: Number(r.day_of_week),
        start_time: r.start_time,
        end_time: r.end_time,
        audience: r.audience,
        club_team_id: r.audience === "team" ? (r.club_team_id || null) : null,
        min_rank: r.audience === "min_rank" ? Number(r.min_rank) : null,
        note: r.note?.trim() || null,
      }));
      await venueSetPitchReservedWindows(venueToken, pitchId, rows);
      onReservedSaved?.();
    } catch (e) {
      setError(e?.message?.startsWith("reserved_window")
        ? "Check the reserved times: start before end, and pick a team when 'Specific team' is set."
        : "Couldn't save reserved times — try again.");
    } finally {
      setSavingReserved(null);
    }
  };

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

  const saveVenuePrime = async () => {
    setSavingVenuePrime(true);
    setError(null);
    try {
      await venueUpdateBookingSettings(venueToken, { default_prime_time_windows: venuePrime });
      onSaved?.();
    } catch (e) {
      setError(e?.message?.startsWith("default_prime_time_window")
        ? "Check the default peak hours: start must be before end."
        : "Couldn't save default peak hours — try again.");
    } finally {
      setSavingVenuePrime(false);
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
        <label className={"bk-switch" + (enabled ? " on" : "")}>
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
              <button className="btn-link" onClick={() => setPitchWindows(p.id, [blankWindow(), ...rows])}>+ Add window</button>
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

      <h3 className="bk-set-h3">Reserved times</h3>
      <p className="bk-modal-note">Hold weekly time bands for your own club. These shade the calendar so everyone can see what's spoken for. (Blocking outside bookings and rank priority come next — for now this is a heads-up only.)</p>

      {pitches.map((p) => {
        const rows = reserved[p.id] ?? [];
        return (
          <div className="bk-set-pitch" key={p.id}>
            <div className="bk-set-pitch-head">
              <span className="bk-set-pitch-name">{p.name}</span>
              <button className="btn-link" onClick={() => setPitchReserved(p.id, [blankReservedWindow(), ...rows])}>+ Add reserved time</button>
            </div>
            {rows.length === 0 && <p className="muted bk-set-empty">No reserved times on this pitch.</p>}
            {rows.map((w, i) => {
              const upd = (patch) => { const next = rows.slice(); next[i] = { ...w, ...patch }; setPitchReserved(p.id, next); };
              return (
                <div className="bk-win bk-win-reserved" key={i}>
                  <select value={w.day_of_week} onChange={(e) => upd({ day_of_week: Number(e.target.value) })}>
                    {DAYS.map((d, di) => <option key={di} value={di}>{d}</option>)}
                  </select>
                  <input type="time" value={w.start_time} onChange={(e) => upd({ start_time: e.target.value })} />
                  <input type="time" value={w.end_time} onChange={(e) => upd({ end_time: e.target.value })} />
                  <select value={w.audience} onChange={(e) => upd({ audience: e.target.value })} aria-label="Reserved for">
                    <option value="internal">Any club team</option>
                    <option value="team">Specific team</option>
                    <option value="min_rank">Rank or better</option>
                  </select>
                  {w.audience === "team" && (
                    <select value={w.club_team_id} onChange={(e) => upd({ club_team_id: e.target.value })} aria-label="Team">
                      <option value="">Pick a team…</option>
                      {clubTeams.map((t) => <option key={t.team_id} value={t.team_id}>{t.name}{t.priority_rank ? ` (#${t.priority_rank})` : ""}</option>)}
                    </select>
                  )}
                  {w.audience === "min_rank" && (
                    <input type="number" min={1} value={w.min_rank} placeholder="Rank" onChange={(e) => upd({ min_rank: e.target.value })} aria-label="Minimum rank" style={{ width: "5rem" }} />
                  )}
                  <button className="btn-bad bk-win-x" onClick={() => setPitchReserved(p.id, rows.filter((_, j) => j !== i))} aria-label="Remove reserved time">×</button>
                </div>
              );
            })}
            <div className="bk-set-save">
              <button disabled={savingReserved === p.id} onClick={() => saveReserved(p.id)}>
                {savingReserved === p.id ? "Saving…" : "Save " + p.name}
              </button>
            </div>
          </div>
        );
      })}

      <div className="bk-set-divider" />

      <h3 className="bk-set-h3">Prime-time hours</h3>
      <p className="bk-modal-note">Mark your peak hours. HQ uses these to split prime-time vs off-peak utilisation. Set a venue default that applies to every pitch, then override individual pitches below only if they differ.</p>

      <div className="bk-set-pitch">
        <div className="bk-set-pitch-head">
          <span className="bk-set-pitch-name">Venue default (all pitches)</span>
          <button className="btn-link" onClick={() => setVenuePrime([blankPrimeWindow(), ...venuePrime])}>+ Add peak window</button>
        </div>
        {venuePrime.length === 0 && <p className="muted bk-set-empty">No default peak hours — pitches without their own override count as off-peak all day.</p>}
        {venuePrime.map((w, i) => (
          <div className="bk-win" key={i}>
            <select value={w.day_of_week} onChange={(e) => {
              const next = venuePrime.slice(); next[i] = { ...w, day_of_week: Number(e.target.value) }; setVenuePrime(next);
            }}>
              {DAYS.map((d, di) => <option key={di} value={di}>{d}</option>)}
            </select>
            <input type="time" value={w.start_time} onChange={(e) => {
              const next = venuePrime.slice(); next[i] = { ...w, start_time: e.target.value }; setVenuePrime(next);
            }} />
            <input type="time" value={w.end_time} onChange={(e) => {
              const next = venuePrime.slice(); next[i] = { ...w, end_time: e.target.value }; setVenuePrime(next);
            }} />
            <button className="btn-bad bk-win-x" onClick={() => setVenuePrime(venuePrime.filter((_, j) => j !== i))} aria-label="Remove peak window">×</button>
          </div>
        ))}
        <div className="bk-set-save">
          <button disabled={savingVenuePrime} onClick={saveVenuePrime}>
            {savingVenuePrime ? "Saving…" : "Save venue default"}
          </button>
        </div>
      </div>

      <p className="bk-modal-note">Override per pitch (optional) — only set these if a pitch's peak hours differ from the venue default.</p>

      {pitches.map((p) => {
        const rows = prime[p.id] ?? [];
        return (
          <div className="bk-set-pitch" key={p.id}>
            <div className="bk-set-pitch-head">
              <span className="bk-set-pitch-name">{p.name}</span>
              <button className="btn-link" onClick={() => setPitchPrime(p.id, [blankPrimeWindow(), ...rows])}>+ Add peak window</button>
            </div>
            {rows.length === 0 && <p className="muted bk-set-empty">No override — this pitch uses the venue default.</p>}
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
