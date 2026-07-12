// TeamManagerTraining.jsx — Team-manager track, "Training" (More sub-screen). Lets a
// coach see and manage their team's training sessions — the phone twin of the desktop
// coach session manager in apps/inorout/src/views/SessionsScreen.jsx, reusing the SAME
// coach-auth RPCs so the records are identical and sync both ways:
//   • list   — memberListUpcomingSessions(clubId) (member-auth by club; each session
//     carries team_id + session_type, so we filter to the selected team + training/social)
//   • add    — clubManagerCreateSession(teamId, {...})       (single)
//              clubManagerCreateSessionSeries(teamId, {...})  (weekly recurring)
//   • cancel — clubManagerCancelSession(sessionId, reason)
// All coach-gated server-side (auth.uid → club_team_managers). NO new backend.
//
// Add + cancel use the shared MobileSheet (pinned footer) so the confirm button never
// buries off-screen and the scrim clears the docked nav (reference_hub_sheet_nav_ios_stacking).
// Renders inside [data-surface="mobile"] → shell amber tokens only.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  clubManagerListTeamFixtures, memberListUpcomingSessions,
  clubManagerCreateSession, clubManagerCreateSessionSeries, clubManagerCancelSession,
  clubManagerPitchAvailability, clubManagerBookPitch, clubManagerBookPitchSeries,
  clubManagerListBookableVenues, pitchStatusMeta,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";
import SessionRsvpSheet from "./SessionRsvpSheet.jsx";
import ManagerBookings from "./ManagerBookings.jsx";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Pitch booking IN the Add-training flow (operator reframe: pitch = part of session setup,
// not a standalone action). Dark in prod behind the SAME single env flag as the desktop
// entry, so it stays hidden until a pilot flips it. Fixed 60-min window (the reserve unit).
const SELF_BOOKING_ENABLED = import.meta.env.VITE_SELF_BOOKING_ENABLED === "true";
const BOOK_MINS = 60;

// { day:"Sat", dm:"11 Jul", time:"18:30" } for a stored session instant. club_sessions.scheduled_at
// is a timestamptz (a UTC instant — the recurring generator stores it AT TIME ZONE 'Europe/London',
// mig 353), so PostgREST serializes it in UTC. We MUST convert UTC→viewer-local via toLocale* —
// exactly like the desktop SessionsScreen fmtDate/fmtTime — or a BST 18:30 (stored 17:30Z) would
// display an hour early and disagree with desktop. (Fixtures differ: their kickoff_time is plain
// text, so those screens read raw parts — do NOT copy that pattern here.)
function fmtWhen(iso) {
  if (!iso) return { day: "", dm: "Date TBC", time: "" };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { day: "", dm: "Date TBC", time: "" };
  return {
    day: dt.toLocaleDateString("en-GB", { weekday: "short" }),
    dm: dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    time: dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

const TYPE_LABEL = { training: "Training", social: "Social", match: "Match", other: "Session" };
const emptyForm = () => ({
  title: "", sessionType: "training", date: "", time: "", location: "", notes: "", capacity: "",
  repeat: false, toDate: "",
});

export default function TeamManagerTraining({ toast, onBack }) {
  const [teamsState, setTeamsState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [sessions, setSessions] = useState({ loading: false, error: false, rows: [] });
  const [addOpen, setAddOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);     // full-screen Pitch calendar overlay
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [cancelFor, setCancelFor] = useState(null);   // the session row being cancelled
  const [cancelReason, setCancelReason] = useState("");
  const [boardFor, setBoardFor] = useState(null);     // session row tapped → availability board sheet
  const cancelRef = useRef(false);

  // ── Pitch booking (dark behind SELF_BOOKING_ENABLED) ── reuse the coach book-a-pitch
  // path (mig 558/560): pick a linked GROUND + a free PITCH as part of Add training.
  const [venues, setVenues] = useState([]);          // [{venue_id, venue_name}]
  const [venueId, setVenueId] = useState("");
  const [pitches, setPitches] = useState([]);        // [{id, name}]
  const [busyBlocks, setBusyBlocks] = useState([]);  // [{playing_area_id, start, end}]
  const [selectedPitch, setSelectedPitch] = useState(null);
  const [loadingAvail, setLoadingAvail] = useState(false);

  const loadTeams = useCallback(async () => {
    setTeamsState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await clubManagerListTeamFixtures();
      setTeamsState({ loading: false, error: false, teams: res?.teams || [] });
    } catch {
      setTeamsState({ loading: false, error: true, teams: [] });
    }
  }, []);
  useEffect(() => { loadTeams(); }, [loadTeams]);

  const teams = teamsState.teams;
  const team = teams[teamIdx] || teams[0] || null;
  const clubId = team?.club_id || null;
  const teamId = team?.team_id || null;

  const reqRef = useRef(0);
  const loadSessions = useCallback(async () => {
    if (!clubId) { setSessions({ loading: false, error: false, rows: [] }); return; }
    const reqId = ++reqRef.current;
    setSessions({ loading: true, error: false, rows: [] });
    try {
      const data = await memberListUpcomingSessions(clubId);
      if (reqId !== reqRef.current) return;
      const rows = Array.isArray(data?.sessions) ? data.sessions : Array.isArray(data) ? data : [];
      setSessions({ loading: false, error: false, rows });
    } catch {
      if (reqId !== reqRef.current) return;
      setSessions({ loading: false, error: true, rows: [] });
    }
  }, [clubId]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  // This team's TRAINING/SOCIAL sessions only (matches are fixtures — shown in League).
  const trainingRows = useMemo(() => {
    return (sessions.rows || [])
      .filter((s) => String(s.team_id) === String(teamId))
      .filter((s) => s.session_type === "training" || s.session_type === "social")
      .filter((s) => String(s.status || "active") !== "cancelled")
      .sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0));
  }, [sessions.rows, teamId]);

  // Load the club's bookable grounds when the Add sheet opens (manager-gated reader,
  // mig 565 — populates even for a Manager who isn't also a paying member).
  useEffect(() => {
    if (!SELF_BOOKING_ENABLED || !addOpen || !teamId) return;
    let cancelled = false;
    clubManagerListBookableVenues(teamId)
      .then((res) => { if (!cancelled) setVenues(Array.isArray(res?.venues) ? res.venues : []); })
      .catch(() => { if (!cancelled) setVenues([]); });
    return () => { cancelled = true; };
  }, [addOpen, teamId]);

  // Availability (busy blocks + pitch list) for the chosen ground + day.
  useEffect(() => {
    setSelectedPitch(null);
    if (!SELF_BOOKING_ENABLED || !venueId || !form.date || !teamId) { setPitches([]); setBusyBlocks([]); return; }
    let cancelled = false;
    setLoadingAvail(true);
    clubManagerPitchAvailability(teamId, venueId, form.date, form.date)
      .then((res) => { if (cancelled) return; setPitches(Array.isArray(res?.pitches) ? res.pitches : []); setBusyBlocks(Array.isArray(res?.busy) ? res.busy : []); })
      .catch(() => { if (cancelled) return; setPitches([]); setBusyBlocks([]); })
      .finally(() => { if (!cancelled) setLoadingAvail(false); });
    return () => { cancelled = true; };
  }, [venueId, form.date, teamId]);

  // Advisory free/busy for the chosen [start, +60min) window (the DB trigger is the real
  // authority — a busy pick just becomes a REQUEST). Same advisory idiom desktop uses.
  const windowFree = (pitchId) => {
    if (!form.date || !form.time) return true;
    const winStart = new Date(`${form.date}T${form.time}:00`).getTime();
    if (Number.isNaN(winStart)) return true;
    const winEnd = winStart + BOOK_MINS * 60 * 1000;
    for (const b of busyBlocks) {
      if (b.playing_area_id !== pitchId) continue;
      const bs = new Date(b.start).getTime(), be = new Date(b.end).getTime();
      if (bs < winEnd && be > winStart) return false;
    }
    return true;
  };
  const selectedBusy = !!(selectedPitch && !windowFree(selectedPitch.id));

  const resetPitch = () => { setVenueId(""); setPitches([]); setBusyBlocks([]); setSelectedPitch(null); };

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.title.trim() && form.date && form.time && (!form.repeat || form.toDate) && !saving;

  const save = useCallback(async () => {
    if (savingRef.current || !teamId) return;
    const t = form.title.trim();
    if (!t || !form.date || !form.time) return;
    savingRef.current = true; setSaving(true);
    const loc = form.location.trim() || null;
    const notes = form.notes.trim() || null;
    const cap = form.capacity ? Number(form.capacity) : null;
    const dow = new Date(`${form.date}T00:00:00`).getDay(); // 0=Sun..6=Sat, matches p_day_of_week
    // A picked pitch routes through the coach book-a-pitch RPC (creates the session AND
    // reserves/requests the pitch — never also call create, that would double-create).
    const withPitch = SELF_BOOKING_ENABLED && venueId && selectedPitch;
    try {
      if (withPitch) {
        if (form.repeat) {
          const res = await clubManagerBookPitchSeries(teamId, {
            venueId, playingAreaId: selectedPitch.id, title: t, dayOfWeek: dow, startTime: form.time,
            fromDate: form.date, toDate: form.toDate, sessionType: form.sessionType,
            durationMins: BOOK_MINS, location: loc, notes, capacity: cap,
          });
          const req = Number(res?.requested_count) || 0;
          toast?.({ icon: "check", text: req ? `Weekly training added — ${req} week${req > 1 ? "s" : ""} awaiting the venue.` : "Weekly training booked." });
        } else {
          const res = await clubManagerBookPitch(teamId, {
            venueId, playingAreaId: selectedPitch.id, scheduledAt: `${form.date}T${form.time}:00`,
            title: t, sessionType: form.sessionType, durationMins: BOOK_MINS, location: loc, notes, capacity: cap,
          });
          toast?.({ icon: "check", text: res?.pitch_status === "requested" ? "Training added — pitch being confirmed." : "Training added — pitch booked." });
        }
      } else if (form.repeat) {
        await clubManagerCreateSessionSeries(teamId, {
          title: t, sessionType: form.sessionType, dayOfWeek: dow, startTime: form.time,
          fromDate: form.date, toDate: form.toDate, location: loc, notes, capacity: cap,
        });
        toast?.({ icon: "check", text: "Weekly training added." });
      } else {
        await clubManagerCreateSession(teamId, {
          title: t, scheduledAt: `${form.date}T${form.time}:00`, sessionType: form.sessionType,
          location: loc, notes, capacity: cap,
        });
        toast?.({ icon: "check", text: "Training added." });
      }
      setAddOpen(false); setForm(emptyForm()); resetPitch();
      loadSessions();
    } catch (e) {
      console.error("[manager-training] create session failed", e);
      toast?.({ icon: "alert", text: "Couldn't add that session." });
    } finally { savingRef.current = false; setSaving(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, form, venueId, selectedPitch, toast, loadSessions]);

  const doCancel = useCallback(async () => {
    if (cancelRef.current || !cancelFor) return;
    cancelRef.current = true;
    const sid = cancelFor.session_id || cancelFor.id;
    try {
      await clubManagerCancelSession(sid, cancelReason.trim() || null);
      toast?.({ icon: "check", text: "Session cancelled." });
      setCancelFor(null); setCancelReason("");
      loadSessions();
    } catch (e) {
      console.error("[manager-training] cancel session failed", e);
      toast?.({ icon: "alert", text: "Couldn't cancel that session." });
    } finally { cancelRef.current = false; }
  }, [cancelFor, cancelReason, toast, loadSessions]);

  return (
    <div>
      <button onClick={onBack} style={backBtn}>
        <MIcon name="chevron" size={15} color="var(--ink3)" style={{ transform: "rotate(180deg)" }} /> More
      </button>

      {teamsState.loading && <Card><div className="m-eyebrow">Training</div><p style={muted}>Loading your teams…</p></Card>}
      {teamsState.error && (
        <Card><div className="m-eyebrow">Training</div><p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your teams.</p>
          <button onClick={loadTeams} style={retryBtn}>Try again</button></Card>
      )}
      {!teamsState.loading && !teamsState.error && !team && (
        <Card><div className="m-eyebrow">Training</div><p style={muted}>No teams to manage yet.</p></Card>
      )}

      {!teamsState.loading && !teamsState.error && team && (
        <>
          {teams.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 2px 4px" }}>
              {teams.map((t, i) => {
                const on = i === teamIdx;
                return (
                  <button key={t.team_id} onClick={() => setTeamIdx(i)} style={pill(on)}>{t.team_name}</button>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 2px 11px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>Upcoming training</h2>
            {!sessions.loading && <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{trainingRows.length} session{trainingRows.length === 1 ? "" : "s"}</span>}
          </div>

          {sessions.loading && <Card><p style={muted}>Loading sessions…</p></Card>}
          {sessions.error && (
            <Card><p style={{ color: "var(--ink2)", fontSize: 13.5, margin: 0 }}>Couldn't load sessions.</p>
              <button onClick={loadSessions} style={retryBtn}>Try again</button></Card>
          )}
          {!sessions.loading && !sessions.error && trainingRows.length === 0 && (
            <Card><p style={muted}>No upcoming training. Add one below.</p></Card>
          )}
          {!sessions.loading && !sessions.error && trainingRows.map((s) => {
            const w = fmtWhen(s.scheduled_at);
            const pmeta = pitchStatusMeta(s.pitch_status);
            return (
              <div key={s.session_id || s.id} className="m-card" style={{ padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setBoardFor(s)} aria-label="See who's available" style={{
                  flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, padding: 0,
                  background: "transparent", border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit",
                }}>
                  <div style={{ width: 46, flex: "none", textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>{w.day} {w.dm.split(" ")[0]}</div>
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 1 }}>{w.time || "TBC"}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || TYPE_LABEL[s.session_type] || "Training"}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5 }}>
                      <MIcon name="users" size={12} color="var(--ink4)" />
                      {[TYPE_LABEL[s.session_type] || "Training", pmeta.showSlot ? (s.location || s.venue_name) : pmeta.label, "who's in"].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </button>
                <button onClick={() => { setCancelFor(s); setCancelReason(""); }} aria-label="Cancel session" style={{
                  height: 30, padding: "0 12px", borderRadius: "var(--r-pill)", flex: "none", cursor: "pointer",
                  background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--ink3)",
                  fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700,
                }}>Cancel</button>
              </div>
            );
          })}

          <button onClick={() => { setForm(emptyForm()); resetPitch(); setVenues([]); setAddOpen(true); }} style={{
            width: "100%", marginTop: 6, padding: "13px", borderRadius: "var(--r-pill)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
            fontFamily: "var(--m-font)", fontSize: 14, fontWeight: 800,
          }}>
            <MIcon name="plus" size={16} color="var(--amber)" /> Add training
          </button>

          {SELF_BOOKING_ENABLED && (
            <button onClick={() => setCalOpen(true)} style={{
              width: "100%", marginTop: 9, padding: "13px", borderRadius: "var(--r-pill)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink2)",
              fontFamily: "var(--m-font)", fontSize: 14, fontWeight: 800,
            }}>
              <MIcon name="calendar" size={16} color="var(--ink2)" /> Pitch calendar
            </button>
          )}
        </>
      )}

      {calOpen && (
        <ManagerBookings teamId={teamId} teamName={team?.team_name} toast={toast}
          onClose={() => { setCalOpen(false); loadSessions(); }} />
      )}

      {/* ── Add-session sheet (pinned footer) ── */}
      {addOpen && (
        <MobileSheet
          title="Add training"
          onClose={() => { setAddOpen(false); resetPitch(); }}
          footer={
            <button onClick={save} disabled={!canSave} style={{ ...primaryBtn, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "default" }}>
              {saving ? "Saving…" : form.repeat ? "Add weekly training" : "Add session"}
            </button>
          }
        >
          <label style={labelStyle}>Title</label>
          <input value={form.title} onChange={(e) => setF("title", e.target.value)} placeholder="e.g. Monday training" maxLength={80} style={inputStyle} />

          <label style={{ ...labelStyle, marginTop: 12 }}>Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[["training", "Training"], ["social", "Social"]].map(([id, lbl]) => {
              const on = form.sessionType === id;
              return <button key={id} onClick={() => setF("sessionType", id)} style={{ ...segBtn, ...(on ? segOn : null) }}>{lbl}</button>;
            })}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.date} onChange={(e) => setF("date", e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Time</label>
              <input type="time" value={form.time} onChange={(e) => setF("time", e.target.value)} style={inputStyle} />
            </div>
          </div>

          <label style={{ ...labelStyle, marginTop: 12 }}>Location <span style={{ color: "var(--ink4)", fontWeight: 500 }}>· optional</span></label>
          <input value={form.location} onChange={(e) => setF("location", e.target.value)} placeholder="e.g. Main pitch" maxLength={120} style={inputStyle} />

          {/* Pitch booking moved OUT of this quick-add sheet into the reused day-view
              Pitch calendar (ManagerBookings) — operator pivot 2026-07-12. Add-training
              here creates a plain session; book/edit/cancel a pitch on the calendar. */}

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Capacity <span style={{ color: "var(--ink4)", fontWeight: 500 }}>· optional</span></label>
              <input type="number" inputMode="numeric" min="0" value={form.capacity} onChange={(e) => setF("capacity", e.target.value)} placeholder="—" style={inputStyle} />
            </div>
          </div>

          <label style={{ ...labelStyle, marginTop: 12 }}>Notes <span style={{ color: "var(--ink4)", fontWeight: 500 }}>· optional</span></label>
          <textarea value={form.notes} onChange={(e) => setF("notes", e.target.value)} placeholder="Anything the squad should know" rows={2} maxLength={500} style={{ ...inputStyle, resize: "vertical", minHeight: 52, lineHeight: 1.4 }} />

          {/* recurring toggle */}
          <button onClick={() => setF("repeat", !form.repeat)} style={{
            width: "100%", marginTop: 14, padding: "11px 12px", borderRadius: "var(--r-md)", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 10, textAlign: "left",
            background: form.repeat ? "var(--amber-soft)" : "var(--s2)",
            border: `1px solid ${form.repeat ? "var(--amber-glow)" : "var(--hair2)"}`, fontFamily: "var(--m-font)",
          }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: form.repeat ? "var(--amber)" : "var(--s4)" }}>
              {form.repeat && <MIcon name="check" size={13} color="var(--white, #fff)" />}
            </span>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>Repeat weekly</span>
            <span style={{ fontSize: 12, color: "var(--ink3)" }}>{form.date ? DAYS[new Date(`${form.date}T00:00:00`).getDay()] + "s" : ""}</span>
          </button>

          {form.repeat && (
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Repeat until</label>
              <input type="date" value={form.toDate} min={form.date || undefined} onChange={(e) => setF("toDate", e.target.value)} style={inputStyle} />
              <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 6 }}>Creates a weekly {TYPE_LABEL[form.sessionType].toLowerCase()} on {form.date ? DAYS[new Date(`${form.date}T00:00:00`).getDay()] + "s" : "the chosen day"} from the date above until this date.</div>
            </div>
          )}
        </MobileSheet>
      )}

      {/* ── Cancel confirm sheet ── */}
      {cancelFor && (
        <MobileSheet
          title="Cancel session"
          onClose={() => setCancelFor(null)}
          footer={
            <button onClick={doCancel} style={{ ...primaryBtn, background: "var(--live-soft)", borderColor: "var(--live-soft)", color: "var(--live-ink)" }}>
              Cancel this session
            </button>
          }
        >
          <p style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600, margin: "2px 0 4px" }}>
            {cancelFor.title || "This session"}
          </p>
          <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 12px" }}>
            {fmtWhen(cancelFor.scheduled_at).day} {fmtWhen(cancelFor.scheduled_at).dm} · {fmtWhen(cancelFor.scheduled_at).time}. Players who RSVP'd will be notified.
          </p>
          <label style={labelStyle}>Reason <span style={{ color: "var(--ink4)", fontWeight: 500 }}>· optional</span></label>
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Waterlogged pitch" maxLength={160} style={inputStyle} />
        </MobileSheet>
      )}

      {boardFor && <SessionRsvpSheet session={boardFor} onClose={() => setBoardFor(null)} />}
    </div>
  );
}

// ── small presentational helpers ──
function Card({ children }) { return <div className="m-card" style={{ marginTop: 8 }}>{children}</div>; }
const muted = { color: "var(--ink3)", fontSize: 14, marginTop: 8 };
const backBtn = {
  display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
  cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, margin: "6px 0 2px",
};
const pill = (on) => ({
  height: 32, padding: "0 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
  fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700, border: "1px solid",
  background: on ? "var(--amber-soft)" : "transparent",
  color: on ? "var(--amber)" : "var(--ink3)",
  borderColor: on ? "var(--amber-glow)" : "var(--hair2)",
});
const labelStyle = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink3)", letterSpacing: "0.02em", marginBottom: 5, fontFamily: "var(--m-font)" };
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: "var(--r-md)",
  background: "var(--s2)", border: "1px solid var(--hair2)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 15, outline: "none",
};
const segBtn = {
  flex: 1, height: 40, borderRadius: "var(--r-md)", cursor: "pointer", border: "1px solid var(--hair2)",
  background: "var(--s2)", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
};
const segOn = { background: "var(--amber-soft)", borderColor: "var(--amber-glow)", color: "var(--amber)" };
const primaryBtn = {
  width: "100%", padding: "13px", borderRadius: "var(--r-pill)",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontFamily: "var(--m-font)", fontSize: 14.5, fontWeight: 800,
};
const retryBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
};
