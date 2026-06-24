import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  venueListClubs,
  venueListClubVenues,
  clubListCohorts,
  clubListSessions,
  clubCreateSession,
  clubCreateSessionSeries,
  clubCancelSession,
  clubCancelSessionSeries,
  clubGetSessionRsvps,
  clubMarkAttendance,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

const fmtDt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

const SESSION_STATUS = {
  scheduled: { label: "Scheduled", cls: "pill-ok" },
  cancelled:  { label: "Cancelled", cls: "pill-muted" },
};

const ATTENDANCE_STATUS = [
  ["attended", "Attended", "pill-ok"],
  ["absent",   "Absent",   "pill-muted"],
  ["late",     "Late",     "pill-warn"],
];
const ATT_LABEL = { attended: "Attended", absent: "Absent", late: "Late" };
const ATT_CLS   = { attended: "pill-ok",  absent: "pill-muted", late: "pill-warn" };

const RSVP_STATUS = {
  in:      { label: "Going",   cls: "pill-ok" },
  out:     { label: "Not going", cls: "pill-muted" },
  maybe:   { label: "Maybe",   cls: "pill-info" },
  pending: { label: "Pending", cls: "pill-warn" },
};

const SESSION_TYPE_LABELS = {
  training: "Training", match: "Match", friendly: "Friendly", other: "Other",
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Map display label → DB value (EXTRACT(DOW): 0=Sun…6=Sat)
const DOW_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((v) => ({ value: v, label: DOW_LABELS[v] }));

export default function SessionsView({ venueToken }) {
  const [clubs, setClubs] = useState(null);
  const [selectedClubId, setSelectedClubId] = useState(null);
  const [err, setErr] = useState(null);

  const loadClubs = useCallback(async () => {
    if (!venueToken) return;
    setErr(null);
    try {
      const list = await venueListClubs(venueToken);
      setClubs(Array.isArray(list) ? list : []);
      if (list.length === 1) setSelectedClubId(list[0].id);
    } catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken]);

  useEffect(() => { loadClubs(); }, [loadClubs]);

  if (!clubs) return <div className="empty"><p style={{ color: "var(--ink-3)" }}>Loading…</p></div>;
  if (err) return <div className="empty"><p style={{ color: "var(--live)" }}>{err}</p></div>;
  if (clubs.length === 0) return (
    <EmptyState
      title="No clubs yet"
      body="Create a club under the Memberships tab first."
    />
  );

  return (
    <div>
      {clubs.length > 1 && (
        <div className="chips" style={{ marginBottom: "var(--gap-2)" }}>
          {clubs.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={selectedClubId === c.id}
              onClick={() => setSelectedClubId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {selectedClubId && (
        <SessionsPanel key={selectedClubId} venueToken={venueToken} clubId={selectedClubId} />
      )}
    </div>
  );
}

function SessionsPanel({ venueToken, clubId }) {
  const [cohorts, setCohorts] = useState([]);
  const [venues, setVenues] = useState([]);      // club's same-operator venues (incl. self)
  const [sessions, setSessions] = useState(null);
  const [filterCohort, setFilterCohort] = useState(null);
  const [filterVenue, setFilterVenue] = useState(null);  // null = all sites
  const [err, setErr] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null); // session object

  const loadCohorts = useCallback(async () => {
    try { setCohorts(await clubListCohorts(venueToken, clubId)); }
    catch (e) { console.error(e); }
  }, [venueToken, clubId]);

  // The club's venues, filtered to the caller's operator (same company_id) — the
  // same-operator seam. Used for the create-time venue picker and the list filter.
  const loadVenues = useCallback(async () => {
    try {
      const r = await venueListClubVenues(venueToken, clubId);
      const all = r?.venues ?? [];
      const self = all.find((v) => v.is_self);
      const company = self?.company_id ?? null;
      const sameOperator = company
        ? all.filter((v) => v.company_id === company)
        : all.filter((v) => v.is_self);
      setVenues(sameOperator);
    } catch (e) { console.error(e); }
  }, [venueToken, clubId]);

  const loadSessions = useCallback(async () => {
    setErr(null);
    try { setSessions(await clubListSessions(venueToken, clubId, { cohortId: filterCohort })); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken, clubId, filterCohort]);

  useEffect(() => { loadCohorts(); }, [loadCohorts]);
  useEffect(() => { loadVenues(); }, [loadVenues]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Cross-site visibility: the operator sees every session for the club across all
  // their venues; the venue filter narrows to one site without a server round-trip.
  const shownSessions = sessions === null
    ? null
    : (filterVenue ? sessions.filter((s) => s.venue_id === filterVenue) : sessions);

  return (
    <div>
      <SectionHead label="Sessions" count={shownSessions?.length ?? 0}>
        <button className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
          + New session
        </button>
      </SectionHead>

      {/* Venue filter — only when the club operates from more than one site */}
      {venues.length > 1 && (
        <div className="chips" style={{ marginBottom: "var(--gap-2)" }}>
          <button className="chip" aria-pressed={filterVenue === null} onClick={() => setFilterVenue(null)}>
            All sites
          </button>
          {venues.map((v) => (
            <button
              key={v.venue_id}
              className="chip"
              aria-pressed={filterVenue === v.venue_id}
              onClick={() => setFilterVenue(v.venue_id)}
            >
              {v.venue_name}
            </button>
          ))}
        </div>
      )}

      {/* Cohort filter */}
      {cohorts.length > 0 && (
        <div className="chips" style={{ marginBottom: "var(--gap-2)" }}>
          <button className="chip" aria-pressed={filterCohort === null} onClick={() => setFilterCohort(null)}>
            All cohorts
          </button>
          {cohorts.map((c) => (
            <button
              key={c.cohort_id}
              className="chip"
              aria-pressed={filterCohort === c.cohort_id}
              onClick={() => setFilterCohort(c.cohort_id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {err && <p style={{ color: "var(--live)", fontSize: 13, marginBottom: 12 }}>{err}</p>}

      {shownSessions === null && <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</p>}

      {shownSessions !== null && shownSessions.length === 0 && (
        <EmptyState
          title="No sessions yet"
          body="Create the first session for this club."
          action={<button className="btn btn-primary" onClick={() => setCreateOpen(true)}>New session</button>}
        />
      )}

      {shownSessions !== null && shownSessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shownSessions.map((s) => (
            <SessionRow
              key={s.session_id}
              session={s}
              onClick={() => setDetail(s)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateSessionModal
          venueToken={venueToken}
          clubId={clubId}
          cohorts={cohorts}
          venues={venues}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); loadSessions(); }}
        />
      )}

      {detail && (
        <SessionDetailModal
          venueToken={venueToken}
          session={detail}
          onClose={() => setDetail(null)}
          onCancelled={() => { setDetail(null); loadSessions(); }}
          onSeriesCancelled={() => { setDetail(null); loadSessions(); }}
        />
      )}
    </div>
  );
}

function SessionRow({ session: s, onClick }) {
  const st = SESSION_STATUS[s.status] || SESSION_STATUS.scheduled;
  return (
    <div
      className="card card-pad"
      style={{ cursor: s.status === "scheduled" ? "pointer" : "default" }}
      onClick={s.status === "scheduled" ? onClick : undefined}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14 }}>{s.title}</strong>
            <span className={"pill " + st.cls}><span className="pill-dot" />{st.label}</span>
            {s.cohort_name && (
              <span className="pill pill-info">{s.cohort_name}</span>
            )}
            {s.series_id && (
              <span className="pill pill-muted">Recurring</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span>{fmtDt(s.scheduled_at)}</span>
            {s.venue_name && <span>🏟 {s.venue_name}{s.playing_area_name ? ` · ${s.playing_area_name}` : ""}</span>}
            {s.location && <span>📍 {s.location}</span>}
            {s.capacity && <span>Cap: {s.capacity}</span>}
          </div>
          {s.status === "scheduled" && (
            <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12 }}>
              <span style={{ color: "var(--ok)" }}>✓ {s.rsvp_in} going</span>
              <span style={{ color: "var(--ink-3)" }}>{s.rsvp_maybe} maybe</span>
              <span style={{ color: "var(--ink-3)" }}>{s.rsvp_out} not going</span>
              {s.attendance_marked && (
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>Attendance marked</span>
              )}
            </div>
          )}
          {s.status === "cancelled" && s.cancelled_reason && (
            <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "4px 0 0" }}>
              Reason: {s.cancelled_reason}
            </p>
          )}
        </div>
        {s.status === "scheduled" && (
          <div style={{ fontSize: 12, color: "var(--ink-4)" }}>View →</div>
        )}
      </div>
    </div>
  );
}

function CreateSessionModal({ venueToken, clubId, cohorts, venues = [], onClose, onDone }) {
  // Default the site to the caller's own venue so every venue-created session is
  // anchored (single-venue clubs need no picker but still record their venue).
  const selfVenue = venues.find((v) => v.is_self) ?? venues[0] ?? null;
  const [mode, setMode] = useState("oneoff"); // "oneoff" | "recurring"
  const [form, setForm] = useState({
    title: "", scheduledAt: "", cohortId: "", location: "", notes: "", capacity: "",
    sessionType: "training", dayOfWeek: "1", startTime: "", fromDate: "", toDate: "",
    venueId: selfVenue?.venue_id ?? "", playingAreaId: "",
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSavingRef = useRef(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const selectedVenue = venues.find((v) => v.venue_id === form.venueId) ?? null;
  const pitches = selectedVenue?.playing_areas ?? [];

  const submit = async () => {
    if (isSavingRef.current) return;
    setErr(null);
    if (!form.title.trim()) { setErr("Enter a session title."); return; }
    if (mode === "oneoff") {
      if (!form.scheduledAt) { setErr("Pick a date and time."); return; }
    } else {
      if (!form.startTime) { setErr("Pick a start time."); return; }
      if (!form.fromDate)  { setErr("Pick a start date."); return; }
      if (!form.toDate)    { setErr("Pick an end date."); return; }
      if (form.fromDate > form.toDate) { setErr("Start date must be before end date."); return; }
    }
    isSavingRef.current = true;
    setBusy(true);
    try {
      if (mode === "oneoff") {
        await clubCreateSession(venueToken, clubId, {
          title: form.title.trim(),
          scheduledAt: new Date(form.scheduledAt).toISOString(),
          cohortId: form.cohortId || null,
          location: form.location.trim() || null,
          notes: form.notes.trim() || null,
          capacity: form.capacity ? parseInt(form.capacity, 10) : null,
          venueId: form.venueId || null,
          playingAreaId: form.playingAreaId || null,
        });
      } else {
        await clubCreateSessionSeries(venueToken, clubId, {
          title: form.title.trim(),
          sessionType: form.sessionType,
          dayOfWeek: parseInt(form.dayOfWeek, 10),
          startTime: form.startTime,
          fromDate: form.fromDate,
          toDate: form.toDate,
          cohortId: form.cohortId || null,
          location: form.location.trim() || null,
          notes: form.notes.trim() || null,
          capacity: form.capacity ? parseInt(form.capacity, 10) : null,
          venueId: form.venueId || null,
          playingAreaId: form.playingAreaId || null,
        });
      }
      onDone();
    } catch (e) {
      setErr(e?.message === "slot_unavailable"
        ? "That pitch is already booked at this time — pick another slot or pitch."
        : (e?.message || String(e)));
    } finally {
      isSavingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal title="New session" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : mode === "recurring" ? "Create recurring block" : "Create session"}
        </button>
      </>
    }>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Mode toggle */}
        <div className="chips">
          <button className="chip" aria-pressed={mode === "oneoff"} onClick={() => setMode("oneoff")}>
            One-off
          </button>
          <button className="chip" aria-pressed={mode === "recurring"} onClick={() => setMode("recurring")}>
            Recurring block
          </button>
        </div>

        <div>
          <label className="field-label">Title *</label>
          <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Tuesday Training" />
        </div>

        {mode === "oneoff" ? (
          <div>
            <label className="field-label">Date & time *</label>
            <input className="input" type="datetime-local" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Day *</label>
                <select className="input" value={form.dayOfWeek} onChange={(e) => set("dayOfWeek", e.target.value)}>
                  {DOW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">Time *</label>
                <input className="input" type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">From *</label>
                <input className="input" type="date" value={form.fromDate} onChange={(e) => set("fromDate", e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">To *</label>
                <input className="input" type="date" value={form.toDate} onChange={(e) => set("toDate", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="field-label">Session type</label>
              <select className="input" value={form.sessionType} onChange={(e) => set("sessionType", e.target.value)}>
                {Object.entries(SESSION_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {cohorts.length > 0 && (
          <div>
            <label className="field-label">Cohort</label>
            <select className="input" value={form.cohortId} onChange={(e) => set("cohortId", e.target.value)}>
              <option value="">All members</option>
              {cohorts.map((c) => (
                <option key={c.cohort_id} value={c.cohort_id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        {/* Venue picker — shown when the club operates from more than one site */}
        {venues.length > 1 && (
          <div>
            <label className="field-label">Venue</label>
            <select
              className="input"
              value={form.venueId}
              onChange={(e) => { set("venueId", e.target.value); set("playingAreaId", ""); }}
            >
              {venues.map((v) => (
                <option key={v.venue_id} value={v.venue_id}>
                  {v.venue_name}{v.is_self ? " (this site)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Pitch / area — only when the chosen venue has playing areas */}
        {pitches.length > 0 && (
          <div>
            <label className="field-label">Pitch / area</label>
            <select className="input" value={form.playingAreaId} onChange={(e) => set("playingAreaId", e.target.value)}>
              <option value="">No specific pitch</option>
              {pitches.map((pa) => (
                <option key={pa.id} value={pa.id}>{pa.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="field-label">Location</label>
          <input className="input" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Pitch 2" />
        </div>
        <div>
          <label className="field-label">Capacity</label>
          <input className="input" type="number" min="1" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} placeholder="Leave blank for unlimited" />
        </div>
        <div>
          <label className="field-label">Notes</label>
          <textarea className="input" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes for members" />
        </div>
        {err && <p style={{ color: "var(--live)", fontSize: 13, margin: 0 }}>{err}</p>}
      </div>
    </Modal>
  );
}

function SessionDetailModal({ venueToken, session, onClose, onCancelled, onSeriesCancelled }) {
  const [rsvpData, setRsvpData] = useState(null);
  const [rsvpErr, setRsvpErr] = useState(null);
  const [attendance, setAttendance] = useState({});
  const [savingAtt, setSavingAtt] = useState(false);
  const [attErr, setAttErr] = useState(null);
  const [attSaved, setAttSaved] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelSeriesOpen, setCancelSeriesOpen] = useState(false);
  const isSavingRef = useRef(false);

  const loadRsvps = useCallback(async () => {
    setRsvpErr(null);
    try {
      const d = await clubGetSessionRsvps(venueToken, session.session_id);
      setRsvpData(d);
      const init = {};
      (d.attendance || []).forEach((a) => { init[a.member_profile_id] = a.status; });
      setAttendance(init);
    } catch (e) { setRsvpErr(e?.message || String(e)); }
  }, [venueToken, session.session_id]);

  useEffect(() => { loadRsvps(); }, [loadRsvps]);

  const rsvps = rsvpData?.rsvps || [];
  const byStatus = { in: [], out: [], maybe: [], pending: [] };
  rsvps.forEach((r) => { (byStatus[r.status] || byStatus.pending).push(r); });

  const allMembers = rsvps.filter((r) => r.status !== "out");

  const setAtt = (memberId, status) => {
    setAttendance((a) => ({ ...a, [memberId]: status }));
    setAttSaved(false);
  };

  const saveAttendance = async () => {
    if (isSavingRef.current) return;
    setAttErr(null);
    isSavingRef.current = true;
    setSavingAtt(true);
    try {
      const payload = Object.entries(attendance)
        .filter(([, status]) => status != null)
        .map(([member_profile_id, status]) => ({ member_profile_id, status }));
      if (payload.length === 0) { setAttErr("No attendance to save — toggle some members first."); return; }
      await clubMarkAttendance(venueToken, session.session_id, payload);
      setAttSaved(true);
      await loadRsvps();
    } catch (e) {
      setAttErr(e?.message || String(e));
    } finally {
      isSavingRef.current = false;
      setSavingAtt(false);
    }
  };

  return (
    <>
      <Modal title={session.title} wide onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Session meta */}
          <div style={{ fontSize: 13, color: "var(--ink-3)", display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span>{fmtDt(session.scheduled_at)}</span>
            {session.venue_name && <span>🏟 {session.venue_name}{session.playing_area_name ? ` · ${session.playing_area_name}` : ""}</span>}
            {session.venue_address && <span>{session.venue_address}</span>}
            {session.location && <span>📍 {session.location}</span>}
            {session.cohort_name && <span>Group: {session.cohort_name}</span>}
            {session.capacity && <span>Cap: {session.capacity}</span>}
          </div>
          {session.notes && (
            <p style={{ fontSize: 13, margin: 0, color: "var(--ink-2)" }}>{session.notes}</p>
          )}

          {/* RSVP board */}
          <div>
            <div className="h-section" style={{ marginBottom: 10 }}>
              <h2>RSVPs</h2>
              <span className="h-count">{rsvps.length}</span>
            </div>

            {rsvpErr && <p style={{ color: "var(--live)", fontSize: 13 }}>{rsvpErr}</p>}
            {!rsvpData && !rsvpErr && <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</p>}

            {rsvpData && rsvps.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--ink-3)" }}>No RSVPs yet.</p>
            )}

            {rsvpData && rsvps.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {["in", "maybe", "pending", "out"].map((st) =>
                  byStatus[st].length === 0 ? null : (
                    <div key={st}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                        {RSVP_STATUS[st].label} ({byStatus[st].length})
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {byStatus[st].map((r) => (
                          <span key={r.rsvp_id} className={"pill " + RSVP_STATUS[st].cls}>
                            {r.first_name}
                            {r.note && <span title={r.note}> *</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Attendance */}
          {rsvpData && allMembers.length > 0 && (
            <div>
              <div className="h-section" style={{ marginBottom: 10 }}>
                <h2>Attendance</h2>
                {session.attendance_marked && (
                  <span className="pill pill-ok" style={{ marginLeft: 8 }}>
                    <span className="pill-dot" />Marked
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {allMembers.map((m) => {
                  const cur = attendance[m.member_profile_id];
                  return (
                    <div key={m.member_profile_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, width: 100, flex: "none" }}>{m.first_name}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {ATTENDANCE_STATUS.map(([val, label, cls]) => (
                          <button
                            key={val}
                            className={"btn btn-xs" + (cur === val ? " btn-primary" : "")}
                            style={cur === val ? {} : { opacity: 0.6 }}
                            onClick={() => setAtt(m.member_profile_id, val)}
                          >
                            {label}
                          </button>
                        ))}
                        {cur && (
                          <button
                            className="btn btn-xs btn-ghost"
                            style={{ opacity: 0.5 }}
                            onClick={() => setAtt(m.member_profile_id, undefined)}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button className="btn btn-sm btn-primary" onClick={saveAttendance} disabled={savingAtt}>
                  {savingAtt ? "Saving…" : "Save attendance"}
                </button>
                {attSaved && <span style={{ fontSize: 13, color: "var(--ok)" }}>Saved</span>}
                {attErr && <span style={{ fontSize: 13, color: "var(--live)" }}>{attErr}</span>}
              </div>
            </div>
          )}

          {/* Cancel session / series */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-danger" onClick={() => setCancelOpen(true)}>
              Cancel session
            </button>
            {session.series_id && (
              <button className="btn btn-sm btn-danger" style={{ opacity: 0.8 }} onClick={() => setCancelSeriesOpen(true)}>
                Cancel remaining series
              </button>
            )}
          </div>
        </div>
      </Modal>

      {cancelOpen && (
        <CancelSessionModal
          venueToken={venueToken}
          session={session}
          onClose={() => setCancelOpen(false)}
          onDone={() => { setCancelOpen(false); onCancelled(); }}
        />
      )}

      {cancelSeriesOpen && (
        <CancelSeriesModal
          venueToken={venueToken}
          session={session}
          onClose={() => setCancelSeriesOpen(false)}
          onDone={() => { setCancelSeriesOpen(false); onSeriesCancelled(); }}
        />
      )}
    </>
  );
}

function CancelSessionModal({ venueToken, session, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSavingRef = useRef(false);

  const submit = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setErr(null);
    setBusy(true);
    try {
      await clubCancelSession(venueToken, session.session_id, reason.trim() || null);
      onDone();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      isSavingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal title="Cancel session" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose} disabled={busy}>Keep session</button>
        <button className="btn btn-danger" onClick={submit} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel session"}
        </button>
      </>
    }>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14, margin: 0 }}>
          Cancel <strong>{session.title}</strong> on {fmtDt(session.scheduled_at)}?
          Members who RSVPed will not be automatically notified.
        </p>
        <div>
          <label className="field-label">Reason (optional)</label>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Pitch unavailable"
          />
        </div>
        {err && <p style={{ color: "var(--live)", fontSize: 13, margin: 0 }}>{err}</p>}
      </div>
    </Modal>
  );
}

function CancelSeriesModal({ venueToken, session, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSavingRef = useRef(false);

  const submit = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setErr(null);
    setBusy(true);
    try {
      await clubCancelSessionSeries(venueToken, session.series_id, reason.trim() || null);
      onDone();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      isSavingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal title="Cancel recurring block" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose} disabled={busy}>Keep sessions</button>
        <button className="btn btn-danger" onClick={submit} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel all remaining"}
        </button>
      </>
    }>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14, margin: 0 }}>
          Cancel all remaining scheduled sessions in the <strong>{session.series_title || session.title}</strong> recurring block?
          Past and already-cancelled sessions are not affected.
        </p>
        <div>
          <label className="field-label">Reason (optional)</label>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Season ended"
          />
        </div>
        {err && <p style={{ color: "var(--live)", fontSize: 13, margin: 0 }}>{err}</p>}
      </div>
    </Modal>
  );
}
