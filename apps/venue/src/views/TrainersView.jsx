import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  venueListTrainers,
  venueUpsertTrainer,
  venueSetTrainerAvailability,
  venueListAppointments,
  venuePtCheckin,
  venueMarkAppointmentCompleted,
  venueListAdmins,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";
import ClassCheckinScanner from "./ClassCheckinScanner.jsx";

// Trainers — Phase 3 of the gym/boxing vertical (mig 358). The venue-operator
// surface for PT / 1-on-1 appointment booking: a roster of trainers (each an
// optional staff login or a no-login card), their recurring weekly availability,
// and the appointment book with QR check-in + completion / no-show. Money rides
// the shared venue_charges ledger ('pt', door path); settlement is dormant until
// live Stripe keys. Mirrors ClassesView structure wholesale.

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((v) => ({ value: v, label: DOW_LABELS[v] }));

const APPT_STATUS = {
  confirmed: { label: "Confirmed", cls: "pill-ok" },
  cancelled: { label: "Cancelled", cls: "pill-muted" },
  completed: { label: "Completed", cls: "pill-info" },
  no_show:   { label: "No-show",   cls: "pill-warn" },
};

const poundsToPence = (v) => Math.round(parseFloat(v || "0") * 100);
const penceToPounds = (p) => ((p || 0) / 100).toFixed(2);
const fmtMoney = (p) => (p ? "£" + penceToPounds(p) : "Free");
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

export default function TrainersView({ venueToken }) {
  const [tab, setTab] = useState("trainers"); // "trainers" | "appointments"
  const [instructors, setInstructors] = useState([]);

  const loadRefs = useCallback(async () => {
    if (!venueToken) return;
    try {
      const ad = await venueListAdmins(venueToken);
      setInstructors((ad?.admins ?? []).filter((a) => a.status === "active"));
    } catch (e) { console.error("[pt] load staff failed", e); }
  }, [venueToken]);
  useEffect(() => { loadRefs(); }, [loadRefs]);

  return (
    <div>
      <div className="chips" style={{ marginBottom: "var(--gap-2, 16px)" }}>
        <button className="chip" aria-pressed={tab === "trainers"} onClick={() => setTab("trainers")}>Trainers</button>
        <button className="chip" aria-pressed={tab === "appointments"} onClick={() => setTab("appointments")}>Appointments</button>
      </div>
      {tab === "trainers" && <TrainersPanel venueToken={venueToken} instructors={instructors} />}
      {tab === "appointments" && <AppointmentsPanel venueToken={venueToken} />}
    </div>
  );
}

// ── Trainers tab ──────────────────────────────────────────────────────────────

function TrainersPanel({ venueToken, instructors }) {
  const [trainers, setTrainers] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);     // trainer object or {} for new
  const [availFor, setAvailFor] = useState(null);    // trainer object
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try { const r = await venueListTrainers(venueToken); setTrainers(r?.trainers ?? []); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);
  useEffect(() => { load(); }, [load]);

  const onSave = async (form) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true); setErr(null);
    try { await venueUpsertTrainer(venueToken, form); setEditing(null); load(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); savingRef.current = false; }
  };

  const list = Array.isArray(trainers) ? trainers : [];

  return (
    <div>
      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Trainers</strong>
          {list.length > 0 && <span className="text-mute">{list.length}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={14} /> Add trainer
          </button>
        </div>

        {err && <p style={{ color: "var(--live)", fontSize: 13, padding: "0 16px" }}>{err}</p>}

        {trainers === null ? (
          <div style={{ padding: 32 }}><span className="text-mute">Loading…</span></div>
        ) : list.length === 0 ? (
          <div style={{ padding: 32 }}>
            <EmptyState title="No trainers yet" body="A trainer is a bookable 1-on-1 resource — a PT, coach or instructor. Link a staff login or add a no-login card, set a price and session length, then add weekly availability so members can book slots." />
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Trainer</th><th>Login</th><th className="num">Session</th><th className="num">Price</th><th>Booking</th><th className="num">Upcoming</th><th /></tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.trainer_id} style={t.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <strong>{t.display_name}</strong>
                    {!t.active && <span className="text-mute"> · inactive</span>}
                    {t.bio && <div className="text-mute" style={{ fontSize: 12 }}>{t.bio}</div>}
                    <div className="text-mute" style={{ fontSize: 12 }}>
                      {(t.availability?.length ?? 0) === 0
                        ? "No availability set"
                        : t.availability.map((a) => `${DOW_LABELS[a.day_of_week]} ${hhmm(a.start_time)}–${hhmm(a.end_time)}`).join(" · ")}
                    </div>
                  </td>
                  <td className="text-mute">{t.admin_email || "No login"}</td>
                  <td className="num text-mute">{t.default_session_minutes}m</td>
                  <td className="num">{fmtMoney(t.price_pence)}</td>
                  <td>
                    {t.members_only
                      ? <span className="pill pill-info"><span className="pill-dot" />Members only</span>
                      : <span className="pill pill-muted"><span className="pill-dot" />Open</span>}
                  </td>
                  <td className="num text-mute">{t.upcoming_count ?? 0}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-xs" onClick={() => setAvailFor(t)}>Availability</button>
                    <button className="btn btn-xs" style={{ marginLeft: 6 }} onClick={() => setEditing(t)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <TrainerModal trainer={editing} instructors={instructors} busy={busy}
          onClose={() => setEditing(null)} onSubmit={onSave} />
      )}
      {availFor && (
        <AvailabilityModal venueToken={venueToken} trainer={availFor}
          onClose={() => setAvailFor(null)} onSaved={() => { setAvailFor(null); load(); }} />
      )}
    </div>
  );
}

function TrainerModal({ trainer, instructors, busy, onClose, onSubmit }) {
  const isNew = !trainer.trainer_id;
  const [displayName, setDisplayName] = useState(trainer.display_name ?? "");
  const [bio, setBio] = useState(trainer.bio ?? "");
  const [adminId, setAdminId] = useState(trainer.admin_id ?? "");
  const [minutes, setMinutes] = useState(String(trainer.default_session_minutes ?? 60));
  const [price, setPrice] = useState(penceToPounds(trainer.price_pence ?? 0));
  const [cutoff, setCutoff] = useState(String(trainer.cancel_cutoff_hours ?? 0));
  const [membersOnly, setMembersOnly] = useState(trainer.members_only ?? true);
  const [active, setActive] = useState(trainer.active ?? true);

  const canSave = displayName.trim().length > 0 && parseInt(minutes, 10) > 0;

  const submit = () => {
    if (!canSave) return;
    onSubmit({
      trainerId: trainer.trainer_id ?? null,
      displayName: displayName.trim(),
      bio: bio.trim() || null,
      adminId: adminId || null,
      defaultSessionMinutes: parseInt(minutes, 10),
      pricePence: poundsToPence(price),
      cancelCutoffHours: parseInt(cutoff, 10) || 0,
      membersOnly,
      active,
    });
  };

  return (
    <Modal onClose={onClose} title={isNew ? "Add trainer" : "Edit trainer"}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={!canSave || busy}>{busy ? "Saving…" : (isNew ? "Add" : "Save")}</button>
      </>}>
      <label className="field-label">Name</label>
      <input className="input" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Danny Ortega" autoFocus style={{ marginBottom: 12 }} />

      <label className="field-label">Staff login (optional)</label>
      <select className="input" value={adminId} onChange={(e) => setAdminId(e.target.value)} style={{ marginBottom: 4 }}>
        <option value="">No login — card only</option>
        {instructors.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
      </select>
      <p className="text-mute" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        Linking a login lets that staff member check members in to their own sessions. Leave blank for a freelance coach who never signs in.
      </p>

      <label className="field-label">Bio (optional)</label>
      <input className="input" type="text" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="e.g. Strength & conditioning, boxing pads" style={{ marginBottom: 12 }} />

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Session length (min)</label>
          <input className="input" type="number" min="1" step="5" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Price (£)</label>
          <input className="input" type="number" min="0" step="0.50" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Cancel cutoff (h)</label>
          <input className="input" type="number" min="0" step="1" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
        </div>
      </div>
      <p className="text-mute" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
        Cutoff 0 = members can cancel any time. Price 0 + Open = a free taster.
      </p>

      <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
        <span>Members only — only active members can book. Untick to let any signed-in member book a trial / one-off (pay at the door).</span>
      </label>

      {!isNew && (
        <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 8 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active — available for members to book</span>
        </label>
      )}
    </Modal>
  );
}

function AvailabilityModal({ venueToken, trainer, onClose, onSaved }) {
  const [rows, setRows] = useState(() => (trainer.availability ?? []).map((a) => ({
    dayOfWeek: a.day_of_week, startTime: hhmm(a.start_time), endTime: hhmm(a.end_time),
    slotMinutes: a.slot_minutes ?? trainer.default_session_minutes ?? 60,
  })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const savingRef = useRef(false);

  const addRow = () => setRows((r) => [...r, { dayOfWeek: 1, startTime: "18:00", endTime: "20:00", slotMinutes: trainer.default_session_minutes ?? 60 }]);
  const update = (i, patch) => setRows((r) => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const remove = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  const valid = rows.every((r) => r.startTime && r.endTime && r.endTime > r.startTime && parseInt(r.slotMinutes, 10) > 0);

  const save = async () => {
    if (savingRef.current || !valid) return;
    savingRef.current = true; setBusy(true); setErr(null);
    try {
      await venueSetTrainerAvailability(venueToken, trainer.trainer_id, rows.map((r) => ({
        dayOfWeek: parseInt(r.dayOfWeek, 10), startTime: r.startTime, endTime: r.endTime,
        slotMinutes: parseInt(r.slotMinutes, 10),
      })));
      onSaved();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); savingRef.current = false; }
  };

  return (
    <Modal onClose={onClose} title={`Availability · ${trainer.display_name}`} wide
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy || !valid}>{busy ? "Saving…" : "Save availability"}</button>
      </>}>
      <p className="text-mute" style={{ fontSize: 13, marginTop: 0 }}>
        Weekly windows. Each window is sliced into bookable slots of the chosen length — e.g. Mon 18:00–20:00 in 60-min slots = two bookable times. Members see future slots minus anything already booked.
      </p>

      {rows.length === 0 && <p className="text-mute" style={{ fontSize: 13 }}>No windows yet — add one below.</p>}

      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ flex: 1.2 }}>
            <label className="field-label">Day</label>
            <select className="input" value={r.dayOfWeek} onChange={(e) => update(i, { dayOfWeek: e.target.value })}>
              {DOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">From</label>
            <input className="input" type="time" value={r.startTime} onChange={(e) => update(i, { startTime: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">To</label>
            <input className="input" type="time" value={r.endTime} onChange={(e) => update(i, { endTime: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Slot (min)</label>
            <input className="input" type="number" min="5" step="5" value={r.slotMinutes} onChange={(e) => update(i, { slotMinutes: e.target.value })} />
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => remove(i)} title="Remove">✕</button>
        </div>
      ))}

      <button className="btn btn-sm" onClick={addRow} style={{ marginTop: 4 }}><Icon name="plus" size={14} /> Add window</button>
      {err && <p style={{ color: "var(--live)", fontSize: 13, marginTop: 12, marginBottom: 0 }}>{err}</p>}
    </Modal>
  );
}

// ── Appointments tab ──────────────────────────────────────────────────────────

function AppointmentsPanel({ venueToken }) {
  const [appts, setAppts] = useState(null);
  const [err, setErr] = useState(null);
  const [scanFor, setScanFor] = useState(null);   // appointment object
  const [busyId, setBusyId] = useState(null);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(); to.setDate(to.getDate() + 30);
      const r = await venueListAppointments(venueToken, { from: from.toISOString(), to: to.toISOString() });
      setAppts(r?.appointments ?? []);
    } catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);
  useEffect(() => { load(); }, [load]);

  const mark = async (appt, noShow) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusyId(appt.appointment_id); setErr(null);
    try { await venueMarkAppointmentCompleted(venueToken, appt.appointment_id, noShow); await load(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { setBusyId(null); savingRef.current = false; }
  };

  const list = Array.isArray(appts) ? appts : [];
  const groups = [];
  let cur = null;
  list.forEach((a) => {
    const k = dayKey(a.starts_at);
    if (!cur || cur.key !== k) { cur = { key: k, items: [] }; groups.push(cur); }
    cur.items.push(a);
  });

  return (
    <div>
      <div className="dt-toolbar" style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 15 }}>Appointments</strong>
        {list.length > 0 && <span className="text-mute">{list.length}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={load} title="Refresh"><Icon name="refresh" size={14} /></button>
      </div>

      {err && <p style={{ color: "var(--live)", fontSize: 13, marginBottom: 12 }}>{err}</p>}
      {appts === null && <p className="text-mute" style={{ fontSize: 13 }}>Loading…</p>}

      {appts !== null && list.length === 0 && (
        <EmptyState title="No appointments" body="Booked PT / 1-on-1 sessions appear here. Add a trainer and weekly availability so members can book." />
      )}

      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 18 }}>
          <div className="rail-nav-label" style={{ marginBottom: 8 }}>{g.key}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.items.map((a) => {
              const st = APPT_STATUS[a.status] || APPT_STATUS.confirmed;
              const actionable = a.status === "confirmed";
              return (
                <div key={a.appointment_id} className="card card-pad">
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 14 }}>{a.member_name || "Member"}</strong>
                        <span className={"pill " + st.cls}><span className="pill-dot" />{st.label}</span>
                        {a.checked_in_at && <span className="pill pill-info">Checked in</span>}
                      </div>
                      <div className="text-mute" style={{ fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span>{fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</span>
                        <span>{a.trainer_name}</span>
                        <span>{fmtMoney(a.price_pence)}</span>
                      </div>
                    </div>
                    {actionable && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {!a.checked_in_at && <button className="btn btn-xs btn-primary" onClick={() => setScanFor(a)}>Check in</button>}
                        <button className="btn btn-xs" disabled={busyId === a.appointment_id} onClick={() => mark(a, false)}>Completed</button>
                        <button className="btn btn-xs btn-danger" disabled={busyId === a.appointment_id} onClick={() => mark(a, true)}>No-show</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {scanFor && (
        <ClassCheckinScanner venueToken={venueToken} className={`PT · ${scanFor.member_name || "Member"}`}
          checkin={(val) => venuePtCheckin(venueToken, scanFor.appointment_id, val)}
          onClose={() => { setScanFor(null); load(); }} />
      )}
    </div>
  );
}
