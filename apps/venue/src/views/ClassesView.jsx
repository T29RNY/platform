import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  venueListClassTypes,
  venueCreateClassType,
  venueUpdateClassType,
  venueListClassSessions,
  venueGetClassSessionDetail,
  venueScheduleClassSession,
  venueCreateClassSeries,
  venueCancelClassSession,
  venueCancelClassSeries,
  venueReassignClassInstructor,
  venueMarkClassCompleted,
  venueListSpaces,
  venueListAdmins,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";

// Classes — Phase 2 of CLASSES_ROOM_HIRE_PLAN (mig 339). The venue-operator
// surface: the class catalogue (types) + the schedule (one-off + recurring
// sessions) with fill-rate indicators, scheduled against the Phase 1 spaces.
// Member booking, real attendee counts and the no-show policy land in Phase 3 —
// booked_count/waitlist_count read 0 here until then.

const CATEGORIES = [
  ["fitness",      "Fitness"],
  ["yoga",         "Yoga"],
  ["dance",        "Dance"],
  ["martial_arts", "Martial arts"],
  ["other",        "Other"],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);

const PAYMENT_MODES = [
  ["door",   "Pay at door"],
  ["prepay", "Prepay"],
  ["both",   "Either"],
];
const PAY_LABEL = Object.fromEntries(PAYMENT_MODES);

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((v) => ({ value: v, label: DOW_LABELS[v] }));

const SESSION_STATUS = {
  scheduled: { label: "Scheduled", cls: "pill-ok" },
  cancelled: { label: "Cancelled", cls: "pill-muted" },
  completed: { label: "Completed", cls: "pill-info" },
};

const poundsToPence = (v) => Math.round(parseFloat(v || "0") * 100);
const penceToPounds = (p) => ((p || 0) / 100).toFixed(2);
const fmtMoney = (p) => (p ? "£" + penceToPounds(p) : "Free");

const fmtDt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// Fill-rate pill — colour by % of capacity booked (real once Phase 3 lands).
function fillPill(booked, capacity) {
  const cap = capacity || 0;
  const pct = cap > 0 ? Math.round((booked / cap) * 100) : 0;
  const cls = pct >= 90 ? "pill-warn" : pct > 0 ? "pill-info" : "pill-muted";
  return <span className={"pill " + cls}><span className="pill-dot" />{booked}/{cap || "∞"}</span>;
}

export default function ClassesView({ venueToken }) {
  const [tab, setTab] = useState("schedule"); // "schedule" | "types"
  const [types, setTypes] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [err, setErr] = useState(null);

  const loadRefs = useCallback(async () => {
    if (!venueToken) return;
    try {
      const [sp, ad] = await Promise.all([venueListSpaces(venueToken), venueListAdmins(venueToken)]);
      setSpaces((Array.isArray(sp) ? sp : []).filter((s) => s.is_active));
      setInstructors((ad?.admins ?? []).filter((a) => a.status === "active"));
    } catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);

  const loadTypes = useCallback(async () => {
    if (!venueToken) return;
    try { setTypes(await venueListClassTypes(venueToken)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);

  useEffect(() => { loadRefs(); loadTypes(); }, [loadRefs, loadTypes]);

  if (err) return <EmptyState title="Couldn’t load classes" body={err} action={<button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setErr(null); loadRefs(); loadTypes(); }}>Retry</button>} />;

  const typeList = Array.isArray(types) ? types : [];
  const activeTypes = typeList.filter((t) => t.is_active);

  return (
    <div>
      <div className="chips" style={{ marginBottom: "var(--gap-2, 16px)" }}>
        <button className="chip" aria-pressed={tab === "schedule"} onClick={() => setTab("schedule")}>Schedule</button>
        <button className="chip" aria-pressed={tab === "types"} onClick={() => setTab("types")}>Class types</button>
      </div>

      {tab === "types" && (
        <ClassTypesPanel
          venueToken={venueToken} types={typeList} spaces={spaces}
          onChanged={() => { loadTypes(); }}
        />
      )}
      {tab === "schedule" && (
        <SchedulePanel
          venueToken={venueToken} types={activeTypes} instructors={instructors}
          noTypes={types !== null && activeTypes.length === 0}
          onGoToTypes={() => setTab("types")}
        />
      )}
    </div>
  );
}

// ── Class types tab ──────────────────────────────────────────────────────────

function ClassTypesPanel({ venueToken, types, spaces, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const savingRef = useRef(false);

  const onSave = async (form) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true); setErr(null);
    try {
      if (form.id) {
        const { id, ...rest } = form;
        await venueUpdateClassType(venueToken, id, rest);
      } else {
        await venueCreateClassType(venueToken, form);
      }
      setEditing(null);
      onChanged();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); savingRef.current = false; }
  };

  if (spaces.length === 0) {
    return <EmptyState title="Add a space first" body="Class types are scheduled against a space (studio, room or hall). Create one under Facilities → Spaces, then come back." />;
  }

  return (
    <div>
      <div className="dt-card">
        <div className="dt-toolbar">
          <strong style={{ fontSize: 15 }}>Class types</strong>
          {types.length > 0 && <span className="text-mute">{types.length}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={14} /> Add class type
          </button>
        </div>

        {err && <p style={{ color: "var(--live)", fontSize: 13, padding: "0 16px" }}>{err}</p>}

        {types.length === 0 ? (
          <div style={{ padding: 32 }}>
            <EmptyState title="No class types yet" body="A class type is a template — e.g. ‘Vinyasa Yoga’, 60 min, capacity 12, in Studio 1. You’ll schedule individual sessions or a recurring block from it." />
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr><th>Name</th><th>Category</th><th>Space</th><th className="num">Length</th><th className="num">Cap</th><th className="num">Upcoming</th><th /></tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <strong>{t.name}</strong>
                    {t.first_session_free && <span className="pill pill-info" style={{ marginLeft: 8 }}>1st free</span>}
                    {!t.is_active && <span className="text-mute"> · inactive</span>}
                    {t.description && <div className="text-mute" style={{ fontSize: 12 }}>{t.description}</div>}
                  </td>
                  <td className="text-mute">{CAT_LABEL[t.category] || t.category}</td>
                  <td className="text-mute">{t.space_name}</td>
                  <td className="num text-mute">{t.duration_minutes}m</td>
                  <td className="num">{t.default_capacity}</td>
                  <td className="num text-mute">{t.upcoming_session_count ?? 0}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-xs" onClick={() => setEditing(t)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ClassTypeModal classType={editing} spaces={spaces} busy={busy}
          onClose={() => setEditing(null)} onSubmit={onSave} />
      )}
    </div>
  );
}

function ClassTypeModal({ classType, spaces, busy, onClose, onSubmit }) {
  const isNew = !classType.id;
  const [name, setName] = useState(classType.name ?? "");
  const [spaceId, setSpaceId] = useState(classType.space_id ?? (spaces[0]?.id ?? ""));
  const [category, setCategory] = useState(classType.category ?? "fitness");
  const [duration, setDuration] = useState(String(classType.duration_minutes ?? 60));
  const [capacity, setCapacity] = useState(String(classType.default_capacity ?? 12));
  const [cutoff, setCutoff] = useState(String(classType.cancellation_cutoff_hours ?? 2));
  const [firstFree, setFirstFree] = useState(classType.first_session_free ?? false);
  const [description, setDescription] = useState(classType.description ?? "");
  const [isActive, setIsActive] = useState(classType.is_active ?? true);

  const submit = () => {
    const dur = parseInt(duration, 10);
    const cap = parseInt(capacity, 10);
    const cut = parseInt(cutoff, 10);
    if (!name.trim() || !spaceId || !Number.isFinite(dur) || dur <= 0 || !Number.isFinite(cap) || cap < 0) return;
    if (isNew) {
      onSubmit({
        name: name.trim(), spaceId, durationMinutes: dur, defaultCapacity: cap,
        category, cancellationCutoffHours: Number.isFinite(cut) ? cut : 2,
        firstSessionFree: firstFree, description: description.trim() || null,
      });
    } else {
      onSubmit({
        id: classType.id, name: name.trim(), space_id: spaceId,
        duration_minutes: dur, default_capacity: cap, category,
        cancellation_cutoff_hours: Number.isFinite(cut) ? cut : 2,
        first_session_free: firstFree, description: description.trim() || null, is_active: isActive,
      });
    }
  };

  return (
    <Modal onClose={onClose} title={isNew ? "Add class type" : "Edit class type"}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>{busy ? "Saving…" : (isNew ? "Add" : "Save")}</button>
      </>}>
      <label className="field-label">Name</label>
      <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vinyasa Yoga" autoFocus style={{ marginBottom: 12 }} />

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 2 }}>
          <label className="field-label">Space</label>
          <select className="input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Length (min)</label>
          <input className="input" type="number" min="1" step="5" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Capacity</label>
          <input className="input" type="number" min="0" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Cancel cutoff (h)</label>
          <input className="input" type="number" min="0" step="1" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
        </div>
      </div>

      <label className="field-label">Description (optional)</label>
      <input className="input" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. All levels, mats provided" style={{ marginBottom: 12 }} />

      <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={firstFree} onChange={(e) => setFirstFree(e.target.checked)} />
        <span>First session free — waives the charge on a member’s first booking here</span>
      </label>

      {!isNew && (
        <label className="row-check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 8 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Active — available to schedule</span>
        </label>
      )}
    </Modal>
  );
}

// ── Schedule tab ─────────────────────────────────────────────────────────────

function SchedulePanel({ venueToken, types, instructors, noTypes, onGoToTypes }) {
  const [sessions, setSessions] = useState(null);
  const [err, setErr] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(); to.setDate(to.getDate() + 120);
      setSessions(await venueListClassSessions(venueToken, { from: from.toISOString(), to: to.toISOString() }));
    } catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);

  useEffect(() => { load(); }, [load]);

  if (noTypes) {
    return <EmptyState title="No class types yet" body="Create a class type before scheduling sessions."
      action={<button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onGoToTypes}>Add class type</button>} />;
  }

  const list = Array.isArray(sessions) ? sessions : [];
  // group by day
  const groups = [];
  let cur = null;
  list.forEach((s) => {
    const k = dayKey(s.starts_at);
    if (!cur || cur.key !== k) { cur = { key: k, items: [] }; groups.push(cur); }
    cur.items.push(s);
  });

  return (
    <div>
      <div className="dt-toolbar" style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 15 }}>Upcoming sessions</strong>
        {list.length > 0 && <span className="text-mute">{list.length}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={load} title="Refresh"><Icon name="refresh" size={14} /></button>
        <button className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={14} /> Schedule
        </button>
      </div>

      {err && <p style={{ color: "var(--live)", fontSize: 13, marginBottom: 12 }}>{err}</p>}
      {sessions === null && <p className="text-mute" style={{ fontSize: 13 }}>Loading…</p>}

      {sessions !== null && list.length === 0 && (
        <EmptyState title="Nothing scheduled" body="Schedule a one-off session or a recurring weekly block from one of your class types."
          action={<button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setCreateOpen(true)}>Schedule a session</button>} />
      )}

      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 18 }}>
          <div className="rail-nav-label" style={{ marginBottom: 8 }}>{g.key}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.items.map((s) => {
              const st = SESSION_STATUS[s.status] || SESSION_STATUS.scheduled;
              return (
                <div key={s.id} className="card card-pad" style={{ cursor: "pointer" }} onClick={() => setDetailId(s.id)}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 14 }}>{s.class_name}</strong>
                        <span className={"pill " + st.cls}><span className="pill-dot" />{st.label}</span>
                        {s.series_id && <span className="pill pill-muted">Recurring</span>}
                      </div>
                      <div className="text-mute" style={{ fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
                        <span>{s.space_name}</span>
                        {s.instructor_email && <span>{s.instructor_email}</span>}
                        <span>{fmtMoney(s.price_pence)} · {PAY_LABEL[s.payment_mode] || s.payment_mode}</span>
                      </div>
                    </div>
                    {s.status === "scheduled" && fillPill(s.booked_count ?? 0, s.capacity)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {createOpen && (
        <CreateSessionModal venueToken={venueToken} types={types} instructors={instructors}
          onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); load(); }} />
      )}
      {detailId && (
        <SessionDetailModal venueToken={venueToken} sessionId={detailId} instructors={instructors}
          onClose={() => setDetailId(null)} onChanged={() => { load(); }} />
      )}
    </div>
  );
}

function CreateSessionModal({ venueToken, types, instructors, onClose, onDone }) {
  const [mode, setMode] = useState("oneoff"); // "oneoff" | "recurring"
  const [classTypeId, setClassTypeId] = useState(types[0]?.id ?? "");
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? "");
  const [paymentMode, setPaymentMode] = useState("door");
  const [price, setPrice] = useState("0.00");
  // one-off
  const [startsAt, setStartsAt] = useState("");
  // recurring
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("");
  const [seriesStart, setSeriesStart] = useState("");
  const [seriesEnd, setSeriesEnd] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const savingRef = useRef(false);

  const submit = async () => {
    if (savingRef.current) return;
    setErr(null);
    if (!classTypeId) { setErr("Pick a class type."); return; }
    if (!instructorId) { setErr("Pick an instructor."); return; }
    if (mode === "oneoff" && !startsAt) { setErr("Pick a date and time."); return; }
    if (mode === "recurring") {
      if (!startTime) { setErr("Pick a start time."); return; }
      if (!seriesStart) { setErr("Pick a start date."); return; }
      if (seriesEnd && seriesEnd < seriesStart) { setErr("End date must be after the start date."); return; }
    }
    savingRef.current = true; setBusy(true);
    try {
      if (mode === "oneoff") {
        await venueScheduleClassSession(venueToken, {
          classTypeId, instructorId, startsAt: new Date(startsAt).toISOString(),
          pricePence: poundsToPence(price), paymentMode,
        });
        onDone();
      } else {
        const r = await venueCreateClassSeries(venueToken, {
          classTypeId, instructorId, dayOfWeek: parseInt(dayOfWeek, 10), startTime,
          seriesStart, seriesEnd: seriesEnd || null,
          pricePence: poundsToPence(price), paymentMode,
        });
        // surface created/skipped before closing so conflicts are visible
        setResult(r);
      }
    } catch (e) {
      setErr(e?.message === "space_unavailable" ? "That space is already booked at that time." : (e?.message || String(e)));
    } finally { savingRef.current = false; setBusy(false); }
  };

  if (result) {
    return (
      <Modal onClose={onDone} title="Recurring block created"
        foot={<><span className="spacer" /><button className="btn btn-primary" onClick={onDone}>Done</button></>}>
        <p style={{ fontSize: 14 }}>
          Created <strong>{result.sessions_created}</strong> session{result.sessions_created === 1 ? "" : "s"}.
          {result.sessions_skipped > 0 && <> {result.sessions_skipped} were skipped because the space was already booked at that time.</>}
        </p>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Schedule a class"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Scheduling…" : mode === "recurring" ? "Create recurring block" : "Schedule session"}
        </button>
      </>}>
      <div className="chips" style={{ marginBottom: 14 }}>
        <button className="chip" aria-pressed={mode === "oneoff"} onClick={() => setMode("oneoff")}>One-off</button>
        <button className="chip" aria-pressed={mode === "recurring"} onClick={() => setMode("recurring")}>Recurring block</button>
      </div>

      <label className="field-label">Class type</label>
      <select className="input" value={classTypeId} onChange={(e) => setClassTypeId(e.target.value)} style={{ marginBottom: 12 }}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.space_name} · {t.duration_minutes}m</option>)}
      </select>

      <label className="field-label">Instructor</label>
      <select className="input" value={instructorId} onChange={(e) => setInstructorId(e.target.value)} style={{ marginBottom: 12 }}>
        {instructors.length === 0 && <option value="">No active staff — add staff first</option>}
        {instructors.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
      </select>

      {mode === "oneoff" ? (
        <>
          <label className="field-label">Date & time</label>
          <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={{ marginBottom: 12 }} />
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">Day</label>
              <select className="input" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                {DOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">Time</label>
              <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">From</label>
              <input className="input" type="date" value={seriesStart} onChange={(e) => setSeriesStart(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">To (optional)</label>
              <input className="input" type="date" value={seriesEnd} onChange={(e) => setSeriesEnd(e.target.value)} />
            </div>
          </div>
          <p className="text-mute" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
            Leave “To” blank for an open block — sessions are generated 6 months ahead.
          </p>
        </>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Price (£)</label>
          <input className="input" type="number" min="0" step="0.50" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Payment</label>
          <select className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
            {PAYMENT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {err && <p style={{ color: "var(--live)", fontSize: 13, marginTop: 12, marginBottom: 0 }}>{err}</p>}
    </Modal>
  );
}

function SessionDetailModal({ venueToken, sessionId, instructors, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(null); // 'cancel' | 'cancelSeries' | 'complete'
  const [reassignOpen, setReassignOpen] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    try { setData(await venueGetClassSessionDetail(venueToken, sessionId)); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken, sessionId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true); setErr(null);
    try { await fn(); onChanged(); await load(); setConfirm(null); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { savingRef.current = false; setBusy(false); }
  };

  const s = data;
  const st = s ? (SESSION_STATUS[s.status] || SESSION_STATUS.scheduled) : null;
  const scheduled = s?.status === "scheduled";

  return (
    <Modal onClose={onClose} title={s?.class_name || "Session"} wide>
      {!s && !err && <p className="text-mute" style={{ fontSize: 13 }}>Loading…</p>}
      {err && <p style={{ color: "var(--live)", fontSize: 13 }}>{err}</p>}

      {s && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className={"pill " + st.cls}><span className="pill-dot" />{st.label}</span>
            {s.series_id && <span className="pill pill-muted">Recurring</span>}
            {fillPill(s.attendees?.length ?? 0, s.capacity)}
          </div>

          <div className="text-mute" style={{ fontSize: 13, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span>{fmtDt(s.starts_at)}–{fmtTime(s.ends_at)}</span>
            <span>{s.space_name}</span>
            <span>{s.instructor_email}</span>
            <span>{fmtMoney(s.price_pence)} · {PAY_LABEL[s.payment_mode] || s.payment_mode}</span>
          </div>
          {s.status === "cancelled" && s.cancellation_reason && (
            <p className="text-mute" style={{ fontSize: 13, margin: 0 }}>Reason: {s.cancellation_reason}</p>
          )}

          {/* Attendees — populated once member booking lands (Phase 3) */}
          <div>
            <div className="rail-nav-label" style={{ marginBottom: 8 }}>Attendees</div>
            {(s.attendees?.length ?? 0) === 0 ? (
              <p className="text-mute" style={{ fontSize: 13, margin: 0 }}>No bookings yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {s.attendees.map((a) => (
                  <div key={a.booking_id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{a.member_name || "Member"}</span>
                    <span className="pill pill-muted">{a.status}</span>
                    <span className="text-mute">{a.payment_status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {scheduled && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={() => setReassignOpen(true)} disabled={busy}>Change instructor</button>
              <button className="btn btn-sm" onClick={() => run(() => venueMarkClassCompleted(venueToken, sessionId))} disabled={busy}>Mark completed</button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm btn-danger" onClick={() => setConfirm("cancel")} disabled={busy}>Cancel session</button>
              {s.series_id && (
                <button className="btn btn-sm btn-danger" style={{ opacity: 0.85 }} onClick={() => setConfirm("cancelSeries")} disabled={busy}>Cancel series</button>
              )}
            </div>
          )}

          {confirm && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <label className="field-label">
                {confirm === "cancelSeries" ? "Cancel all remaining sessions in this block?" : "Cancel this session?"}
              </label>
              <input className="input" type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional) — e.g. instructor unavailable" style={{ marginBottom: 10 }} />
              <p className="text-mute" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
                Booked members are refunded and notified automatically.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => { setConfirm(null); setReason(""); }} disabled={busy}>Keep it</button>
                <span style={{ flex: 1 }} />
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() =>
                  confirm === "cancelSeries"
                    ? venueCancelClassSeries(venueToken, s.series_id, reason.trim() || null)
                    : venueCancelClassSession(venueToken, sessionId, reason.trim() || null)
                )}>{busy ? "Cancelling…" : "Confirm cancel"}</button>
              </div>
            </div>
          )}

          {reassignOpen && (
            <ReassignInline instructors={instructors} current={s.instructor_id} busy={busy}
              onClose={() => setReassignOpen(false)}
              onPick={(id) => run(() => venueReassignClassInstructor(venueToken, sessionId, id)).then(() => setReassignOpen(false))} />
          )}
        </div>
      )}
    </Modal>
  );
}

function ReassignInline({ instructors, current, busy, onClose, onPick }) {
  const [pick, setPick] = useState(current ?? (instructors[0]?.id ?? ""));
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <label className="field-label">Reassign instructor</label>
      <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ marginBottom: 10 }}>
        {instructors.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
      </select>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" disabled={busy || !pick || pick === current} onClick={() => onPick(pick)}>{busy ? "Saving…" : "Reassign"}</button>
      </div>
    </div>
  );
}
