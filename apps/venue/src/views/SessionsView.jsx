import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  venueListClubs,
  clubListCohorts,
  clubListSessions,
  clubCreateSession,
  clubCancelSession,
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
  const [sessions, setSessions] = useState(null);
  const [filterCohort, setFilterCohort] = useState(null);
  const [err, setErr] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null); // session object

  const loadCohorts = useCallback(async () => {
    try { setCohorts(await clubListCohorts(venueToken, clubId)); }
    catch (e) { console.error(e); }
  }, [venueToken, clubId]);

  const loadSessions = useCallback(async () => {
    setErr(null);
    try { setSessions(await clubListSessions(venueToken, clubId, { cohortId: filterCohort })); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [venueToken, clubId, filterCohort]);

  useEffect(() => { loadCohorts(); }, [loadCohorts]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  return (
    <div>
      <SectionHead label="Sessions" count={sessions?.length ?? 0}>
        <button className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
          + New session
        </button>
      </SectionHead>

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

      {sessions === null && <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</p>}

      {sessions !== null && sessions.length === 0 && (
        <EmptyState
          title="No sessions yet"
          body="Create the first session for this club."
          action={<button className="btn btn-primary" onClick={() => setCreateOpen(true)}>New session</button>}
        />
      )}

      {sessions !== null && sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map((s) => (
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <strong style={{ fontSize: 14 }}>{s.title}</strong>
            <span className={"pill " + st.cls}><span className="pill-dot" />{st.label}</span>
            {s.cohort_name && (
              <span className="pill pill-info">{s.cohort_name}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span>{fmtDt(s.scheduled_at)}</span>
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

function CreateSessionModal({ venueToken, clubId, cohorts, onClose, onDone }) {
  const [form, setForm] = useState({
    title: "", scheduledAt: "", cohortId: "", location: "", notes: "", capacity: "",
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSavingRef = useRef(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (isSavingRef.current) return;
    setErr(null);
    if (!form.title.trim()) { setErr("Enter a session title."); return; }
    if (!form.scheduledAt) { setErr("Pick a date and time."); return; }
    isSavingRef.current = true;
    setBusy(true);
    try {
      await clubCreateSession(venueToken, clubId, {
        title: form.title.trim(),
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        cohortId: form.cohortId || null,
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
        capacity: form.capacity ? parseInt(form.capacity, 10) : null,
      });
      onDone();
    } catch (e) {
      setErr(e?.message || String(e));
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
          {busy ? "Creating…" : "Create session"}
        </button>
      </>
    }>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label className="field-label">Title *</label>
          <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Tuesday Training" />
        </div>
        <div>
          <label className="field-label">Date & time *</label>
          <input className="input" type="datetime-local" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} />
        </div>
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

function SessionDetailModal({ venueToken, session, onClose, onCancelled }) {
  const [rsvpData, setRsvpData] = useState(null);
  const [rsvpErr, setRsvpErr] = useState(null);
  const [attendance, setAttendance] = useState({});
  const [savingAtt, setSavingAtt] = useState(false);
  const [attErr, setAttErr] = useState(null);
  const [attSaved, setAttSaved] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
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
      const payload = Object.entries(attendance).map(([member_profile_id, status]) => ({
        member_profile_id, status,
      }));
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

          {/* Cancel session */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <button className="btn btn-sm btn-danger" onClick={() => setCancelOpen(true)}>
              Cancel session
            </button>
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
